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
