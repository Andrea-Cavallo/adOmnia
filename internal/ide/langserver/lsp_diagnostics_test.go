package langserver

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

func TestDiagnosticsDeduplicateContentButPreserveClearAndReopen(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	state := manager.ensure(Session{ID: "dedup", Project: Project{RealPath: t.TempDir()}}, "go")
	var reports []DiagnosticsReport
	manager.SetEmitter(func(kind string, _ SessionID, _ string, payload any) {
		if kind == "lsp.diagnostics" {
			reports = append(reports, payload.(DiagnosticsReport))
		}
	})
	uri := lsp.FileURI(state.root + "/main.go")
	state.byURI[uri] = "first"
	report := lsp.PublishDiagnosticsParams{URI: uri, Diagnostics: []lsp.Diagnostic{{Message: "problem", Severity: 1, Code: json.RawMessage(`1`)}}}
	flush := func() {
		state.mu.Lock()
		if state.diagnosticsTimer != nil {
			state.diagnosticsTimer.Stop()
		}
		state.mu.Unlock()
		manager.flushDiagnostics(state)
	}
	manager.publishDiagnostics(state, report)
	flush()
	for range 100 {
		manager.publishDiagnostics(state, report)
	}
	state.mu.Lock()
	timer := state.diagnosticsTimer
	state.mu.Unlock()
	if timer != nil {
		timer.Stop()
		t.Error("identical reports scheduled another timer")
	}
	flush()
	if len(reports) != 1 {
		t.Errorf("identical reports emitted: %d", len(reports))
	}
	// Data used for code actions must still refresh when the rendered fields match.
	report.Diagnostics[0].Code = json.RawMessage(`"1"`)
	manager.publishDiagnostics(state, report)
	flush()
	if len(reports) != 1 || string(state.diagnostics[uri][0].Code) != `"1"` {
		t.Error("raw diagnostics lost or invisible change emitted")
	}
	state.byURI[uri] = "reopened"
	manager.publishDiagnostics(state, report)
	flush()
	if len(reports) != 2 || reports[1].DocumentID != "reopened" {
		t.Error("new document identity lost")
	}
	manager.publishDiagnostics(state, lsp.PublishDiagnosticsParams{URI: uri})
	flush()
	manager.publishDiagnostics(state, lsp.PublishDiagnosticsParams{URI: uri})
	flush()
	if len(reports) != 3 || len(reports[2].Diagnostics) != 0 {
		t.Error("clear missing or duplicated")
	}
	manager.publishDiagnostics(state, report)
	flush()
	manager.setState(state, LanguageServerStopped, "")
	manager.publishDiagnostics(state, report)
	flush()
	if len(reports) != 5 {
		t.Errorf("restart suppressed fresh diagnostics: %d", len(reports))
	}
}

func TestDiagnosticsAreThrottledAndCapped(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	var mu sync.Mutex
	var reports []DiagnosticsReport
	manager.SetEmitter(func(eventType string, _ SessionID, _ string, payload any) {
		if eventType == "lsp.diagnostics" {
			mu.Lock()
			reports = append(reports, payload.(DiagnosticsReport))
			mu.Unlock()
		}
	})
	state := &lspSession{id: "s", root: t.TempDir(), byURI: map[string]DocumentID{}, diagnostics: map[string][]lsp.Diagnostic{}}

	// Una raffica di gopls sullo stesso file arriva alla UI come un solo aggiornamento, l'ultimo.
	for count := 1; count <= 5; count++ {
		manager.publishDiagnostics(state, lsp.PublishDiagnosticsParams{URI: "file:///p/a.go", Diagnostics: make([]lsp.Diagnostic, count)})
	}
	huge := make([]lsp.Diagnostic, maxDiagnosticsPerFile+50)
	huge[len(huge)-1].Severity = 1 // l'errore in fondo deve restare fra quelli mostrati
	for index := range huge[:len(huge)-1] {
		huge[index].Severity = 2
	}
	manager.publishDiagnostics(state, lsp.PublishDiagnosticsParams{URI: "file:///p/gen.go", Diagnostics: huge})

	time.Sleep(3 * diagnosticsThrottle)
	mu.Lock()
	defer mu.Unlock()
	if len(reports) != 2 {
		t.Fatalf("attesi 2 aggiornamenti (uno per file), ricevuti %d", len(reports))
	}
	for _, report := range reports {
		switch report.URI {
		case "file:///p/a.go":
			if len(report.Diagnostics) != 5 {
				t.Fatalf("deve arrivare l'ultima diagnostica della raffica: %d", len(report.Diagnostics))
			}
		case "file:///p/gen.go":
			if len(report.Diagnostics) != maxDiagnosticsPerFile || report.Diagnostics[0].Severity != 1 {
				t.Fatalf("diagnostica non limitata o errori non in testa: %d, severity %d", len(report.Diagnostics), report.Diagnostics[0].Severity)
			}
		}
	}
	if len(state.diagnostics["file:///p/gen.go"]) != len(huge) {
		t.Fatal("la diagnostica completa resta disponibile nel backend")
	}
}
