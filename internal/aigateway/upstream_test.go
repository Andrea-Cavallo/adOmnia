package main

import (
	"adomnia/internal/ai"
	"testing"
)

func TestGatewayUpstreamBaseURL(t *testing.T) {
	tests := []struct {
		name string
		cfg  ai.Config
		want string
	}{
		{"ollama default", ai.Config{Provider: ai.ProviderOllama}, "http://localhost:11434/v1"},
		{"ollama configured root", ai.Config{Provider: ai.ProviderOllama, BaseURL: "http://127.0.0.1:11434/"}, "http://127.0.0.1:11434/v1"},
		{"ollama configured v1", ai.Config{Provider: ai.ProviderOllama, BaseURL: "http://127.0.0.1:11434/v1"}, "http://127.0.0.1:11434/v1"},
		{"compatible", ai.Config{Provider: ai.ProviderOpenAICompatible, BaseURL: "http://127.0.0.1:1234/v1/"}, "http://127.0.0.1:1234/v1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := gatewayUpstreamBaseURL(tc.cfg)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("base URL = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestGatewayRejectsNonCompatibleProvider(t *testing.T) {
	if _, err := gatewayUpstreamBaseURL(ai.Config{Provider: ai.ProviderAnthropic}); err == nil {
		t.Fatal("expected unsupported provider error")
	}
}
