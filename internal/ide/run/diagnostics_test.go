package run

import (
	"strings"
	"testing"
)

// Il core raccoglie i diagnostici dall'output di build: spezza in righe, chiama il parser
// dell'adapter per ogni riga e svuota l'ultima riga senza newline (RS-3.3).
func TestDiagnosticsCollectionSplitsLinesAndFlushes(t *testing.T) {
	process := &managedProcess{
		diagnostics: func(line string) (Diagnostic, bool) {
			if strings.HasPrefix(line, "ERR:") {
				return Diagnostic{File: "src/main.rs", Line: 1, Severity: 1, Message: strings.TrimPrefix(line, "ERR:")}, true
			}
			return Diagnostic{}, false
		},
	}
	writer := &outputWriter{process: process}
	writer.feedDiagnostics([]byte("ERR:first\nignore\nERR:second"))
	writer.flushDiagnostics() // "ERR:second" è l'ultima riga senza newline

	process.collectedMu.Lock()
	defer process.collectedMu.Unlock()
	if len(process.collected) != 2 {
		t.Fatalf("collected = %+v", process.collected)
	}
	if process.collected[0].Message != "first" || process.collected[1].Message != "second" {
		t.Fatalf("collected = %+v", process.collected)
	}
	if process.collected[0].Severity != 1 || process.collected[0].File != "src/main.rs" {
		t.Fatalf("diagnostic = %+v", process.collected[0])
	}
}

// Le righe non riconosciute dal parser vengono ignorate, senza bloccare le altre.
func TestDiagnosticsCollectionIgnoresUnrecognizedLines(t *testing.T) {
	process := &managedProcess{
		diagnostics: func(line string) (Diagnostic, bool) { return Diagnostic{}, false },
	}
	writer := &outputWriter{process: process}
	writer.feedDiagnostics([]byte("progress\nmore progress\n"))
	if len(process.collected) != 0 {
		t.Fatalf("collected = %+v", process.collected)
	}
}

func TestConsoleRewriteReplacesHandledLinesAndKeepsTheRest(t *testing.T) {
	process := &managedProcess{console: func(line string) (string, bool) {
		switch {
		case strings.HasPrefix(line, "{drop"):
			return "", true
		case strings.HasPrefix(line, "{show"):
			return "shown", true
		}
		return "", false
	}}
	writer := &outputWriter{process: process}
	got := string(writer.rewriteConsole([]byte("keep 1\n{drop}\n{show}\n{program json}\nprompt: ")))
	if got != "keep 1\nshown\n{program json}\nprompt: " {
		t.Fatalf("got %q", got)
	}
	// una riga JSON spezzata su due scritture aspetta il newline
	writer = &outputWriter{process: process}
	if first := writer.rewriteConsole([]byte("{sho")); len(first) != 0 {
		t.Fatalf("partial JSON must wait, got %q", first)
	}
	if second := string(writer.rewriteConsole([]byte("w}\nnext\n"))); second != "shown\nnext\n" {
		t.Fatalf("second = %q", second)
	}
}
