package milk

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUseProviderAddsEnvAgentWithoutWritingTheKey(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("DEEPSEEK_API_KEY", "sk-secret-value")
	path := filepath.Join(home, ".milk", "config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"agent":"ciao","agents":[{"name":"ciao","provider":"local"}],"otel":{"enabled":true}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := UseProvider("deepseek", "primary"); err != nil {
		t.Fatal(err)
	}
	if err := UseProvider("deepseek", "escalation"); err != nil { // già presente: non duplicato
		t.Fatal(err)
	}

	data, _ := os.ReadFile(path)
	text := string(data)
	if strings.Contains(text, "sk-secret-value") {
		t.Fatal("the key value must never be written to milk's config")
	}
	if strings.Count(text, `"name": "deepseek"`) != 1 || !strings.Contains(text, "DEEPSEEK_API_KEY") || !strings.Contains(text, `"otel"`) {
		t.Fatalf("unexpected config: %s", text)
	}
	info, err := Agents()
	if err != nil {
		t.Fatal(err)
	}
	if info.Primary != "deepseek" || info.Escalation != "deepseek" {
		t.Fatalf("roles not set: %+v", info)
	}
	for _, provider := range info.Providers {
		if provider.ID == "deepseek" && (!provider.Detected || !provider.Configured) {
			t.Fatalf("deepseek should be detected and configured: %+v", provider)
		}
	}

	t.Setenv("OPENAI_API_KEY", "")
	if err := UseProvider("openai", "primary"); err == nil {
		t.Fatal("a provider without its env variable must be refused")
	}
}
