// Package kube drives kubectl for read-only cluster exploration: contexts,
// namespaces and pods. Every command is explicit — nothing is inferred from a
// kube context the user did not choose — and runs only when the user acts.
//
// All output is parsed in-process from `kubectl ... -o json`; `kubectl` is
// never shelled out through a shell, so a context or namespace value can never
// be interpreted as a flag.
package kube

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Command timeout: a cluster call that hangs must not hang the sidecar.
const commandTimeout = 20 * time.Second

// Control characters are the only characters a kubectl argument must not
// contain: exec passes arguments verbatim, so nothing else is interpreted.
var controlChars = regexp.MustCompile(`[\x00-\x1f\x7f]`)

// ─── Results ─────────────────────────────────────────────────────────────────

// ContextEntry is one kube context from `kubectl config get-contexts`.
type ContextEntry struct {
	Name string `json:"name"`
}

// ContextsResult carries every context plus the current one.
type ContextsResult struct {
	Contexts []ContextEntry `json:"contexts"`
	Current  string         `json:"current"`
}

// Namespace is one namespace from `kubectl get namespaces`.
type Namespace struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// Pod is one pod from `kubectl get pods`, reduced to what the UI shows.
type Pod struct {
	Name       string            `json:"name"`
	Namespace  string            `json:"namespace"`
	Phase      string            `json:"phase"`
	Ready      string            `json:"ready"`
	Restarts   int32             `json:"restarts"`
	Age        string            `json:"age"`
	Node       string            `json:"node"`
	Containers []string          `json:"containers"`
	Labels     map[string]string `json:"labels"`
}

// ─── kubectl plumbing ───────────────────────────────────────────────────────

// Available reports whether kubectl is installed and on PATH.
func Available() bool {
	_, err := exec.LookPath("kubectl")
	return err == nil
}

func validateIdentifier(name, kind string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("select a %s", kind)
	}
	if controlChars.MatchString(name) {
		return fmt.Errorf("invalid %s", kind)
	}
	return nil
}

func withContext(args []string, contextName string) ([]string, error) {
	if contextName != "" {
		if err := validateIdentifier(contextName, "context"); err != nil {
			return nil, err
		}
		args = append(args, "--context", contextName)
	}
	return args, nil
}

// run executes kubectl with the given context (empty means the current one)
// and returns its stdout. stderr is folded into the returned error.
func run(ctx context.Context, contextName string, args ...string) ([]byte, error) {
	if !Available() {
		return nil, errors.New("kubectl is not installed or not on PATH")
	}
	args, err := withContext(args, contextName)
	if err != nil {
		return nil, err
	}
	runCtx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, "kubectl", args...)
	hideConsole(cmd)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("kubectl %s: %s", strings.Join(args, " "), message)
	}
	return out, nil
}

// ─── Read operations ────────────────────────────────────────────────────────

// ListContexts returns every context name and the current context.
func ListContexts(ctx context.Context) (ContextsResult, error) {
	if !Available() {
		return ContextsResult{}, errors.New("kubectl is not installed or not on PATH")
	}
	runCtx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	var list struct {
		Contexts       []struct {
			Name string `json:"name"`
		} `json:"contexts"`
		Current string `json:"current-context"`
	}
	cmd := exec.CommandContext(runCtx, "kubectl", "config", "get-contexts", "-o", "json")
	hideConsole(cmd)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return ContextsResult{}, fmt.Errorf("kubectl config get-contexts: %s", message)
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return ContextsResult{}, fmt.Errorf("could not read contexts: %w", err)
	}

	result := ContextsResult{Current: list.Current}
	for _, item := range list.Contexts {
		if item.Name != "" {
			result.Contexts = append(result.Contexts, ContextEntry{Name: item.Name})
		}
	}
	sort.Slice(result.Contexts, func(i, j int) bool { return result.Contexts[i].Name < result.Contexts[j].Name })
	return result, nil
}

