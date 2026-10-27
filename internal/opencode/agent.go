// Package opencode launches OpenCode over ACP with an explicitly local Ollama provider.
package opencode

import (
	"context"
	"crypto/sha256"
	"encoding/json/v2"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
)

const EndpointKey = "ADOMNIA_OLLAMA_URL"
const ModelKey = "ADOMNIA_OLLAMA_MODEL"
const DefaultEndpoint = "http://127.0.0.1:11434"

func Agent() milk.Agent {
	return milk.Agent{Name: "OpenCode", Event: "opencode", Protocol: 1, Resolve: resolve, ProjectScoped: true}
}

// Validate keeps configuration in the existing per-agent settings format. No keys or credentials.
func Validate(settings milk.Settings) (milk.Settings, error) {
	valid, err := settings.Validate()
	if err != nil {
		return valid, err
	}
	endpoint := strings.TrimRight(strings.TrimSpace(valid.Env[EndpointKey]), "/")
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" || (parsed.Hostname() != "localhost" && (net.ParseIP(parsed.Hostname()) == nil || !net.ParseIP(parsed.Hostname()).IsLoopback())) {
		return valid, fmt.Errorf("Ollama URL must be an HTTP loopback address, for example %s", DefaultEndpoint)
	}
	model := strings.TrimSpace(valid.Env[ModelKey])
	if strings.ContainsAny(model, "\x00\r\n\t ") || strings.Contains(strings.ToLower(model), "cloud") {
		return valid, fmt.Errorf("choose an installed local Ollama model, not a cloud model")
	}
	if valid.Enabled && model == "" {
		return valid, fmt.Errorf("choose an installed Ollama model before enabling OpenCode")
	}
	// Only these two non-secret settings are accepted by this adapter.
	valid.Env = map[string]string{EndpointKey: endpoint, ModelKey: model}
	valid.ExtraArgs = nil
	valid.SkipPermissions = false
	valid.DisableBuiltinMCP = true
	return valid, nil
}

func resolve(settings milk.Settings, _ string) (milk.Launch, error) {
	settings, err := Validate(settings)
	if err != nil {
		return milk.Launch{}, err
	}
	candidates := sdk.ToolSearch{Names: []string{"opencode"}, Custom: settings.BinaryPath, LookPath: exec.LookPath}.Candidates()
	if appData := os.Getenv("APPDATA"); appData != "" {
		candidates = append(candidates, sdk.ToolCandidate{Name: "opencode", Binary: filepath.Join(appData, "npm", "opencode.cmd"), Source: "npm"})
	}
	if home, err := os.UserHomeDir(); err == nil {
		for _, dir := range []string{filepath.Join(home, ".opencode", "bin"), filepath.Join(home, ".local", "bin")} {
			candidates = append(candidates, sdk.ToolCandidate{Name: "opencode", Binary: filepath.Join(dir, sdk.ExecutableName("opencode")), Source: dir})
		}
	}
	found, ok := sdk.Locate(candidates, "OpenCode executable not found", func(sdk.ToolCandidate) (string, error) { return "", nil })
	if !ok || found.Error != "" {
		return milk.Launch{}, milk.NotInstalled("OpenCode is not installed. Install it from opencode.ai or choose its executable. No download was attempted")
	}
	model := settings.Env[ModelKey]
	if model == "" {
		return milk.Launch{}, fmt.Errorf("choose an installed Ollama model in OpenCode settings")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	if err := CheckModel(ctx, settings.Env[EndpointKey], model); err != nil {
		return milk.Launch{Binary: found.Binary}, err
	}
	config := runtimeConfig(settings.Env[EndpointKey], model)
	raw, err := jsonutil.Marshal(config)
	if err != nil {
		return milk.Launch{}, err
	}
	env := os.Environ()
	for name, value := range map[string]string{
		"OPENCODE_CONFIG_CONTENT":          string(raw),
		"OPENCODE_DISABLE_AUTOUPDATE":      "true",
		"OPENCODE_DISABLE_MODELS_FETCH":    "true",
		"OPENCODE_DISABLE_DEFAULT_PLUGINS": "true",
		"OPENCODE_DISABLE_LSP_DOWNLOAD":    "true",
		"OPENCODE_DISABLE_TELEMETRY":       "true",
		"DO_NOT_TRACK":                     "1",
		"OPENCODE_PERMISSION":              `{"*":"ask","read":"allow","glob":"allow","grep":"allow","list":"allow","webfetch":"deny","websearch":"deny"}`,
	} {
		env = replaceEnv(env, name, value)
	}
	return milk.Launch{Binary: found.Binary, Args: []string{"acp"}, Env: env, Key: fmt.Sprintf("%x", sha256.Sum256(append([]byte(found.Binary), raw...)))}, nil
}

// CheckModel reads metadata without loading weights or downloading anything. Tags alone may be stale.
func CheckModel(ctx context.Context, endpoint, model string) error {
	settings, err := Validate(milk.Settings{Enabled: true, Env: map[string]string{EndpointKey: endpoint, ModelKey: model}})
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return fmt.Errorf("Ollama redirects are not allowed") }}
	defer client.CloseIdleConnections()
	body, _ := jsonutil.Marshal(map[string]string{"model": settings.Env[ModelKey]})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, settings.Env[EndpointKey]+"/api/show", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("cannot connect to local Ollama: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Ollama cannot read model %q (HTTP %d). Its files may be missing; repair or reinstall the model in Ollama, then retry", model, response.StatusCode)
	}
	var info struct {
		RemoteHost   string   `json:"remote_host"`
		RemoteModel  string   `json:"remote_model"`
		Capabilities []string `json:"capabilities"`
	}
	if err := json.UnmarshalRead(io.LimitReader(response.Body, 2<<20), &info); err != nil {
		return fmt.Errorf("invalid Ollama model metadata: %w", err)
	}
	if info.RemoteHost != "" || info.RemoteModel != "" {
		return fmt.Errorf("cloud-backed Ollama models are not supported by this local integration")
	}
	if slices.Contains(info.Capabilities, "tools") {
		return nil
	}
	return fmt.Errorf("model %q does not report tool-calling support; choose a model with tools support in Ollama", model)
}

