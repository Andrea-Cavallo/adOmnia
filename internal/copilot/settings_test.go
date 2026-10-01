package copilot

import (
	"os"
	"strings"
	"testing"
)

func TestSettingsRoundTripKeepsNoSecrets(t *testing.T) {
	store := NewSettingsStore(t.TempDir())
	settings := DefaultSettings()
	settings.Enabled = true
	settings.Profiles = append(settings.Profiles, GitHubProfile{ID: "work", Name: "Work", Host: "https://Company.ghe.com"})
	settings.WorkspaceProfiles = map[string]string{"/src/bank": "work", "/src/orphan": "missing"}
	saved, err := store.Save(settings)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Profiles[1].Host != "company.ghe.com" || saved.Profiles[1].Type != ProfileEnterpriseCloud {
		t.Fatalf("host not normalized: %+v", saved.Profiles[1])
	}
	if _, ok := saved.WorkspaceProfiles["/src/orphan"]; ok {
		t.Fatal("bindings to unknown profiles must be dropped")
	}
	loaded := store.Load()
	if got := loaded.ProfileForWorkspace("/src/bank"); got.ID != "work" {
		t.Fatalf("workspace binding lost: %+v", got)
	}
	if got := loaded.ProfileForWorkspace("/src/other"); got.ID != "personal" {
		t.Fatalf("unbound workspace must use the active profile: %+v", got)
	}
	data, _ := os.ReadFile(store.path)
	if strings.Contains(strings.ToLower(string(data)), "token") {
		t.Fatal("settings file must not contain tokens")
	}
}

func TestSettingsValidation(t *testing.T) {
	settings := DefaultSettings()
	settings.Proxy.URL = "socks://proxy"
	if _, err := settings.Validate(); err == nil {
		t.Fatal("expected invalid proxy error")
	}
	settings = DefaultSettings()
	settings.Profiles = append(settings.Profiles, DefaultProfile())
	if _, err := settings.Validate(); err == nil {
		t.Fatal("expected duplicate id error")
	}
	settings = DefaultSettings()
	settings.CABundlePath = "relative/ca.pem"
	if _, err := settings.Validate(); err == nil {
		t.Fatal("expected absolute path error")
	}
}

// Simula un riavvio: un nuovo store sulla stessa cartella dati ritrova profili GHE e binding.
func TestEnterpriseProfilesSurviveRestart(t *testing.T) {
	directory := t.TempDir()
	settings := DefaultSettings()
	settings.Profiles = append(settings.Profiles, GitHubProfile{ID: "bank", Name: "Bank", Host: "https://github.company.com/"})
	settings.ActiveProfileID = "bank"
	settings.WorkspaceProfiles = map[string]string{"/src/bank": "bank"}
	if _, err := NewSettingsStore(directory).Save(settings); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(NewSettingsStore(directory), NewInstaller(directory))
	reloaded := manager.Settings()
	profile, ok := reloaded.Profile("bank")
	if !ok || profile.Host != "github.company.com" || profile.Type != ProfileEnterpriseServer {
		t.Fatalf("GHE profile not restored: %+v", reloaded.Profiles)
	}
	if reloaded.ActiveProfileID != "bank" || reloaded.ProfileForWorkspace("/src/bank").ID != "bank" {
		t.Fatalf("active profile or workspace binding lost: %+v", reloaded)
	}
	if got := manager.Status().Profile; got.Host != "github.company.com" {
		t.Fatalf("status must expose the restored GHE host: %+v", got)
	}
}
