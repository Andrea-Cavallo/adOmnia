package codestudio

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/run"
)

// TestFormatToolHelper è il processo finto usato dai test: mai eseguito come test normale.
func TestFormatToolHelper(t *testing.T) {
	if os.Getenv("ADOMNIA_FORMAT_HELPER") != "1" {
		return
	}
	data, _ := io.ReadAll(os.Stdin)
	_, _ = os.Stdout.WriteString(strings.ToUpper(string(data)))
	os.Exit(0)
}

func TestRunFormatToolReturnsTransformedText(t *testing.T) {
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("ADOMNIA_FORMAT_HELPER", "1")
	formatted, err := runFormatTool(context.Background(), run.CommandSpec{
		Executable: binary, Arguments: []string{"-test.run=^TestFormatToolHelper$"},
	}, "x = 1\n", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if formatted != "X = 1\n" {
		t.Fatalf("formatted %q", formatted)
	}
}

func TestRunFormatToolReportsTheToolMessage(t *testing.T) {
	// Un eseguibile inesistente non può partire: l'errore è esplicito, non un output grezzo.
	_, err := runFormatTool(context.Background(), run.CommandSpec{
		Executable: filepath.Join(t.TempDir(), "missing-ruff"), Arguments: []string{"format"},
	}, "x", t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "not executable") {
		t.Fatalf("error %v", err)
	}
}

// TestFormatToolRangeCoversTheWholeDocument: il fallback sostituisce l'intero buffer con una sola
// modifica, quindi la posizione finale è l'ultima riga/colonna UTF-16.
func TestFormatToolRangeCoversTheWholeDocument(t *testing.T) {
	text := "def f():\n    return 'è'\n"
	end := editorPositionAt(text, len(text))
	if end.line != 3 || end.column != 1 {
		t.Fatalf("end %+v", end)
	}
	start := editorPositionAt(text, 0)
	if start.line != 1 || start.column != 1 {
		t.Fatalf("start %+v", start)
	}
}

// TestFirstMeaningfulLineSkipsEmptyStderr: i tool possono iniziare con una riga vuota.
func TestFirstMeaningfulLineSkipsEmptyStderr(t *testing.T) {
	if got := firstMeaningfulLine("\n  \nError: could not parse pyproject.toml\n"); got != "Error: could not parse pyproject.toml" {
		t.Fatalf("got %q", got)
	}
	if got := firstMeaningfulLine("   "); got != "" {
		t.Fatalf("got %q", got)
	}

}
