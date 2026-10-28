package langserver

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

// Un file aperto mentre gopls sta ancora facendo l'handshake non deve arrivargli prima di initialized:
// viene inviato una sola volta, subito dopo, con la riapertura dei documenti tracciati.
func TestDocumentsOpenedDuringHandshakeWaitForInitialized(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	manager := NewLSPManager(newLanguageRegistry())
	session := Session{ID: "s1", Project: Project{Name: "mappe", RootPath: root, RealPath: root}}
	go func() {
		// gopls è avviato (PID noto) ma initialize non ha ancora risposto.
		for manager.Status(session.ID, goID).PID == 0 {
			time.Sleep(5 * time.Millisecond)
		}
		manager.TrackDocument(session, Document{ID: "d1", URI: lsp.FileURI(root + "/main.go"), Path: root + "/main.go"}, "package main\n", false)
		_ = manager.UpdateDocument(session.ID, "d1", 2, "package main\n\nfunc main() {}\n")
	}()
	status, err := manager.Start(session, LanguageServerOptions{Language: goID, Name: "gopls", Binary: executable, Environment: append(os.Environ(), fakeGoplsEnv+"=1")})
	if err != nil {
		t.Fatalf("avvio fallito: %v (%+v)", err, status)
	}
	defer manager.Stop(session.ID, goID)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		log := strings.Join(manager.Log(session.ID, goID), "\n")
		if strings.Contains(log, "VIOLATION") {
			t.Fatalf("documento inviato prima di initialized:\n%s", log)
		}
		if strings.Contains(log, "OPENED") {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("il documento aperto durante l'handshake non è mai arrivato a gopls:\n%s", strings.Join(manager.Log(session.ID, goID), "\n"))
}
