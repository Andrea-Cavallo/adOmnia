package goide

import (
	"errors"
	"testing"
	"time"
)

func TestSessionWindowOwnershipPreventsTwoEditingWindows(t *testing.T) {
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	session, err := ide.OpenProject(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)

	if owner, _ := ide.SessionWindowOwner(id); owner != MainWindowID {
		t.Fatalf("una sessione nuova appartiene alla finestra principale, non a %q", owner)
	}
	// La finestra principale può sempre ribadire la propria proprietà.
	if _, err := ide.ClaimSessionWindow(id, MainWindowID, false); err != nil {
		t.Fatal(err)
	}
	// Una seconda finestra non prende il progetto in silenzio.
	if _, err := ide.ClaimSessionWindow(id, "go-studio-1", false); !errors.Is(err, ErrSessionInOtherWindow) {
		t.Fatalf("attesa ErrSessionInOtherWindow, ottenuto %v", err)
	}
	// Spostamento esplicito: la proprietà passa e la finestra precedente viene avvisata.
	moved, err := ide.ClaimSessionWindow(id, "go-studio-1", true)
	if err != nil || moved.PreviousWindowID != MainWindowID {
		t.Fatalf("spostamento inatteso: %+v %v", moved, err)
	}
	recorder.waitFor(t, time.Second, func(event EventEnvelope) bool {
		change, ok := event.Payload.(SessionWindow)
		return ok && event.Type == "session.window-changed" && change.WindowID == "go-studio-1"
	})
	if _, err := ide.ClaimSessionWindow(id, MainWindowID, false); !errors.Is(err, ErrSessionInOtherWindow) {
		t.Fatal("la finestra principale non deve riprendersi il progetto mentre è aperto altrove")
	}
	if listed := ide.ListSessionWindows(); len(listed) != 1 || listed[0].WindowID != "go-studio-1" {
		t.Fatalf("elenco finestre inatteso: %+v", listed)
	}

	// Chiudere la finestra separata restituisce il progetto alla principale.
	if released := ide.ReleaseWindow("go-studio-1"); len(released) != 1 || released[0] != session.ID {
		t.Fatalf("sessioni rilasciate inattese: %+v", released)
	}
	if owner, _ := ide.SessionWindowOwner(id); owner != MainWindowID {
		t.Fatalf("dopo la chiusura della finestra il progetto torna alla principale, non a %q", owner)
	}
	if released := ide.ReleaseWindow(MainWindowID); released != nil {
		t.Fatal("la finestra principale non si rilascia")
	}

	// Un progetto aperto in una finestra separata non si chiude dalla principale.
	if _, err := ide.ClaimSessionWindow(id, "go-studio-2", true); err != nil {
		t.Fatal(err)
	}
	if err := ide.CloseSession(id); !errors.Is(err, ErrSessionInOtherWindow) {
		t.Fatalf("attesa ErrSessionInOtherWindow chiudendo un progetto di un'altra finestra, ottenuto %v", err)
	}
	// Tornato nella principale si chiude, e la proprietà viene dimenticata.
	ide.ReleaseWindow("go-studio-2")
	if err := ide.CloseSession(id); err != nil {
		t.Fatal(err)
	}
	if listed := ide.ListSessionWindows(); len(listed) != 0 {
		t.Fatalf("una sessione chiusa non deve restare assegnata: %+v", listed)
	}
}

func TestClaimSessionWindowValidatesInput(t *testing.T) {
	ide := NewService(&memoryStore{}, nil)
	t.Cleanup(ide.Shutdown)
	session, err := ide.OpenProject(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, windowID := range []string{"", "../x", "a b", string(make([]byte, 80))} {
		if _, err := ide.ClaimSessionWindow(string(session.ID), windowID, true); err == nil {
			t.Fatalf("finestra %q accettata", windowID)
		}
	}
	if _, err := ide.ClaimSessionWindow("missing", "go-studio-1", true); err == nil {
		t.Fatal("sessione inesistente accettata")
	}
}
