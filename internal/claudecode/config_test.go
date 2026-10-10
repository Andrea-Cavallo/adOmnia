package claudecode

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeSettings(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestInspectFollowsSettingsPrecedenceAndHidesSecrets(t *testing.T) {
	home, root := t.TempDir(), t.TempDir()
	env := map[string]string{"CLAUDE_CONFIG_DIR": home, "ANTHROPIC_API_KEY": "sk-secret", "HTTPS_PROXY": "http://user:pw@proxy.corp:8080"}
	getenv := func(name string) string { return env[name] }
	writeSettings(t, filepath.Join(home, "settings.json"), `{"env":{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1","AWS_PROFILE":"dev"},"awsAuthRefresh":"aws sso login"}`)
	writeSettings(t, filepath.Join(root, ".claude", "settings.json"), `{"env":{"AWS_REGION":"eu-west-1"}}`)
	writeSettings(t, filepath.Join(root, ".claude", "settings.local.json"), `{"env":{"ANTHROPIC_MODEL":"eu.anthropic.claude-sonnet-4-5-v1:0","AWS_PROFILE":"prod"}}`)

	config := inspect(root, false, getenv)
	if config.Provider != "bedrock" || config.Region != "eu-west-1" || config.Profile != "prod" {
		t.Fatalf("local > project > user precedence broken: %+v", config)
	}
	if !strings.HasPrefix(config.Model, "eu.anthropic.claude-sonnet-4-5-v1:0 (local settings)") {
		t.Fatalf("model: %q", config.Model)
	}
	if len(config.Helpers) != 1 || !strings.HasPrefix(config.Helpers[0], "awsAuthRefresh") {
		t.Fatalf("helpers: %v", config.Helpers)
	}
	for _, variable := range config.Variables {
		if strings.Contains(variable.Value, "sk-secret") || strings.Contains(variable.Value, "pw") {
			t.Fatalf("secret leaked: %+v", variable)
		}
	}
	if len(config.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", config.Warnings)
	}
}

func TestInspectWarnsAboutIncompleteEnterpriseSetups(t *testing.T) {
	home, root := t.TempDir(), t.TempDir()
	getenv := func(name string) string {
		return map[string]string{"CLAUDE_CONFIG_DIR": home, "ANTHROPIC_API_KEY": "sk"}[name]
	}
	writeSettings(t, filepath.Join(home, "settings.json"), `{"env":{"CLAUDE_CODE_USE_BEDROCK":true}}`)
	writeSettings(t, filepath.Join(root, ".claude", "settings.local.json"), `{broken`)
	config := inspect(root, true, getenv)
	if config.Provider != "bedrock" || len(config.Warnings) != 2 {
		t.Fatalf("want missing-region and invalid-JSON warnings: %+v", config.Warnings)
	}
	for _, variable := range config.Variables {
		if variable.Name == apiKeyVar {
			t.Fatal("an ignored API key must not be reported as in use")
		}
	}
	if account := inspect(t.TempDir(), true, func(name string) string { return map[string]string{"CLAUDE_CONFIG_DIR": t.TempDir()}[name] }); account.Provider != "account" {
		t.Fatalf("no settings = claude login: %+v", account)
	}
}

func TestLiftedEnvGivesTheAdapterTheSettingsModel(t *testing.T) {
	home, root := t.TempDir(), t.TempDir()
	getenv := func(name string) string { return map[string]string{"CLAUDE_CONFIG_DIR": home}[name] }
	writeSettings(t, filepath.Join(home, "settings.json"), `{"env":{"ANTHROPIC_MODEL":"user-model","OTHER":"x"}}`)
	writeSettings(t, filepath.Join(root, ".claude", "settings.local.json"), `{"env":{"ANTHROPIC_MODEL":"local-model"}}`)
	if lifted := liftedEnv(root, getenv); lifted["ANTHROPIC_MODEL"] != "local-model" || len(lifted) != 1 {
		t.Fatalf("lifted: %v", lifted)
	}
	if lifted := liftedEnv(t.TempDir(), getenv); lifted["ANTHROPIC_MODEL"] != "user-model" {
		t.Fatalf("user settings apply to every project: %v", lifted)
	}
}
