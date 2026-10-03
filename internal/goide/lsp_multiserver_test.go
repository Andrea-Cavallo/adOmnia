package goide

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/language"
	"adomnia/internal/languages/golang"
)

func TestWorkspaceSymbolsPreservesHealthyServerResults(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	registry := language.NewRegistry()
	for _, adapter := range []language.Language{golang.New(), fakeTextLanguage{}} {
		if err := registry.Register(adapter); err != nil {
			t.Fatal(err)
		}
	}
	manager := NewLSPManager(registry)
	root := t.TempDir()
	t.Cleanup(manager.Shutdown)
	session := Session{ID: "symbols", Project: Project{RootPath: root, RealPath: root}}
	for _, id := range []string{golang.ID, "text"} {
		env := append(os.Environ(), fakeGoplsEnv+"=1", "ADOMNIA_FAKE_LSP_ROOT="+root)
		if id == golang.ID {
			env = append(env, "ADOMNIA_FAKE_LSP_SLOW=1")
		}
		_, err := manager.Start(session, LanguageServerOptions{Language: id, Binary: executable, Arguments: []string{"--stdio-marker"}, Environment: env})
		if err != nil {
			t.Fatal(err)
		}
		waitForLog(t, manager, session.ID, id, "ARGS --stdio-marker")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	symbols, err := manager.WorkspaceSymbols(ctx, session.ID, "Healthy")
	if err != nil || len(symbols) != 1 || symbols[0].Name != "HealthySymbol" {
		t.Fatalf("healthy server results lost: %+v, %v", symbols, err)
	}
}

// fakeTextLanguage è un secondo linguaggio fittizio: dimostra che il manager LSP non è cablato su Go.
type fakeTextLanguage struct{}

func (fakeTextLanguage) ID() string   { return "text" }
func (fakeTextLanguage) Name() string { return "Text" }
func (fakeTextLanguage) DocumentLanguageID(path string) (string, bool) {
	return "plaintext", strings.EqualFold(filepath.Ext(path), ".txt")
}

func waitForLog(t *testing.T, manager *LSPManager, sessionID SessionID, languageID, wanted string) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		log := strings.Join(manager.Log(sessionID, languageID), "\n")
		if strings.Contains(log, wanted) {
			return log
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("%s: %q non arrivato:\n%s", languageID, wanted, strings.Join(manager.Log(sessionID, languageID), "\n"))
	return ""
}

// Due linguaggi nella stessa sessione hanno due server indipendenti: ogni documento va solo al
// server del proprio linguaggio, e fermarne uno non tocca l'altro.
func TestLanguageServersArePerLanguageWithinASession(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	registry := language.NewRegistry()
	for _, adapter := range []language.Language{golang.New(), fakeTextLanguage{}} {
		if err := registry.Register(adapter); err != nil {
			t.Fatal(err)
		}
	}
	manager := NewLSPManager(registry)
	t.Cleanup(manager.Shutdown)
	root := t.TempDir()
	session := Session{ID: "multi", Project: Project{Name: "mono", RootPath: root, RealPath: root}}
	environment := append(os.Environ(), fakeGoplsEnv+"=1")
	for _, options := range []LanguageServerOptions{
		{Language: golang.ID, Name: "gopls", Binary: executable, Environment: environment},
		{Language: "text", Name: "text-ls", Binary: executable, Environment: environment},
	} {
		if status, err := manager.Start(session, options); err != nil || status.State != LanguageServerReady || status.Language != options.Language {
			t.Fatalf("%s: %v %+v", options.Language, err, status)
		}
	}

	goURI, textURI := fileURI(filepath.Join(root, "main.go")), fileURI(filepath.Join(root, "notes.txt"))
	manager.TrackDocument(session, Document{ID: "go", URI: goURI, Path: filepath.Join(root, "main.go")}, "package main\n", false)
	manager.TrackDocument(session, Document{ID: "txt", URI: textURI, Path: filepath.Join(root, "notes.txt")}, "hello\n", false)
	manager.TrackDocument(session, Document{ID: "png", URI: fileURI(filepath.Join(root, "logo.png")), Path: filepath.Join(root, "logo.png")}, "", false)

	if log := waitForLog(t, manager, session.ID, golang.ID, "OPENED "+goURI); strings.Contains(log, textURI) {
		t.Fatalf("il file .txt è arrivato a gopls:\n%s", log)
	}
	if log := waitForLog(t, manager, session.ID, "text", "OPENED "+textURI); strings.Contains(log, goURI) {
		t.Fatalf("il file .go è arrivato al server text:\n%s", log)
	}
	if state, ok := manager.forDocument(session.ID, "go"); !ok || state.language != golang.ID {
		t.Fatalf("main.go deve appartenere al server Go: %v", ok)
	}
	if _, ok := manager.forDocument(session.ID, "png"); ok {
		t.Fatal("un file senza linguaggio non va sincronizzato con alcun server")
	}

	manager.Stop(session.ID, "text")
	if status := manager.Status(session.ID, "text"); status.State != LanguageServerStopped {
		t.Fatalf("server text non fermato: %+v", status)
	}
	if status := manager.Status(session.ID, golang.ID); status.State != LanguageServerReady {
		t.Fatalf("fermare text non deve toccare gopls: %+v", status)
	}
	manager.CloseSession(session.ID)
	if servers := manager.servers(session.ID); len(servers) != 0 {
		t.Fatalf("CloseSession deve dimenticare tutti i server della sessione: %d", len(servers))
	}
}
