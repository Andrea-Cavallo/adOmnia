package opencode

import (
	"context"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"adomnia/internal/jsonutil"
	"adomnia/internal/milk"
)

func TestLocalSettings(t *testing.T) {
	for _, endpoint := range []string{"https://ollama.com", "http://192.168.1.2:11434", "http://127.0.0.1:11434/v1", "http://user:password@localhost:11434", "http://localhost:11434?url=remote"} {
		if _, err := Validate(milk.Settings{Env: map[string]string{EndpointKey: endpoint}}); err == nil {
			t.Errorf("accepted non-local endpoint %s", endpoint)
		}
	}
	for _, model := range []string{"qwen:cloud", "model\nother", ""} {
		if _, err := Validate(milk.Settings{Enabled: true, Env: map[string]string{ModelKey: model}}); err == nil {
			t.Errorf("accepted invalid model %q", model)
		}
	}
	settings, err := Validate(milk.Settings{Enabled: true, SkipPermissions: true, ExtraArgs: []string{"--model=remote"}, Env: map[string]string{ModelKey: "qwen3-coder:30b", "OPENAI_API_KEY": "not-persisted"}})
	if err != nil {
		t.Fatal(err)
	}
	if settings.SkipPermissions || !settings.DisableBuiltinMCP || len(settings.ExtraArgs) != 0 || len(settings.Env) != 2 || settings.Env[EndpointKey] != DefaultEndpoint {
		t.Fatalf("invalid settings normalization: %#v", settings)
	}
}

func TestRuntimeConfigPinsBothModelsAndProvider(t *testing.T) {
	config := runtimeConfig(DefaultEndpoint, "local:test")
	raw, _ := jsonutil.Marshal(config)
	if config["model"] != "adomnia-ollama/local:test" || config["small_model"] != config["model"] || !strings.Contains(string(raw), `"enabled_providers":["adomnia-ollama"]`) {
		t.Fatalf("not restricted to local provider: %s", raw)
	}
	if config["autoupdate"] != false || config["share"] != "disabled" {
		t.Fatal("automatic sharing or updates enabled")
	}
	if config["permission"].(map[string]string)["*"] != "ask" {
		t.Fatal("tool approvals not required")
	}
}

func TestOllamaModelsAndMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/tags" {
			_, _ = w.Write([]byte(`{"models":[{"name":"local:test"},{"name":"remote:cloud"},{"name":"alias","remote_host":"https://ollama.com"}]}`))
			return
		}
		var body map[string]string
		_ = json.UnmarshalRead(r.Body, &body)
		switch body["model"] {
		case "local:test":
			_, _ = w.Write([]byte(`{"capabilities":["completion","tools"]}`))
		case "alias":
			_, _ = w.Write([]byte(`{"remote_host":"https://ollama.com","capabilities":["tools"]}`))
		case "no-tools":
			_, _ = w.Write([]byte(`{"capabilities":["completion"]}`))
		default:
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"error":"missing weights"}`))
		}
	}))
	defer server.Close()
	models, err := Models(context.Background(), server.URL)
	if err != nil || len(models) != 1 || models[0] != "local:test" {
		t.Fatalf("models=%v err=%v", models, err)
	}
	if err := CheckModel(context.Background(), server.URL, "local:test"); err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"alias", "no-tools", "broken"} {
		if err := CheckModel(context.Background(), server.URL, model); err == nil {
			t.Errorf("accepted %s", model)
		}
	}
}

func TestRejectOllamaRedirect(t *testing.T) {
	remoteHit := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { remoteHit = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer server.Close()
	if _, err := Models(context.Background(), server.URL); err == nil || remoteHit {
		t.Fatal("followed Ollama redirect")
	}
}
