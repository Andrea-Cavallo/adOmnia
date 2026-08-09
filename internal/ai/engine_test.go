package ai

import (
	"strings"
	"testing"
)

func TestBuildProvider_KnownProviders(t *testing.T) {
	cases := []struct {
		name     string
		cfg      Config
		wantName string
	}{
		{"anthropic", Config{Provider: ProviderAnthropic, Model: "claude-sonnet-5", APIKey: "k"}, "anthropic"},
		{"openai", Config{Provider: ProviderOpenAI, Model: "gpt-5.6-terra", APIKey: "k"}, "openai"},
		{"gemini", Config{Provider: ProviderGemini, Model: "gemini-3.5-flash", APIKey: "k"}, "gemini"},
		{"ollama", Config{Provider: ProviderOllama, Model: "qwen3.5"}, "ollama"},
		{"huggingface", Config{Provider: ProviderHuggingFace, Model: "openai/gpt-oss-120b", APIKey: "k"}, "openai"},
		{"openai-compatible", Config{Provider: ProviderOpenAICompatible, Model: "local-model"}, "openai"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := buildProvider(tc.cfg)
			if err != nil {
				t.Fatalf("buildProvider(%s): %v", tc.name, err)
			}
			if p == nil {
				t.Fatalf("buildProvider(%s) returned nil provider", tc.name)
			}
			if got := p.Name(); got != tc.wantName {
				t.Fatalf("provider name = %q, want %q", got, tc.wantName)
			}
		})
	}
}

func TestBuildProvider_UnknownProvider(t *testing.T) {
	_, err := buildProvider(Config{Provider: "does-not-exist"})
	if err == nil {
		t.Fatalf("expected error for unknown provider, got nil")
	}
	if !strings.Contains(err.Error(), "unknown provider") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildProvider_DefaultBaseURLs(t *testing.T) {
	// OpenAI and Ollama fill in default base URLs when none is supplied.
	if _, err := buildProvider(Config{Provider: ProviderOpenAI, APIKey: "k"}); err != nil {
		t.Fatalf("openai default base url: %v", err)
	}
	if _, err := buildProvider(Config{Provider: ProviderOllama}); err != nil {
		t.Fatalf("ollama default base url: %v", err)
	}
}

func TestNew_PropagatesUnknownProviderError(t *testing.T) {
	if _, err := New(Config{Provider: "nope"}); err == nil {
		t.Fatalf("expected New to propagate provider error")
	}
}
