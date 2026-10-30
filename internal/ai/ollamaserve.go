package ai

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

var ollamaModelName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/:-]{0,199}$`)

// errOllamaMissing tells the UI to offer the download page instead of a retry.
var errOllamaMissing = errors.New("Ollama is not installed. Download it from ollama.com, then press Connect again")

type ollamaRequest struct {
	Endpoint string `json:"endpoint"`
	Model    string `json:"model"`
}

// ollamaBase turns the OpenAI-compatible endpoint (http://localhost:11434/v1) into the native API root.
func ollamaBase(raw string) (string, error) {
	endpoint, err := localEndpoint(raw)
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(endpoint, "/v1"), nil
}

func ollamaReachable(ctx context.Context, base string) bool {
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/version", nil)
	if err != nil {
		return false
	}
	response, err := netpolicy.Client("ai", 0).Do(request)
	if err != nil {
		return false
	}
	_ = response.Body.Close() // best effort: only the status matters
	return response.StatusCode == http.StatusOK
}

func locateOllama() (string, error) {
	candidates := sdk.ToolSearch{Names: []string{"ollama"}, LookPath: exec.LookPath}.Candidates()
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		candidates = append(candidates, sdk.ToolCandidate{Name: "ollama", Binary: filepath.Join(local, "Programs", "Ollama", "ollama.exe"), Source: "installer"})
	}
	candidates = append(candidates, sdk.ToolCandidate{Name: "ollama", Binary: "/usr/local/bin/ollama", Source: "installer"}, sdk.ToolCandidate{Name: "ollama", Binary: "/Applications/Ollama.app/Contents/Resources/ollama", Source: "installer"})
	found, ok := sdk.Locate(candidates, "ollama not found", func(sdk.ToolCandidate) (string, error) { return "", nil })
	if !ok || found.Error != "" {
		return "", errOllamaMissing
	}
	return found.Binary, nil
}

// EnsureOllama starts `ollama serve` in the background when nothing answers on the endpoint,
// so the user never has to open a terminal. It returns true when this call started the server.
func EnsureOllama(ctx context.Context, endpoint string) (bool, error) {
	base, err := ollamaBase(endpoint)
	if err != nil {
		return false, err
	}
	if ollamaReachable(ctx, base) {
		return false, nil
	}
	binary, err := locateOllama()
	if err != nil {
		return false, err
	}
	command := procutil.Command(binary, "serve")
	command.Env = append(os.Environ(), "OLLAMA_HOST="+strings.TrimPrefix(strings.TrimPrefix(base, "http://"), "https://"))
	if err := command.Start(); err != nil {
		return false, fmt.Errorf("could not start Ollama: %w", err)
	}
	// ponytail: the server outlives adOmnia, exactly like a manual `ollama serve`; the tray app behaves the same.
	go func() { _ = command.Wait() }() // reap only; the exit status is irrelevant once it is serving
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if ollamaReachable(ctx, base) {
			return true, nil
		}
		select {
		case <-ctx.Done():
			return true, ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
	}
	return true, errors.New("Ollama started but did not answer within 20 seconds")
}

func decodeOllamaRequest(w http.ResponseWriter, r *http.Request) (ollamaRequest, bool) {
	var input ollamaRequest
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return input, false
	}
	if err := json.UnmarshalRead(http.MaxBytesReader(w, r.Body, 4096), &input); err != nil {
		http.Error(w, "invalid Ollama request", http.StatusBadRequest)
		return input, false
	}
	return input, true
}

// OllamaStartHandler runs behind the sidecar's origin and token checks, like LocalChatHandler.
func OllamaStartHandler(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeOllamaRequest(w, r)
	if !ok {
		return
	}
	started, err := EnsureOllama(r.Context(), input.Endpoint)
	if errors.Is(err, errOllamaMissing) {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.MarshalWrite(w, map[string]bool{"started": started})
}

// OllamaPullHandler streams Ollama's NDJSON pull progress to the chat (the `ollama pull` of the UI).
func OllamaPullHandler(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeOllamaRequest(w, r)
	if !ok {
		return
	}
	if !ollamaModelName.MatchString(input.Model) {
		http.Error(w, "invalid model name", http.StatusBadRequest)
		return
	}
	base, err := ollamaBase(input.Endpoint)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Hour)
	defer cancel()
	body, err := json.Marshal(map[string]any{"model": input.Model, "stream": true})
	if err != nil {
		http.Error(w, "invalid model name", http.StatusBadRequest)
		return
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/pull", bytes.NewReader(body))
	if err != nil {
		http.Error(w, "invalid Ollama endpoint", http.StatusBadRequest)
		return
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := netpolicy.Client("ai", 0).Do(request)
	if err != nil {
		http.Error(w, "Cannot reach Ollama. Press Connect first.", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		http.Error(w, fmt.Sprintf("Ollama returned %d: %s", response.StatusCode, message), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	controller := http.NewResponseController(w)
	buffer := make([]byte, 4096)
	for {
		n, readErr := response.Body.Read(buffer)
		if n > 0 {
			if _, err := w.Write(buffer[:n]); err != nil {
				return
			}
			_ = controller.Flush()
		}
		if readErr != nil {
			return
		}
	}
}
