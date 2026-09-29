package goidewindow

import "testing"

func TestWindowIDForIsStableAndSafe(t *testing.T) {
	id, err := WindowIDFor("session-0a1b2c")
	if err != nil || id != "go-studio-session-0a1b2c" {
		t.Fatalf("identificativo inatteso: %q %v", id, err)
	}
	for _, sessionID := range []string{"", "../x", "a b", "s?x=1", "s/1"} {
		if _, err := WindowIDFor(sessionID); err == nil {
			t.Fatalf("sessione %q accettata", sessionID)
		}
	}
}

func TestManagerWithoutDesktopFailsCleanly(t *testing.T) {
	manager := New(nil, nil)
	if _, err := manager.Open("session-1", "demo"); err == nil {
		t.Fatal("senza runtime desktop Open deve fallire")
	}
	if err := manager.Focus("go-studio-session-1"); err == nil {
		t.Fatal("Focus su finestra inesistente deve fallire")
	}
	if err := manager.ConfirmClose("go-studio-session-1"); err == nil {
		t.Fatal("ConfirmClose su finestra inesistente deve fallire")
	}
	if _, _, dirty := manager.FirstDirty(); dirty {
		t.Fatal("nessuna finestra, nessun buffer non salvato")
	}
	manager.SetDirtyCount("go-studio-session-1", 3)
	manager.CloseAll()
}
