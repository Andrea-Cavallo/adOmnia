package langserver

import (
	"bufio"
	"bytes"
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

type lspStateProbeWriter struct {
	state  *lspSession
	buffer *bytes.Buffer
	t      *testing.T
}

func (w lspStateProbeWriter) Write(data []byte) (int, error) {
	if !w.state.mu.TryLock() {
		w.t.Error("LSP pipe write holds session mutex: server callbacks can deadlock")
	} else {
		w.state.mu.Unlock()
	}
	return w.buffer.Write(data)
}

func TestIncrementalWithInstalledGopls(t *testing.T) {
	binary := os.Getenv("ADOMNIA_TEST_GOPLS")
	if binary == "" {
		t.Skip("set ADOMNIA_TEST_GOPLS to an existing local gopls; never downloads tools")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/incremental\n\ngo 1.23\n"), 0600); err != nil {
		t.Fatal(err)
	}
	before := "package main\nvar Message = 123\n"
	path := filepath.Join(root, "main.go")
	if err := os.WriteFile(path, []byte(before), 0600); err != nil {
		t.Fatal(err)
	}
	registry := language.NewRegistry()
	_ = registry.Register(fakeGoLanguage{fakeLanguage{goID, ".go"}})
	manager := NewLSPManager(registry)
	t.Cleanup(manager.Shutdown)
	session := Session{ID: "real-incremental", Project: Project{Name: "incremental", RootPath: root, RealPath: root}}
	document := Document{ID: "real-file", URI: lsp.FileURI(path), Path: path}
	manager.TrackDocument(session, document, before, false)
	_, err := manager.Start(session, LanguageServerOptions{Language: goID, Name: "gopls", Binary: binary, Environment: append(os.Environ(), "GOTOOLCHAIN=local", "GOPROXY=off", "GOSUMDB=off")})
	if err != nil {
		t.Fatal(err)
	}
	state, _ := manager.server(session.ID, goID)
	if state.synced.syncKind != 2 {
		t.Fatalf("server did not negotiate incremental sync: %d", state.synced.syncKind)
	}
	after := "package main\n// 😀\r\nvar Message = \"ready\"\n"
	if err := manager.UpdateDocument(session.ID, document.ID, 2, after); err != nil {
		t.Fatal(err)
	}
	hover, err := manager.Hover(context.Background(), session.ID, document.ID, 3, 7)
	if err != nil || hover.Version != 2 || !strings.Contains(hover.Markdown, "string") {
		t.Fatalf("gopls saw stale/corrupt overlay: %+v %v", hover, err)
	}
	if err := manager.UpdateDocument(session.ID, document.ID, 3, before); err != nil {
		t.Fatal(err)
	}
	hover, err = manager.Hover(context.Background(), session.ID, document.ID, 2, 7)
	if err != nil || hover.Version != 3 || !strings.Contains(hover.Markdown, "int") {
		t.Fatalf("reverse delta failed: %+v %v", hover, err)
	}
	options := LanguageServerOptions{Language: goID, Name: "gopls", Binary: binary, Environment: append(os.Environ(), "GOTOOLCHAIN=local", "GOPROXY=off", "GOSUMDB=off")}
	if _, err := manager.Restart(session, options); err != nil {
		t.Fatal(err)
	}
	hover, err = manager.Hover(context.Background(), session.ID, document.ID, 2, 7)
	if err != nil || hover.Version != 3 || !strings.Contains(hover.Markdown, "int") {
		t.Fatalf("restart lost current buffer: %+v %v", hover, err)
	}
	second := session
	second.ID = "same-root-other-session"
	manager.TrackDocument(second, document, before, false)
	if _, err := manager.Start(second, options); err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateDocument(second.ID, document.ID, 2, "package main\nvar Message = true\n"); err != nil {
		t.Fatal(err)
	}
	other, err := manager.Hover(context.Background(), second.ID, document.ID, 2, 7)
	if err != nil || !strings.Contains(other.Markdown, "bool") {
		t.Fatalf("second overlay invalid: %+v %v", other, err)
	}
	manager.Stop(second.ID, goID)
	hover, err = manager.Hover(context.Background(), session.ID, document.ID, 2, 7)
	if err != nil || !strings.Contains(hover.Markdown, "int") {
		t.Fatalf("other session changed/stopped first overlay: %+v %v", hover, err)
	}
}

func TestLanguageServerSyncNegotiation(t *testing.T) {
	for raw, want := range map[string]int{"": 1, "1": 1, "2": 2, "0": 0, `{"openClose":true,"change":2}`: 2, `{"change":1}`: 1} {
		if got := (serverCapabilities{TextDocumentSync: jsonv1.RawMessage(raw)}).syncKind(); got != want {
			t.Fatalf("%s: got %d want %d", raw, got, want)
		}
	}
}

func TestIncrementalDocumentWireAndSessionIsolation(t *testing.T) {
	registry := language.NewRegistry()
	_ = registry.Register(fakeGoLanguage{fakeLanguage{goID, ".go"}})
	manager := NewLSPManager(registry)
	root := t.TempDir()
	before := "package main\n// 😀\r\nvar name = 1\n"
	for _, kind := range []int{0, 1, 2} {
		t.Run(fmt.Sprint(kind), func(t *testing.T) {
			session := Session{ID: SessionID(fmt.Sprint(kind)), Project: Project{RealPath: root}}
			state := manager.ensure(session, goID)
			var wire bytes.Buffer
			state.synced = &serverProcess{syncKind: kind, conn: lsp.NewConn(strings.NewReader(""), lspStateProbeWriter{state, &wire, t}, nil)}
			document := Document{ID: "file", URI: "file:///same.go", Path: "same.go"}
			manager.TrackDocument(session, document, before, false)
			manager.reopenDocuments(state, state.synced)
			wire.Reset()
			after := strings.Replace(before, "name", "newName", 1)
			if err := manager.UpdateDocument(session.ID, document.ID, 2, after); err != nil {
				t.Fatal(err)
			}
			if err := manager.UpdateDocument(session.ID, document.ID, 2, "stale"); !errors.Is(err, ErrStaleDocumentVersion) {
				t.Fatal("stale version accepted")
			}
			if kind == 0 {
				if wire.Len() != 0 {
					t.Fatal("sync disabled but change sent")
				}
				return
			}
			reader := bufio.NewReader(&wire)
			header, _ := reader.ReadString('\n')
			var size int
			_, _ = fmt.Sscanf(header, "Content-Length: %d", &size)
			_, _ = reader.ReadString('\n')
			payload := make([]byte, size)
			if _, err := io.ReadFull(reader, payload); err != nil {
				t.Fatal(err)
			}
			var message struct {
				Method string `json:"method"`
				Params struct {
					ContentChanges []lsp.ContentChange `json:"contentChanges"`
				} `json:"params"`
			}
			if err := json.Unmarshal(payload, &message); err != nil {
				t.Fatal(err)
			}
			if message.Method != "textDocument/didChange" || len(message.Params.ContentChanges) != 1 {
				t.Fatalf("bad message %s", payload)
			}
			change := message.Params.ContentChanges[0]
			if kind == 1 {
				if change.Range != nil || change.Text != after {
					t.Fatal("full sync broken")
				}
			} else {
				if change.Range == nil || len(change.Text) >= len(after) {
					t.Fatal("full buffer resent")
				}
				got, err := lsp.ApplyEdits(before, []lsp.TextEdit{{Range: *change.Range, NewText: change.Text}})
				if err != nil || got != after {
					t.Fatalf("wire edit corrupted buffer: %q %v", got, err)
				}
			}
		})
	}
	// Identical URIs in independent sessions must retain independent overlays.
	a, _ := manager.server("0", goID)
	b, _ := manager.server("1", goID)
	if a == b || a.documents["file"] == b.documents["file"] {
		t.Fatal("shared mutable overlay")
	}
	if err := manager.UpdateDocument("0", "file", 3, "independent"); err != nil {
		t.Fatal(err)
	}
	if b.documents["file"].text == "independent" {
		t.Fatal("cross-session buffer overwrite")
	}
}
