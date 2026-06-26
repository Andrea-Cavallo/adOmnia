package adomniacli

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"adomnia/internal/collectionfs"
	"adomnia/internal/httpexec"
	"adomnia/internal/requestcontract"
)

type RunSummary struct {
	Collection string          `json:"collection"`
	Total      int             `json:"total"`
	Passed     int             `json:"passed"`
	Failed     int             `json:"failed"`
	Skipped    int             `json:"skipped"`
	Results    []RequestResult `json:"results"`
}

type RequestResult struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Method   string `json:"method"`
	URL      string `json:"url"`
	Status   int    `json:"status,omitempty"`
	Duration int64  `json:"durationMs,omitempty"`
	Outcome  string `json:"outcome"`
	Message  string `json:"message,omitempty"`
}

type requestNode struct {
	requestcontract.Request
}

type envVarFlags map[string]string

func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "run" {
		return 0
	}
	fs := flag.NewFlagSet("adomnia run", flag.ContinueOnError)
	fs.SetOutput(stderr)
	reporter := fs.String("reporter", "cli", "reporter: cli or json")
	outPath := fs.String("out", "", "write reporter output to file")
	bail := fs.Bool("bail", false, "stop on first failed request")
	envName := fs.String("env", "", "environment name loaded from environments/<name>.json")
	envVars := envVarFlags{}
	fs.Var(envVars, "env-var", "override environment variable KEY=VALUE")
	flagArgs, folder := splitRunArgs(args[1:])
	if err := fs.Parse(flagArgs); err != nil {
		return 2
	}
	if strings.TrimSpace(folder) == "" {
		fmt.Fprintln(stderr, "usage: adomnia run <collection-folder> [--reporter cli|json] [--out file] [--bail]")
		return 2
	}

	collection, err := collectionfs.ImportCollection(folder)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia run: %v\n", err)
		return 2
	}
	vars, err := loadEnvironmentVars(folder, *envName)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia run: %v\n", err)
		return 2
	}
	for key, value := range envVars {
		vars[key] = value
	}
	summary := executeCollection(collection, *bail, vars)
	rendered, err := renderSummary(summary, *reporter)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia run: %v\n", err)
		return 2
	}
	if *outPath != "" {
		if err := os.WriteFile(*outPath, rendered, 0644); err != nil {
			fmt.Fprintf(stderr, "adomnia run: write report: %v\n", err)
			return 2
		}
	} else {
		_, _ = stdout.Write(rendered)
	}
	if summary.Failed > 0 {
		return 1
	}
	return 0
}

func splitRunArgs(args []string) ([]string, string) {
	flagArgs := []string{}
	folder := ""
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-bail" || arg == "--bail":
			flagArgs = append(flagArgs, arg)
		case arg == "-reporter" || arg == "--reporter" || arg == "-out" || arg == "--out" || arg == "-env" || arg == "--env" || arg == "-env-var" || arg == "--env-var":
			flagArgs = append(flagArgs, arg)
			if i+1 < len(args) {
				i++
				flagArgs = append(flagArgs, args[i])
			}
		case strings.HasPrefix(arg, "-reporter=") || strings.HasPrefix(arg, "--reporter=") || strings.HasPrefix(arg, "-out=") || strings.HasPrefix(arg, "--out=") || strings.HasPrefix(arg, "-env=") || strings.HasPrefix(arg, "--env=") || strings.HasPrefix(arg, "-env-var=") || strings.HasPrefix(arg, "--env-var="):
			flagArgs = append(flagArgs, arg)
		case folder == "":
			folder = arg
		default:
			flagArgs = append(flagArgs, arg)
		}
	}
	return flagArgs, folder
}

func (v envVarFlags) String() string {
	return ""
}

func (v envVarFlags) Set(value string) error {
	key, val, ok := strings.Cut(value, "=")
	if !ok || strings.TrimSpace(key) == "" {
		return fmt.Errorf("env-var must be KEY=VALUE")
	}
	v[strings.TrimSpace(key)] = val
	return nil
}

