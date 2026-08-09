package ai

import (
	"strings"
	"testing"
)

func TestResolveEnvironmentCredentialsUsesProviderVariable(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "local-openai-key")
	cfg, err := ResolveEnvironmentCredentials(Config{
		Provider:       ProviderOpenAI,
		CredentialMode: CredentialModeEnvironment,
	})
	if err != nil {
		t.Fatalf("ResolveEnvironmentCredentials() error = %v", err)
	}
	if cfg.APIKey != "local-openai-key" {
		t.Fatalf("APIKey = %q, want provider environment value", cfg.APIKey)
	}
}

func TestResolveEnvironmentCredentialsUsesFallbackVariable(t *testing.T) {
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("GOOGLE_API_KEY", "")
	t.Setenv("ADOMNIA_AI_API_KEY", "local-fallback-key")
	cfg, err := ResolveEnvironmentCredentials(Config{
		Provider:       ProviderGemini,
		CredentialMode: CredentialModeEnvironment,
	})
	if err != nil {
		t.Fatalf("ResolveEnvironmentCredentials() error = %v", err)
	}
	if cfg.APIKey != "local-fallback-key" {
		t.Fatalf("APIKey = %q, want fallback environment value", cfg.APIKey)
	}
}

func TestResolveEnvironmentCredentialsReportsMissingRequiredKey(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("ADOMNIA_AI_API_KEY", "")
	_, err := ResolveEnvironmentCredentials(Config{
		Provider:       ProviderAnthropic,
		CredentialMode: CredentialModeEnvironment,
	})
	if err == nil || !strings.Contains(err.Error(), "ANTHROPIC_API_KEY") {
		t.Fatalf("missing key error = %v, want variable hint", err)
	}
}

func TestResolveEnvironmentCredentialsAllowsUnauthenticatedCompatibleRuntime(t *testing.T) {
	t.Setenv("OPENAI_COMPATIBLE_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ADOMNIA_AI_API_KEY", "")
	cfg, err := ResolveEnvironmentCredentials(Config{
		Provider:       ProviderOpenAICompatible,
		CredentialMode: CredentialModeEnvironment,
		APIKey:         "must not be used",
	})
	if err != nil {
		t.Fatalf("ResolveEnvironmentCredentials() error = %v", err)
	}
	if cfg.APIKey != "" {
		t.Fatalf("APIKey = %q, want empty for an unauthenticated runtime", cfg.APIKey)
	}
}
