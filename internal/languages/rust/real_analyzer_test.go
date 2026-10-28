package rust

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// analyzerHandler risponde al server come l'IDE (workspace/configuration con le impostazioni
// dell'adapter) e raccoglie le diagnostiche per file.
type analyzerHandler struct {
	settings any
	mu       sync.Mutex
	messages map[string][]string
}

func (h *analyzerHandler) HandleNotification(method string, params jsonv1.RawMessage) {
	if method != "textDocument/publishDiagnostics" {
		return
	}
	var payload struct {
		URI         string `json:"uri"`
		Diagnostics []struct {
			Message string `json:"message"`
		} `json:"diagnostics"`
	}
	if json.Unmarshal(params, &payload) != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	// rust-analyzer risponde con la lettera di unità minuscola (`file:///c:/…`): si confronta in minuscolo.
	key := strings.ToLower(payload.URI)
	h.messages[key] = h.messages[key][:0]
	for _, diagnostic := range payload.Diagnostics {
		h.messages[key] = append(h.messages[key], diagnostic.Message)
	}
}

func (h *analyzerHandler) HandleRequest(_ context.Context, method string, params jsonv1.RawMessage) (any, error) {
	if method != "workspace/configuration" {
		return nil, nil
	}
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
}

func (h *analyzerHandler) diagnosticsFor(uri string) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.messages[strings.ToLower(uri)]...)
}

func analyzerURI(path string) string {
	normalized := filepath.ToSlash(path)
	if len(normalized) >= 2 && normalized[1] == ':' {
		normalized = "/" + normalized
	}
	return (&url.URL{Scheme: "file", Path: normalized}).String()
}

// eventually riprova finché la condizione non regge: rust-analyzer risponde null/vuoto finché il
// workspace non è caricato (cargo metadata, build script), che richiede decine di secondi.
func eventually(t *testing.T, what string, limit time.Duration, check func() (bool, string)) {
	t.Helper()
	deadline := time.Now().Add(limit)
	last := ""
	for time.Now().Before(deadline) {
		ok, detail := check()
		if ok {
			return
		}
		last = detail
		time.Sleep(2 * time.Second)
	}
	t.Fatalf("%s: timed out; last answer: %s", what, last)
}

