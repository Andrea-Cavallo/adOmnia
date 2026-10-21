package python

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/language"
)

// TestFormatToolUsesRuffOnTheRealPath: Ruff riceve il contenuto su stdin, il percorso reale come
// --stdin-filename (per leggere pyproject.toml) e lavora nella cartella del documento.
func TestFormatToolUsesRuffOnTheRealPath(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, filepath.Join(".venv", "Scripts", "python.exe"), "")
	writeFile(t, root, filepath.Join(".venv", "bin", "python"), "")
	interpreter := environmentInterpreter(filepath.Join(root, ".venv"))
	document := writeFile(t, root, "pkg/app.py", "x=1\n")
	spec, available, reason, err := New().FormatTool(language.FormatRequest{
		Root: root, WorkingDirectory: root, Path: document, RelativePath: "pkg/app.py",
	})
	if err != nil || !available || reason != "" {
		t.Fatalf("available=%v reason=%q err=%v", available, reason, err)
	}
	if spec.Executable != interpreter || strings.Join(spec.Arguments, " ") != "-m ruff format --stdin-filename "+document+" -" {
		t.Fatalf("%+v", spec)
	}
	if spec.WorkingDirectory != root {
		t.Fatalf("working directory %q", spec.WorkingDirectory)
	}
}

// TestFormatToolWithoutInterpreterExplainsWhatIsMissing: senza un interprete la formattazione non
// prova a partire e dice cosa scegliere.
func TestFormatToolWithoutInterpreterExplainsWhatIsMissing(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "app.py", "x=1\n")
	original := lookPath
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	t.Cleanup(func() { lookPath = original })
	t.Setenv("VIRTUAL_ENV", "")
	t.Setenv("UV_PROJECT_ENVIRONMENT", "")
	t.Setenv("POETRY_VIRTUALENVS_PATH", t.TempDir())
	_, available, reason, err := New().FormatTool(language.FormatRequest{Root: root, WorkingDirectory: root, Path: root + "/app.py"})
	if err != nil {
		t.Fatal(err)
	}
	if available || !strings.Contains(reason, "interpreter") {
		t.Fatalf("available=%v reason=%q", available, reason)
	}
}