// parseNamespaces turns `kubectl get namespaces -o json` into namespace names.
func parseNamespaces(raw []byte) ([]Namespace, error) {
	var list struct {
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
			Status struct {
				Phase string `json:"phase"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	namespaces := make([]Namespace, 0, len(list.Items))
	for _, item := range list.Items {
		if item.Metadata.Name == "" {
			continue
		}
		namespaces = append(namespaces, Namespace{Name: item.Metadata.Name, Status: item.Status.Phase})
	}
	sort.Slice(namespaces, func(i, j int) bool { return namespaces[i].Name < namespaces[j].Name })
	return namespaces, nil
}

// ListNamespaces returns every namespace visible in the chosen context.
func ListNamespaces(ctx context.Context, contextName string) ([]Namespace, error) {
	if err := validateIdentifier(contextName, "context"); contextName != "" && err != nil {
		return nil, err
	}
	raw, err := run(ctx, contextName, "get", "namespaces", "-o", "json")
	if err != nil {
		return nil, err
	}
	namespaces, err := parseNamespaces(raw)
	if err != nil {
		return nil, fmt.Errorf("could not read namespaces: %w", err)
	}
	return namespaces, nil
}

// parsePods turns `kubectl get pods -o json` into reduced pod rows.
func parsePods(raw []byte) ([]Pod, error) {
	var list struct {
		Items []struct {
			Metadata struct {
				Name              string            `json:"name"`
				Namespace         string            `json:"namespace"`
				Labels            map[string]string `json:"labels"`
				CreationTimestamp string            `json:"creationTimestamp"`
			} `json:"metadata"`
			Spec struct {
				NodeName   string `json:"nodeName"`
				Containers []struct {
					Name string `json:"name"`
				} `json:"containers"`
			} `json:"spec"`
			Status struct {
				Phase             string `json:"phase"`
				ContainerStatuses []struct {
					Name         string `json:"name"`
					Ready        bool   `json:"ready"`
					RestartCount int32  `json:"restartCount"`
				} `json:"containerStatuses"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}

	pods := make([]Pod, 0, len(list.Items))
	for _, item := range list.Items {
		if item.Metadata.Name == "" {
			continue
		}
		containers := make([]string, 0, len(item.Spec.Containers))
		for _, container := range item.Spec.Containers {
			if container.Name != "" {
				containers = append(containers, container.Name)
			}
		}
		sort.Strings(containers)

		readyCount := 0
		var restarts int32
		for _, status := range item.Status.ContainerStatuses {
			if status.Ready {
				readyCount++
			}
			restarts += status.RestartCount
		}

		labels := item.Metadata.Labels
		if labels == nil {
			labels = map[string]string{}
		}

		pods = append(pods, Pod{
			Name:       item.Metadata.Name,
			Namespace:  item.Metadata.Namespace,
			Phase:      item.Status.Phase,
			Ready:      fmt.Sprintf("%d/%d", readyCount, len(containers)),
			Restarts:   restarts,
			Age:        humanAge(item.Metadata.CreationTimestamp),
			Node:       item.Spec.NodeName,
			Containers: containers,
			Labels:     labels,
		})
	}
	sort.Slice(pods, func(i, j int) bool { return pods[i].Name < pods[j].Name })
	return pods, nil
}

// ListPods returns every pod in the chosen context and namespace.
func ListPods(ctx context.Context, contextName, namespace string) ([]Pod, error) {
	if err := validateIdentifier(namespace, "namespace"); err != nil {
		return nil, err
	}
	raw, err := run(ctx, contextName, "get", "pods", "-n", namespace, "-o", "json")
	if err != nil {
		return nil, err
	}
	pods, err := parsePods(raw)
	if err != nil {
		return nil, fmt.Errorf("could not read pods: %w", err)
	}
	return pods, nil
}

// humanAge turns an RFC 3339 creation timestamp into a compact age string.
// An unparsable timestamp yields an empty string rather than an error.
func humanAge(timestamp string) string {
	return humanAgeAt(timestamp, time.Now())
}

// humanAgeAt is the pure form of humanAge, testable with a fixed clock.
func humanAgeAt(timestamp string, now time.Time) string {
	parsed, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		return ""
	}
	age := now.Sub(parsed)
	if age < 0 {
		age = 0
	}
	switch {
	case age < time.Minute:
		return fmt.Sprintf("%ds", int(age.Seconds()))
	case age < time.Hour:
		return fmt.Sprintf("%dm", int(age.Minutes()))
	case age < 24*time.Hour:
		return fmt.Sprintf("%dh", int(age.Hours()))
	default:
		return fmt.Sprintf("%dd", int(age.Hours()/24))
	}
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// RegisterHandlers mounts the read-only cluster endpoints on the sidecar mux.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/kube/tool", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"kubectl": Available()})
	})

	mux.HandleFunc("/kube/contexts", func(w http.ResponseWriter, r *http.Request) {
		result, err := ListContexts(r.Context())
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"contexts": []ContextEntry{}, "current": "", "error": err.Error()})
			return
		}
		result.Contexts = append([]ContextEntry(nil), result.Contexts...)
		writeJSON(w, http.StatusOK, map[string]any{"contexts": result.Contexts, "current": result.Current, "error": ""})
	})

	mux.HandleFunc("/kube/namespaces", func(w http.ResponseWriter, r *http.Request) {
		namespaces, err := ListNamespaces(r.Context(), r.URL.Query().Get("context"))
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"namespaces": []Namespace{}, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"namespaces": namespaces, "error": ""})
	})

	mux.HandleFunc("/kube/pods", func(w http.ResponseWriter, r *http.Request) {
		pods, err := ListPods(r.Context(), r.URL.Query().Get("context"), r.URL.Query().Get("namespace"))
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"pods": []Pod{}, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"pods": pods, "error": ""})
	})
}