// TestRealRustAnalyzerAnalysesWorkspace prova RS-4.8 con il server vero, avviato con lo ServerSpec
// dell'adapter: diagnostica su un errore di tipo, completamento su un path di crate, definizione che
// entra in un crate path-dependency del workspace e rename di una variabile locale. Salta con il
// motivo se rust-analyzer non è installato.
func TestRealRustAnalyzerAnalysesWorkspace(t *testing.T) {
	requireRealCargo(t)
	if !New().LocateServer("", "").Available {
		t.Skip("rust-analyzer is not installed (rustup component add rust-analyzer)")
	}
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[workspace]\nmembers = [\"app\", \"util\"]\nresolver = \"2\"\n")
	writeFile(t, root, "util/Cargo.toml", "[package]\nname = \"util\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "util/src/lib.rs", "pub fn double(value: u32) -> u32 {\n    value * 2\n}\n")
	writeFile(t, root, "app/Cargo.toml", "[package]\nname = \"app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\nutil = { path = \"../util\" }\n")
	source := "fn main() {\n    let total = util::double(21);\n    let broken: u32 = \"text\";\n    println!(\"{} {}\", total, broken);\n}\n"
	mainPath := writeFile(t, root, "app/src/main.rs", source)

	spec, err := New().UnitServerSpec(root, root, "")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(spec.Binary, spec.Arguments...)
	command.Dir = root
	command.Env = append(os.Environ(), spec.Environment...)
	var stderr lockedBuffer
	command.Stderr = &stderr
	t.Cleanup(func() {
		if t.Failed() {
			t.Logf("rust-analyzer stderr:\n%s", stderr.String())
		}
	})
	stdin, _ := command.StdinPipe()
	stdout, _ := command.StdoutPipe()
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
	})
	handler := &analyzerHandler{settings: spec.Configuration(), messages: map[string][]string{}}
	conn := lsp.NewConn(stdout, stdin, handler)
	go conn.Run()

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	// Le capability annunciate decidono quali provider l'editor registra: semantic tokens, inlay
	// hints e Code Vision (symbols/references) per Rust dipendono da qui (RS-4).
	var init struct {
		Capabilities struct {
			SemanticTokensProvider *struct {
				Legend struct {
					TokenTypes []string `json:"tokenTypes"`
				} `json:"legend"`
			} `json:"semanticTokensProvider"`
			InlayHintProvider jsonv1.RawMessage `json:"inlayHintProvider"`
		} `json:"capabilities"`
	}
	if err := conn.Call(ctx, "initialize", map[string]any{
		"processId": nil,
		"rootUri":   analyzerURI(root),
		"capabilities": map[string]any{
			"workspace":    map[string]any{"workspaceFolders": true, "configuration": true},
			"textDocument": map[string]any{"publishDiagnostics": map[string]any{}, "synchronization": map[string]any{}, "completion": map[string]any{}},
			"window":       map[string]any{"workDoneProgress": true},
		},
	}, &init); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if init.Capabilities.SemanticTokensProvider == nil || len(init.Capabilities.SemanticTokensProvider.Legend.TokenTypes) == 0 {
		t.Fatalf("rust-analyzer did not announce semantic tokens: %+v", init.Capabilities)
	}
	if len(init.Capabilities.InlayHintProvider) == 0 || string(init.Capabilities.InlayHintProvider) == "false" {
		t.Fatalf("rust-analyzer did not announce inlay hints: %s", init.Capabilities.InlayHintProvider)
	}
	_ = conn.Notify("initialized", map[string]any{})
	_ = conn.Notify("workspace/didChangeConfiguration", map[string]any{"settings": spec.Configuration()})
	uri := analyzerURI(mainPath)
	_ = conn.Notify("textDocument/didOpen", map[string]any{"textDocument": map[string]any{"uri": uri, "languageId": "rust", "version": 1, "text": source}})

	eventually(t, "type error diagnostic", 3*time.Minute, func() (bool, string) {
		messages := handler.diagnosticsFor(uri)
		for _, message := range messages {
			if strings.Contains(message, "mismatched types") {
				return true, ""
			}
		}
		return false, strings.Join(messages, " | ")
	})

	call := func(method string, params any) string {
		var result any
		if err := conn.Call(ctx, method, params, &result); err != nil {
			return "error: " + err.Error()
		}
		encoded, _ := jsonutil.Marshal(result)
		return string(encoded)
	}
	position := func(line, character int) map[string]any {
		return map[string]any{"textDocument": map[string]any{"uri": uri}, "position": map[string]any{"line": line, "character": character}}
	}

	// Definizione di `double` (riga 1, dentro `util::double`): entra nel crate util.
	eventually(t, "definition into the path dependency", time.Minute, func() (bool, string) {
		answer := call("textDocument/definition", position(1, 24))
		return strings.Contains(filepath.ToSlash(answer), "util/src/lib.rs"), answer
	})

	// Completamento dopo `util::` (riga 1, colonna 22): propone `double`.
	complete := position(1, 22)
	eventually(t, "completion of the crate path", time.Minute, func() (bool, string) {
		answer := call("textDocument/completion", complete)
		return strings.Contains(answer, `"double"`), answer
	})

	// Rename della variabile locale `total`: dichiarazione e uso.
	eventually(t, "rename of a local variable", time.Minute, func() (bool, string) {
		params := position(1, 9)
		params["newName"] = "sum"
		answer := call("textDocument/rename", params)
		return strings.Count(answer, `"sum"`) >= 2, answer
	})

	// RS-4: token semantici, inlay hints e Code Vision (document symbols + references) sul server vero.
	eventually(t, "semantic tokens", time.Minute, func() (bool, string) {
		answer := call("textDocument/semanticTokens/full", map[string]any{"textDocument": map[string]any{"uri": uri}})
		return strings.Contains(answer, `"data":[`) && !strings.Contains(answer, `"data":[]`), answer
	})
	eventually(t, "inlay hints", time.Minute, func() (bool, string) {
		params := map[string]any{
			"textDocument": map[string]any{"uri": uri},
			"range":        map[string]any{"start": map[string]any{"line": 0, "character": 0}, "end": map[string]any{"line": 5, "character": 0}},
		}
		answer := call("textDocument/inlayHint", params)
		return strings.Contains(answer, `"position"`), answer
	})
	eventually(t, "document symbols for Code Vision", time.Minute, func() (bool, string) {
		answer := call("textDocument/documentSymbol", map[string]any{"textDocument": map[string]any{"uri": uri}})
		return strings.Contains(answer, `"name"`), answer
	})
	eventually(t, "references for Code Vision", time.Minute, func() (bool, string) {
		params := position(1, 24)
		params["context"] = map[string]any{"includeDeclaration": true}
		answer := call("textDocument/references", params)
		return strings.Contains(filepath.ToSlash(answer), "app/src/main.rs"), answer
	})
}

// lockedBuffer raccoglie lo stderr del server (scritto da una goroutine di os/exec) senza data race.
type lockedBuffer struct {
	mu   sync.Mutex
	text strings.Builder
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.text.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.text.String()
}
