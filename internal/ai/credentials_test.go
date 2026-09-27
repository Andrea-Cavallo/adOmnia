package ai

import (
	"os"
	"path/filepath"
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

func TestResolveEnvironmentCredentialsAutoPrefersEnvironmentOverStoredCredential(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "local-openai-key")
	cfg, err := ResolveEnvironmentCredentials(Config{
		Provider:       ProviderOpenAI,
		APIKey:         "vault:locked-local-copy",
		CredentialMode: CredentialModeAuto,
	})
	if err != nil {
		t.Fatalf("ResolveEnvironmentCredentials() error = %v", err)
	}
	if cfg.APIKey != "local-openai-key" {
		t.Fatalf("APIKey = %q, want environment credential without requiring Vault", cfg.APIKey)
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

func TestResolveEnvironmentCredentialsDelegatesBedrockToAWSChain(t *testing.T) {
	cfg, err := ResolveEnvironmentCredentials(Config{
		Provider:   ProviderAmazonBedrock,
		AWSRegion:  "eu-west-1",
		AWSProfile: "company-sso",
	})
	if err != nil {
		t.Fatalf("ResolveEnvironmentCredentials() error = %v", err)
	}
	if cfg.APIKey != "" || cfg.AWSProfile != "company-sso" {
		t.Fatalf("Bedrock config was unexpectedly modified: %+v", cfg)
	}
}

func TestResolveDotEnvCredentialUsesStandardFilesWithoutScanningArbitraryFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env.local"), []byte("DEEPSEEK_API_KEY=from-dotenv\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("DEEPSEEK_API_KEY=must-not-be-read\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	value, source := resolveDotEnvCredential(dir, []string{"DEEPSEEK_API_KEY"})
	if value != "from-dotenv" {
		t.Fatalf("value = %q, want dotenv credential", value)
	}
	if !strings.HasSuffix(filepath.ToSlash(source), "/.env.local") {
		t.Fatalf("source = %q, want .env.local", source)
	}
}

func TestResolveEnvironmentCredentialsSupportsDeepSeek(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "deepseek-key")
	cfg, err := ResolveEnvironmentCredentials(Config{Provider: ProviderDeepSeek, CredentialMode: CredentialModeAuto})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.APIKey != "deepseek-key" {
		t.Fatalf("APIKey = %q, want DeepSeek environment key", cfg.APIKey)
	}
}