func runtimeConfig(endpoint, model string) map[string]any {
	return map[string]any{
		"enabled_providers": []string{"adomnia-ollama"},
		"model":             "adomnia-ollama/" + model, "small_model": "adomnia-ollama/" + model,
		"autoupdate": false, "share": "disabled", "lsp": false, "formatter": false,
		"permission": map[string]string{"*": "ask", "read": "allow", "glob": "allow", "grep": "allow", "list": "allow", "webfetch": "deny", "websearch": "deny"},
		"provider": map[string]any{"adomnia-ollama": map[string]any{
			"npm": "@ai-sdk/openai-compatible", "name": "Ollama (local)",
			"options": map[string]any{"baseURL": endpoint + "/v1"},
			"models":  map[string]any{model: map[string]any{"name": model, "tool_call": true}},
		}},
	}
}

func replaceEnv(env []string, name, value string) []string {
	out := make([]string, 0, len(env)+1)
	for _, item := range env {
		key, _, _ := strings.Cut(item, "=")
		if !strings.EqualFold(key, name) {
			out = append(out, item)
		}
	}
	return append(out, name+"="+value)
}

// Models lists installed tags only. Redirects and proxies cannot move this request off loopback.
func Models(ctx context.Context, endpoint string) ([]string, error) {
	settings, err := Validate(milk.Settings{Env: map[string]string{EndpointKey: endpoint}})
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return fmt.Errorf("Ollama redirects are not allowed") }}
	defer client.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, settings.Env[EndpointKey]+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cannot connect to local Ollama: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Ollama returned HTTP %d", response.StatusCode)
	}
	var result struct {
		Models []struct {
			Name        string `json:"name"`
			RemoteHost  string `json:"remote_host"`
			RemoteModel string `json:"remote_model"`
		} `json:"models"`
	}
	if err := json.UnmarshalRead(io.LimitReader(response.Body, 2<<20), &result); err != nil {
		return nil, fmt.Errorf("invalid Ollama model list: %w", err)
	}
	models := []string{}
	for _, model := range result.Models {
		if model.Name != "" && model.RemoteHost == "" && model.RemoteModel == "" && !strings.Contains(strings.ToLower(model.Name), "cloud") {
			models = append(models, model.Name)
		}
	}
	return models, nil
}
