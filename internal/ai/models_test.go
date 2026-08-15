package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDiscoverModelsOllama(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/tags" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"models":[{"name":"qwen3-coder:latest","model":"qwen3-coder:latest","details":{"parameter_size":"30B"}}]}`))
	}))
	defer server.Close()

	models, err := DiscoverModels(context.Background(), Config{Provider: ProviderOllama, BaseURL: server.URL}, "coder")
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID != "qwen3-coder:latest" || !models[0].Local {
		t.Fatalf("unexpected models: %#v", models)
	}
}

func TestDiscoverModelsOpenAICompatibleFiltersQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"local/qwen-coder","owned_by":"local"},{"id":"local/gemma","owned_by":"local"}]}`))
	}))
	defer server.Close()

	models, err := DiscoverModels(context.Background(), Config{Provider: ProviderOpenAICompatible, BaseURL: server.URL + "/v1"}, "qwen")
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID != "local/qwen-coder" || !models[0].Local {
		t.Fatalf("unexpected models: %#v", models)
	}
}

func TestDiscoverModelsAnthropicUsesModelsAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" || r.Header.Get("x-api-key") != "test-key" || r.Header.Get("anthropic-version") == "" {
			t.Fatalf("unexpected Anthropic discovery request: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"claude-sonnet-test","display_name":"Claude Sonnet Test"}]}`))
	}))
	defer server.Close()

	models, err := DiscoverModels(context.Background(), Config{Provider: ProviderAnthropic, APIKey: "test-key", BaseURL: server.URL}, "sonnet")
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID != "claude-sonnet-test" || models[0].Name != "Claude Sonnet Test" {
		t.Fatalf("unexpected models: %#v", models)
	}
}

func TestDiscoverModelsGeminiPreservesCapabilities(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" || r.Header.Get("x-goog-api-key") != "test-key" {
			t.Fatalf("unexpected Gemini discovery request: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"models":[{"name":"models/gemini-test","displayName":"Gemini Test","inputTokenLimit":1000000,"outputTokenLimit":8192,"supportedGenerationMethods":["generateContent"],"thinking":true}]}`))
	}))
	defer server.Close()

	models, err := DiscoverModels(context.Background(), Config{Provider: ProviderGemini, APIKey: "test-key", BaseURL: server.URL}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID != "gemini-test" || models[0].Context != 1_000_000 || !models[0].SupportsThinking || len(models[0].Capabilities) != 1 {
		t.Fatalf("unexpected models: %#v", models)
	}
}
