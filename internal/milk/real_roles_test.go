package milk

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// roleFixture è un config di milk con tre agenti e ruoli già assegnati.
const roleFixture = `{
  "agent": "deepseek",
  "escalation_agent": "gemini",
  "agents": [
    {"name": "deepseek", "provider": "bearer", "url": "https://api.deepseek.com", "model": "deepseek-chat", "token_cmd": "echo x"},
    {"name": "gemini", "provider": "bearer", "url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.5-flash", "token_cmd": "echo x", "chat_path": "/chat/completions"},
    {"name": "mimo", "provider": "bearer", "url": "https://api.xiaomimimo.com", "model": "mimo-v2.6-flash", "token_cmd": "echo x"}
  ]
}`

func configRoles(t *testing.T, home string) (primary, escalation string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(home, ".milk", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	primary, _ = config["agent"].(string)
	escalation, _ = config["escalation_agent"].(string)
	return primary, escalation
}

// TestRealMilkRolesStick prova con il milk vero che scegliere primary o escalation resta scelto dopo il
// riavvio che adOmnia fa subito dopo. Salta se milk non è installato.
func TestRealMilkRolesStick(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	if err := os.MkdirAll(filepath.Join(home, ".milk"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".milk", "config.json"), []byte(roleFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(NewSettingsStore(t.TempDir()))
	if _, err := manager.SaveSettings(Settings{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	waitReady := func() {
		t.Helper()
		deadline := time.Now().Add(30 * time.Second)
		for manager.Status().State != StateReady {
			if state := manager.Status().State; time.Now().After(deadline) || state == StateNotInstalled || state == StateError || state == StateOutdated {
				t.Skipf("milk is not available here: %+v", manager.Status())
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	waitReady()
	defer manager.Shutdown()
	root := t.TempDir()
	manager.SetActiveWorkspace(root)

	controls, err := manager.SessionControls(root)
	if err != nil {
		t.Fatalf("controls: %v", err)
	}
	t.Logf("controls before: %d", len(controls.Controls))

	// 1. il selettore Primary agent del chat header
	after, err := manager.SetSessionControl(context.Background(), root, "_milk_agent", "mimo")
	if err != nil {
		t.Fatalf("select primary: %v", err)
	}
	for _, control := range after.Controls {
		if control.ID == "_milk_agent" {
			t.Logf("selector now shows %v", control.CurrentValue)
		}
	}
	time.Sleep(3 * time.Second)
	primary, escalation := configRoles(t, home)
	t.Logf("after selector: primary=%s escalation=%s status=%s", primary, escalation, manager.Status().State)
	if primary != "mimo" {
		t.Errorf("primary reverted to %q", primary)
	}

	// 2. il bottone Escalation del dialog (UseProvider + riavvio)
	changed, err := UseProvider("deepseek", "escalation")
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		if err := manager.Restart(); err != nil {
			t.Fatal(err)
		}
	}
	waitReady()
	time.Sleep(3 * time.Second)
	primary, escalation = configRoles(t, home)
	t.Logf("after escalation button: primary=%s escalation=%s status=%s", primary, escalation, manager.Status().State)
	if escalation != "deepseek" || primary != "mimo" {
		t.Errorf("roles changed behind our back: primary=%s escalation=%s", primary, escalation)
	}
}