func executeCollection(collection collectionfs.Collection, bail bool, vars map[string]string) RunSummary {
	requests := flattenRequests(collection.Children)
	summary := RunSummary{Collection: collection.Name, Total: len(requests)}
	for _, req := range requests {
		result := executeRequest(req, vars)
		summary.Results = append(summary.Results, result)
		switch result.Outcome {
		case "passed":
			summary.Passed++
		case "failed":
			summary.Failed++
		default:
			summary.Skipped++
		}
		if bail && result.Outcome == "failed" {
			break
		}
	}
	return summary
}

func flattenRequests(nodes []collectionfs.Node) []requestNode {
	out := []requestNode{}
	for _, node := range nodes {
		if node.Type == "folder" {
			out = append(out, flattenRequests(node.Children)...)
			continue
		}
		if node.Type != "request" {
			continue
		}
		var req requestNode
		if err := json.Unmarshal(node.Raw, &req); err == nil {
			out = append(out, req)
		}
	}
	return out
}

func executeRequest(req requestNode, vars map[string]string) RequestResult {
	result := RequestResult{ID: req.ID, Name: req.Name, Method: strings.ToUpper(req.Method), URL: req.URL}
	payload, skipReason, err := requestcontract.BuildHTTPPayload(req.Request, requestcontract.Options{Vars: vars, DefaultTime: 30000})
	if skipReason != "" {
		result.Outcome = "skipped"
		result.Message = skipReason
		return result
	}
	if err != nil {
		result.Outcome = "failed"
		result.Message = err.Error()
		return result
	}
	start := time.Now()
	raw := httpexec.Execute(mustJSON(payload))
	result.Duration = time.Since(start).Milliseconds()
	var resp httpexec.HTTPExecResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		result.Outcome = "failed"
		result.Message = err.Error()
		return result
	}
	result.Status = resp.Status
	if resp.Error != nil {
		result.Outcome = "failed"
		result.Message = resp.Error.Message
		return result
	}
	if message := requestcontract.EvaluateAssertions(req.Assertions, resp); message != "" {
		result.Outcome = "failed"
		result.Message = message
		return result
	}
	result.Outcome = "passed"
	return result
}

func loadEnvironmentVars(root, envName string) (map[string]string, error) {
	vars := map[string]string{}
	if strings.TrimSpace(envName) == "" {
		return vars, nil
	}
	path := filepath.Join(root, "environments", envName+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read environment %q: %w", envName, err)
	}
	var envelope struct {
		Variables []struct {
			Key     string `json:"key"`
			Value   string `json:"value"`
			Enabled bool   `json:"enabled"`
		} `json:"variables"`
	}
	if err := json.Unmarshal(data, &envelope); err == nil && len(envelope.Variables) > 0 {
		for _, item := range envelope.Variables {
			if item.Enabled && item.Key != "" {
				vars[item.Key] = item.Value
			}
		}
		return vars, nil
	}
	var flat map[string]string
	if err := json.Unmarshal(data, &flat); err != nil {
		return nil, fmt.Errorf("decode environment %q: %w", envName, err)
	}
	for key, value := range flat {
		vars[key] = value
	}
	return vars, nil
}

func renderSummary(summary RunSummary, reporter string) ([]byte, error) {
	switch reporter {
	case "json":
		data, err := json.MarshalIndent(summary, "", "  ")
		if err != nil {
			return nil, err
		}
		return append(data, '\n'), nil
	case "cli", "":
		var b strings.Builder
		fmt.Fprintf(&b, "adOmnia run: %s\n", summary.Collection)
		for _, result := range summary.Results {
			fmt.Fprintf(&b, "- %s %s %s", result.Outcome, result.Method, result.Name)
			if result.Status != 0 {
				fmt.Fprintf(&b, " [%d]", result.Status)
			}
			if result.Message != "" {
				fmt.Fprintf(&b, " - %s", result.Message)
			}
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "summary: %d passed, %d failed, %d skipped, %d total\n", summary.Passed, summary.Failed, summary.Skipped, summary.Total)
		return []byte(b.String()), nil
	default:
		return nil, fmt.Errorf("unknown reporter %q", reporter)
	}
}

func mustJSON(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}
