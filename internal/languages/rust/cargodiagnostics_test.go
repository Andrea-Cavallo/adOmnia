package rust

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/run"
)

func TestCargoDiagnosticFromLineParsesError(t *testing.T) {
	line := `{"reason":"compiler-message","message":{"code":{"code":"E0308"},"level":"error","message":"mismatched types","spans":[{"file_name":"src/main.rs","line_start":3,"line_end":3,"column_start":9,"column_end":13,"is_primary":true}],"children":[{"level":"help","message":"try changing the type"}],"rendered":"error[E0308]: mismatched types"}}`
	diagnostic, ok := cargoDiagnosticFromLine(line)
	if !ok {
		t.Fatal("expected a diagnostic")
	}
	if diagnostic.Code != "E0308" || diagnostic.Severity != 1 || diagnostic.Message != "mismatched types" {
		t.Fatalf("diagnostic = %+v", diagnostic)
	}
	if diagnostic.File != "src/main.rs" || diagnostic.Line != 3 || diagnostic.Column != 9 {
		t.Fatalf("span = %+v", diagnostic)
	}
	if diagnostic.Help != "try changing the type" {
		t.Fatalf("help = %q", diagnostic.Help)
	}
}

func TestCargoDiagnosticFromLineIgnoresNonMessages(t *testing.T) {
	for _, line := range []string{
		`{"reason":"compiler-artifact","executable":"/tmp/target/debug/app"}`,
		`{"reason":"build-finished","success":true}`,
		`not json`,
		`{"reason":"compiler-message","message":{"level":"unknown"}}`,
	} {
		if _, ok := cargoDiagnosticFromLine(line); ok {
			t.Fatalf("line %q must not be a diagnostic", line)
		}
	}
}

func TestCargoDiagnosticFromLineWarning(t *testing.T) {
	line := `{"reason":"compiler-message","message":{"level":"warning","message":"unused variable","spans":[{"file_name":"src/lib.rs","line_start":7,"column_start":5,"is_primary":true}]}}`
	diagnostic, ok := cargoDiagnosticFromLine(line)
	if !ok || diagnostic.Severity != 2 {
		t.Fatalf("diagnostic = %+v ok=%v", diagnostic, ok)
	}
	if diagnostic.Code != "" {
		t.Fatalf("code must be empty for a warning without code: %+v", diagnostic)
	}
}

func TestCommandSpecWiresDiagnostics(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "cargo.exe", "")
	original := pathCargo
	pathCargo = func() string { return filepath.Join(root, "cargo.exe") }
	defer func() { pathCargo = original }()

	spec, err := New().CommandSpec(run.Request{Kind: "build", Root: root, WorkingDirectory: root, LanguageOptions: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Diagnostics == nil {
		t.Fatal("CommandSpec must carry the diagnostics parser")
	}
	if joined := strings.Join(spec.Arguments, " "); !strings.Contains(joined, "--message-format=json-diagnostic-rendered-ansi") {
		t.Fatalf("arguments = %q", joined)
	}
}

func TestCargoConsoleLineShowsRenderedTextAndHidesCargoNoise(t *testing.T) {
	diagnostic := `{"reason":"compiler-message","message":{"level":"error","message":"x","spans":[],"children":[],"rendered":"error: x\n --> src/main.rs:3:5\n"}}`
	if text, handled := cargoConsoleLine(diagnostic); !handled || text != "error: x\n --> src/main.rs:3:5\n" {
		t.Fatalf("diagnostic = %q %v", text, handled)
	}
	for _, line := range []string{`{"reason":"compiler-artifact","package_id":"a"}`, `{"reason":"build-finished","success":true}`} {
		if text, handled := cargoConsoleLine(line); !handled || text != "" {
			t.Fatalf("%s must be hidden, got %q %v", line, text, handled)
		}
	}
	for _, line := range []string{`{"level":"info","msg":"the program logs JSON"}`, `plain output`, `{broken`} {
		if _, handled := cargoConsoleLine(line); handled {
			t.Fatalf("%q belongs to the program", line)
		}
	}
}
