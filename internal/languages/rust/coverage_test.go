package rust

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	idetesting "adomnia/internal/ide/testing"
)

// TestRustCoverageReportMapsLCOVFilesAndLines: il report LCOV di cargo-llvm-cov diventa un report
// neutro con blocchi per riga, totali e percorsi relativi alla radice del progetto (RS-5.6).
func TestRustCoverageReportMapsLCOVFilesAndLines(t *testing.T) {
	root := t.TempDir()
	lcov := strings.Join([]string{
		"SF:" + filepath.Join(root, "src", "lib.rs"),
		"DA:1,1",
		"DA:2,0",
		"DA:7,3",
		"LF:3",
		"LH:2",
		"end_of_record",
		"SF:" + filepath.Join(root, "src", "other.rs"),
		"DA:4,0",
		"LF:1",
		"LH:0",
		"end_of_record",
	}, "\n")

	report := convertLCOV(root, []byte(lcov))
	if report == nil {
		t.Fatal("a report with files must convert")
	}
	if report.Mode != coverageTool {
		t.Fatalf("mode = %q, want %q", report.Mode, coverageTool)
	}
	if report.Statements != 4 || report.Covered != 2 || report.Percent != 50 {
		t.Fatalf("totals = %d/%d (%v), want 4/2 (50)", report.Covered, report.Statements, report.Percent)
	}
	if len(report.Files) != 2 {
		t.Fatalf("files = %d, want 2", len(report.Files))
	}
	first := report.Files[0]
	if first.Path != "src/lib.rs" {
		t.Fatalf("path = %q, want src/lib.rs", first.Path)
	}
	if first.Statements != 3 || first.Covered != 2 || len(first.Blocks) != 3 {
		t.Fatalf("first file = %+v", first)
	}
	if !first.Blocks[0].Covered || first.Blocks[1].Covered || !first.Blocks[2].Covered {
		t.Fatalf("blocks = %+v", first.Blocks)
	}
	if first.Blocks[1].StartLine != 2 || first.Blocks[1].EndLine != 2 {
		t.Fatalf("uncovered block must sit on line 2: %+v", first.Blocks[1])
	}
	if report.Files[1].Path != "src/other.rs" || report.Files[1].Percent != 0 {
		t.Fatalf("second file = %+v", report.Files[1])
	}

	if empty := convertLCOV(root, []byte("TN:\n")); empty != nil {
		t.Fatalf("a report without files must convert to nil, got %+v", empty)
	}
}

// TestRustCoverageIsOffUnlessRequested: senza "Run with coverage" il comando resta `cargo test` e
// il parser non legge nessun report (la baseline dei test non dipende dalla coverage).
func TestRustCoverageIsOffUnlessRequested(t *testing.T) {
	root := t.TempDir()
	cargo := filepath.Join(root, "cargo.exe")
	originalPath, originalLook := pathCargo, lookPath
	pathCargo = func() string { return cargo }
	lookPath = func(string) (string, error) { return cargo, nil }
	defer func() { pathCargo, lookPath = originalPath, originalLook }()

	spec, parser, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Arguments[0] != "test" || strings.Contains(strings.Join(spec.Arguments, " "), "llvm-cov") {
		t.Fatalf("without coverage the command must stay `cargo test`, got %v", spec.Arguments)
	}
	if parser.(*libtestParser).coveragePath != "" || parser.(*libtestParser).Coverage() != nil {
		t.Fatal("without coverage no report must be read")
	}
}

