package goide

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"adomnia/internal/ide/lsp"
	"adomnia/internal/languages/golang"
)

const fakeGoplsEnv = "ADOMNIA_FAKE_GOPLS"

// TestMain trasforma il binario di test in un finto gopls quando avviato con fakeGoplsEnv.
func TestMain(m *testing.M) {
	if os.Getenv(fakeGoplsEnv) != "" {
		runFakeGopls()
		return
	}
	os.Exit(m.Run())
}

// fakeGopls risponde lentamente a initialize e segnala su stderr ogni documento ricevuto prima di
// initialized: è la condizione che fa rispondere al vero gopls "addView called before server initialized".
type fakeGopls struct {
	initialized atomic.Bool
}

func (f *fakeGopls) HandleNotification(method string, params json.RawMessage) {
	switch method {
	case "initialized":
		f.initialized.Store(true)
	case "textDocument/didOpen", "textDocument/didChange", "textDocument/didSave", "textDocument/didClose":
		if !f.initialized.Load() {
			fmt.Fprintln(os.Stderr, "VIOLATION "+method+" before initialized")
		} else if method == "textDocument/didOpen" {
			var opened struct {
				TextDocument struct {
					URI string `json:"uri"`
				} `json:"textDocument"`
			}
			_ = json.Unmarshal(params, &opened)
			fmt.Fprintln(os.Stderr, "OPENED "+opened.TextDocument.URI)
		}
	}
}

func (f *fakeGopls) HandleRequest(_ context.Context, method string, _ json.RawMessage) (any, error) {
	if method == "initialize" {
		time.Sleep(400 * time.Millisecond)
		return map[string]any{"capabilities": map[string]any{}}, nil
	}
	if method == "workspace/symbol" {
		if os.Getenv("ADOMNIA_FAKE_LSP_SLOW") != "" {
			time.Sleep(time.Second)
		}
		return []lsp.SymbolInformation{{Name: "HealthySymbol", Kind: 12, Location: lsp.Location{URI: fileURI(os.Getenv("ADOMNIA_FAKE_LSP_ROOT") + "/main.go")}}}, nil
	}
	return nil, nil
}

func runFakeGopls() {
	fmt.Fprintln(os.Stderr, "ARGS "+strings.Join(os.Args[1:], " "))
	conn := lsp.NewConn(os.Stdin, os.Stdout, &fakeGopls{})
	conn.Run()
}

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
		for manager.Status(session.ID, golang.ID).PID == 0 {
			time.Sleep(5 * time.Millisecond)
		}
		manager.TrackDocument(session, Document{ID: "d1", URI: fileURI(root + "/main.go"), Path: root + "/main.go"}, "package main\n", false)
		_ = manager.UpdateDocument(session.ID, "d1", 2, "package main\n\nfunc main() {}\n")
	}()
	status, err := manager.Start(session, LanguageServerOptions{Language: golang.ID, Name: "gopls", Binary: executable, Environment: append(os.Environ(), fakeGoplsEnv+"=1")})
	if err != nil {
		t.Fatalf("avvio fallito: %v (%+v)", err, status)
	}
	defer manager.Stop(session.ID, golang.ID)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		log := strings.Join(manager.Log(session.ID, golang.ID), "\n")
		if strings.Contains(log, "VIOLATION") {
			t.Fatalf("documento inviato prima di initialized:\n%s", log)
		}
		if strings.Contains(log, "OPENED") {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("il documento aperto durante l'handshake non è mai arrivato a gopls:\n%s", strings.Join(manager.Log(session.ID, golang.ID), "\n"))
}
