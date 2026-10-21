package python

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/lsp"
	"adomnia/internal/ide/sdk"
)

// lspTestHandler raccoglie le diagnostiche e risponde alle richieste del server con le stesse
// impostazioni che serve l'IDE (pyrightSettings), sezione per sezione.
type lspTestHandler struct {
	settings    any
	diagnostics chan map[string]any
}

func (h *lspTestHandler) HandleNotification(method string, params json.RawMessage) {
	if method != "textDocument/publishDiagnostics" {
		return
	}
	var payload map[string]any
	if json.Unmarshal(params, &payload) == nil {
		h.diagnostics <- payload
	}
}

func (h *lspTestHandler) HandleRequest(_ context.Context, method string, params json.RawMessage) (any, error) {
	switch method {
	case "workspace/configuration":
		var request struct {
			Items []struct {
				Section string `json:"section"`
			} `json:"items"`
		}
		_ = json.Unmarshal(params, &request)
		sections, _ := h.settings.(map[string]any)
		answers := make([]any, 0, len(request.Items))
		for _, item := range request.Items {
			answers = append(answers, sections[item.Section])
		}
		return answers, nil
	case "client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create":
		return nil, nil
	default:
		return nil, nil
	}
}

// testFileURI è l'URI file:// di un percorso, con la stessa codifica usata dal resto dell'IDE.
func testFileURI(path string) string {
	normalized := filepath.ToSlash(path)
	if len(normalized) >= 2 && normalized[1] == ':' {
		normalized = "/" + normalized
	}
	return (&url.URL{Scheme: "file", Path: normalized}).String()
}

// TestRealBasedpyrightAnalysesProjectImports prova PY-4.6 con il language server reale:
// diagnostica su un import sconosciuto, nessun falso positivo sull'import risolto nell'ambiente
// del progetto (un solo venv), definizione sul modulo dell'ambiente e rename di una variabile.
// Senza interprete con basedpyright il test salta con il motivo, senza chiamare la prova superata.
func TestRealBasedpyrightAnalysesProjectImports(t *testing.T) {
	interpreter := testInterpreterWith(t, "basedpyright")
	langserver := filepath.Join(filepath.Dir(interpreter), sdk.ExecutableName(pyrightLangserver))
	if !isFile(langserver) {
		t.Skip("basedpyright-langserver console script not found next to the interpreter")
	}
	// LocateServer trova il server nel PATH: il console script è accanto all'interprete del test.
	t.Setenv("PATH", filepath.Dir(interpreter)+string(os.PathListSeparator)+os.Getenv("PATH"))
	root := t.TempDir()
	createEnvironment(t, interpreter, root, "known")
	source := "import envmark\nimport missing_module_xyz\n\nvalue = envmark.name\nprint(value)\n"
	path := writeFile(t, root, "main.py", source)

	spec, err := New().ServerSpec(root, "")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(spec.Binary, spec.Arguments...)
	command.Dir = root
	command.Env = append(os.Environ(), spec.Environment...)
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
	})
	settings := spec.Configuration()
	handler := &lspTestHandler{settings: settings, diagnostics: make(chan map[string]any, 32)}
	conn := lsp.NewConn(stdout, stdin, handler)
	go conn.Run()
	t.Cleanup(func() { _ = conn.Notify("shutdown", nil) })

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	uri := testFileURI(path)
	if err := conn.Call(ctx, "initialize", map[string]any{
		"processId": nil,
		"rootUri":   testFileURI(root),
		"capabilities": map[string]any{
			"workspace":    map[string]any{"workspaceFolders": true, "configuration": true},
			"textDocument": map[string]any{"publishDiagnostics": map[string]any{}, "synchronization": map[string]any{}},
		},
	}, nil); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if err := conn.Notify("initialized", map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if err := conn.Notify("workspace/didChangeConfiguration", map[string]any{"settings": settings}); err != nil {
		t.Fatal(err)
	}
	if err := conn.Notify("textDocument/didOpen", map[string]any{"textDocument": map[string]any{
		"uri": uri, "languageId": "python", "version": 1, "text": source,
	}}); err != nil {
		t.Fatal(err)
	}

	// Diagnostica: l'import sconosciuto è segnalato, quello risolto nell'ambiente no.
	var messages []string
	deadline := time.After(90 * time.Second)
collect:
	for {
		select {
		case payload := <-handler.diagnostics:
			// Un solo documento aperto: il server può normalizzare l'URI a modo suo
			// (maiuscole/percent-encoding), quindi non si filtra per URI.
			list, _ := payload["diagnostics"].([]any)
			for _, item := range list {
				diagnostic, _ := item.(map[string]any)
				text, _ := diagnostic["message"].(string)
				messages = append(messages, text)
			}
			for _, text := range messages {
				if strings.Contains(text, "missing_module_xyz") {
					break collect
				}
			}
		case <-deadline:
			t.Fatalf("no diagnostics for the unresolved import: %v", messages)
		}
	}
	for _, text := range messages {
		// Un import risolto può mancare solo dei type stub ("Stub file not found"): non deve
		// mai risultare irrisolto o sconosciuto.
		if strings.Contains(text, "envmark") && (strings.Contains(text, "could not be resolved") || strings.Contains(text, "unknown import")) {
			t.Fatalf("the environment import must resolve: %q", text)
		}
	}

	// Definizione: `envmark` punta al modulo dentro l'ambiente del progetto.
	var definition any
	if err := conn.Call(ctx, "textDocument/definition", map[string]any{
		"textDocument": map[string]any{"uri": uri},
		"position":     map[string]any{"line": 0, "character": 8},
	}, &definition); err != nil {
		t.Fatalf("definition: %v", err)
	}
	encoded, _ := json.Marshal(definition)
	if !strings.Contains(string(encoded), "site-packages") {
		t.Fatalf("definition does not point into the project environment: %s", encoded)
	}

	// Rename di una variabile locale: due modifiche (dichiarazione e uso).
	var rename map[string]any
	if err := conn.Call(ctx, "textDocument/rename", map[string]any{
		"textDocument": map[string]any{"uri": uri},
		"position":     map[string]any{"line": 3, "character": 0},
		"newName":      "renamed",
	}, &rename); err != nil {
		t.Fatalf("rename: %v", err)
	}
	encoded, _ = json.Marshal(rename)
	if strings.Count(string(encoded), "renamed") < 2 {
		t.Fatalf("rename did not update both the declaration and the use: %s", encoded)
	}
}
