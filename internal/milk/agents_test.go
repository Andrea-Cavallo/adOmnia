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

	if changed, err := UseProvider("deepseek", "primary"); err != nil || !changed {
		t.Fatalf("the first assignment must change the config: changed=%v err=%v", changed, err)
	}
	if changed, err := UseProvider("deepseek", "escalation"); err != nil || !changed {
		t.Fatalf("the escalation assignment must change the config: changed=%v err=%v", changed, err)
	}
	if changed, err := UseProvider("deepseek", "escalation"); err != nil || changed {
		t.Fatalf("the same agent and role must not rewrite the config: changed=%v err=%v", changed, err)
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
	if _, err := UseProvider("openai", "primary"); err == nil {
		t.Fatal("a provider without its env variable must be refused")
	}
}

// writeRoleConfig scrive un config con deepseek primario e gemini escalation, la cui chiave è letta da GEMINI_API_KEY.
func writeRoleConfig(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	path := filepath.Join(home, ".milk", "config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	config := `{"agent":"deepseek","escalation_agent":"gemini","agents":[
	 {"name":"deepseek","provider":"bearer","model":"deepseek-chat","token_cmd":"printf %s \"$DEEPSEEK_API_KEY\""},
	 {"name":"gemini","provider":"bearer","model":"gemini-2.5-flash","token_cmd":"printf %s \"$GEMINI_API_KEY\""},
	 {"name":"local","provider":"local","model":"qwen"}]}`
	if err := os.WriteFile(path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAgentsFlagsAnAgentWhoseKeyVariableIsUnset(t *testing.T) {
	writeRoleConfig(t)
	t.Setenv("DEEPSEEK_API_KEY", "x")
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("GOOGLE_GENERATIVE_AI_API_KEY", "set-under-another-name")

	info, err := Agents()
	if err != nil {
		t.Fatal(err)
	}
	usable := map[string]AgentStatus{}
	for _, agent := range info.Agents {
		usable[agent.Name] = agent
	}
	if !usable["deepseek"].Usable || !usable["local"].Usable {
		t.Fatalf("deepseek (key set) and local (no key needed) must be usable: %+v", info.Agents)
	}
	if gemini := usable["gemini"]; gemini.Usable || gemini.MissingEnvVar != "GEMINI_API_KEY" {
		t.Fatalf("gemini reads an unset variable and must be unusable: %+v", gemini)
	}
	if len(info.Warnings) != 1 || !strings.Contains(info.Warnings[0], "escalation") || !strings.Contains(info.Warnings[0], "GEMINI_API_KEY") {
		t.Fatalf("the unusable escalation agent must be reported once: %v", info.Warnings)
	}
}

func TestSelectingAnAgentWithoutItsKeyIsRefusedAndLabelled(t *testing.T) {
	path := writeRoleConfig(t)
	t.Setenv("DEEPSEEK_API_KEY", "x")
	t.Setenv("GEMINI_API_KEY", "")

	if _, err := selectConfiguredAgent("gemini"); err == nil || !strings.Contains(err.Error(), "GEMINI_API_KEY") {
		t.Fatalf("an agent without its key must not become primary, got %v", err)
	}
	if data, _ := os.ReadFile(path); !strings.Contains(string(data), `"agent":"deepseek"`) {
		t.Fatalf("the refused choice must leave the config untouched: %s", data)
	}
	control, err := configuredAgentControl()
	if err != nil {
		t.Fatal(err)
	}
	labels := map[string]string{}
	for _, option := range control.Options {
		labels[option.Value] = option.Name
	}
	if !strings.Contains(labels["gemini"], "key missing") || strings.Contains(labels["deepseek"], "key missing") {
		t.Fatalf("only the agent without a key is labelled: %v", labels)
	}
}

func TestUseProviderRepairsTheKeyVariableOfAnExistingAgent(t *testing.T) {
	path := writeRoleConfig(t)
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("GOOGLE_API_KEY", "")
	t.Setenv("GOOGLE_GENERATIVE_AI_API_KEY", "set-under-another-name")

	// gemini è già escalation, ma il suo token_cmd legge una variabile che non c'è: riassegnarlo lo ripara.
	changed, err := UseProvider("gemini", "escalation")
	if err != nil || !changed {
		t.Fatalf("the broken credential must be repaired: changed=%v err=%v", changed, err)
	}
	data, _ := os.ReadFile(path)
	text := string(data)
	if !strings.Contains(text, "GOOGLE_GENERATIVE_AI_API_KEY") || strings.Contains(text, "$GEMINI_API_KEY") && !strings.Contains(text, "GOOGLE_GENERATIVE_AI_API_KEY") {
		t.Fatalf("token_cmd must now read the detected variable: %s", text)
	}
	if again, err := UseProvider("gemini", "escalation"); err != nil || again {
		t.Fatalf("a repaired agent must not be rewritten again: changed=%v err=%v", again, err)
	}
}
