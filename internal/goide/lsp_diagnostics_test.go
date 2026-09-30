package goide

import (
	"sync"
	"testing"
	"time"

	"adomnia/internal/goide/lsp"
)

func TestDiagnosticsAreThrottledAndCapped(t *testing.T) {
	manager := NewLSPManager()
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
