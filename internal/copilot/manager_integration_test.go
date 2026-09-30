package copilot

import (
	"os"
	"testing"
)

// TestRealLanguageServerStartsSignedOut avvia il Copilot Language Server ufficiale indicato da
// ADOMNIA_COPILOT_LS e verifica che, senza account, arrivi allo stato "signed-out" (non errore).
func TestRealLanguageServerStartsSignedOut(t *testing.T) {
	binary := os.Getenv("ADOMNIA_COPILOT_LS")
	if binary == "" {
		t.Skip("set ADOMNIA_COPILOT_LS to the official copilot-language-server binary")
	}
	directory := t.TempDir()
	store := NewSettingsStore(directory)
	settings := DefaultSettings()
	settings.Enabled = true
	settings.BinaryPath = binary
	if _, err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(store, NewInstaller(directory))
	t.Cleanup(manager.Shutdown)
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return manager.Status().State == StateSignedOut }, "signed-out state from the real server")
	if status := manager.Status(); status.ServerVersion == "" || status.Profile.Host != "github.com" {
		t.Fatalf("unexpected status: %+v", status)
	}
}