// TestRustCoverageWithoutTheToolExplainsHowToInstall: cargo-llvm-cov è opzionale e non si installa
// mai in automatico; mancando, il messaggio dice i comandi espliciti (RS-5.6).
func TestRustCoverageWithoutTheToolExplainsHowToInstall(t *testing.T) {
	root := t.TempDir()
	originalPath, originalLook := pathCargo, lookPath
	pathCargo = func() string { return filepath.Join(root, "cargo.exe") }
	lookPath = func(string) (string, error) { return "", errNotFound }
	defer func() { pathCargo, lookPath = originalPath, originalLook }()

	_, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"coverage":true}`)})
	if err == nil || !strings.Contains(err.Error(), "cargo install cargo-llvm-cov") || !strings.Contains(err.Error(), "llvm-tools") {
		t.Fatalf("the missing tool must be explained with the install commands, got %v", err)
	}
}

// TestRustCoverageCommandWritesTheReportOutsideTheProject: il report LCOV va in una cartella
// temporanea fuori dal progetto e i filtri passano al binario di test dopo `--`.
func TestRustCoverageCommandWritesTheReportOutsideTheProject(t *testing.T) {
	root := t.TempDir()
	originalPath, originalLook := pathCargo, lookPath
	pathCargo = func() string { return filepath.Join(root, "cargo.exe") }
	lookPath = func(string) (string, error) { return filepath.Join(root, "cargo-llvm-cov.exe"), nil }
	defer func() { pathCargo, lookPath = originalPath, originalLook }()

	spec, parser, err := New().TestCommand(idetesting.Request{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"run":"tests::it_works","coverage":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	arguments := spec.Arguments
	if len(arguments) < 6 || arguments[0] != "llvm-cov" || arguments[1] != "--lcov" || arguments[2] != "--output-path" {
		t.Fatalf("arguments = %v", arguments)
	}
	coveragePath := arguments[3]
	if relative, err := filepath.Rel(root, coveragePath); err == nil && !strings.HasPrefix(relative, "..") {
		t.Fatalf("the coverage report must live outside the project, got %s", coveragePath)
	}
	if parser.(*libtestParser).coveragePath != coveragePath {
		t.Fatalf("the parser must read %s, got %q", coveragePath, parser.(*libtestParser).coveragePath)
	}
	if tail := strings.Join(arguments[4:], " "); tail != "--no-fail-fast -- tests::it_works --exact" {
		t.Fatalf("filter arguments = %q", tail)
	}

	// Rerun failed: più nomi esatti dopo `-- --exact`.
	multi, _, err := New().TestCommand(idetesting.Request{
		Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"run":"tests::a\ntests::b","coverage":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if tail := strings.Join(multi.Arguments[4:], " "); tail != "--no-fail-fast -- --exact tests::a tests::b" {
		t.Fatalf("rerun arguments = %q", tail)
	}
}

// TestRealCargoLlvmCovProducesCoverageReport esegue cargo-llvm-cov vero: il report arriva dal file
// temporaneo e copre le righe eseguite del test (RS-5.6, opt-in come gli altri test reali).
func TestRealCargoLlvmCovProducesCoverageReport(t *testing.T) {
	requireRealCargo(t)
	if _, err := exec.LookPath("cargo"); err != nil {
		t.Skip("cargo is not installed (set up Rust to run this check)")
	}
	if !coverageAvailable() {
		t.Skip("cargo-llvm-cov is not installed: install it explicitly to run this check")
	}
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/lib.rs", "pub fn covered() -> i32 { 1 }\npub fn missed() -> i32 { 2 }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn hit() { assert_eq!(super::covered(), 1); }\n}\n")

	spec, parser, err := New().TestCommand(idetesting.Request{
		Root: root, WorkingDirectory: root, Environment: os.Environ(),
		LanguageOptions: []byte(`{"coverage":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(spec.Executable, spec.Arguments...)
	command.Dir, command.Env = root, spec.Environment
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("cargo llvm-cov failed: %v\n%s", err, output)
	}
	report := parser.(*libtestParser).Coverage()
	if report == nil {
		t.Fatal("the run produced no coverage report")
	}
	if report.Mode != coverageTool || report.Statements < 2 || report.Covered < 1 {
		t.Fatalf("report = %+v", report)
	}
	if again := parser.(*libtestParser).Coverage(); again != report {
		t.Fatal("the report must be computed once")
	}
	var found bool
	for _, file := range report.Files {
		if file.Path == "src/lib.rs" {
			found = true
			if len(file.Blocks) < 2 {
				t.Fatalf("line blocks missing in %+v", file)
			}
		}
	}
	if !found {
		t.Fatalf("src/lib.rs missing from %+v", report.Files)
	}
}
