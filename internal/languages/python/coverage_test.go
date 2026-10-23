package python

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	idetesting "adomnia/internal/ide/testing"
	"adomnia/internal/jsonutil"
)

// TestPytestCoverageReportMapsFilesAndLines: il report JSON di coverage.py diventa un report
// neutro con percorsi relativi al progetto e blocchi di una riga (PY-5.5).
func TestPytestCoverageReportMapsFilesAndLines(t *testing.T) {
	root := t.TempDir()
	absolute := filepath.Join(root, "app", "util.py")
	coveragePath := filepath.Join(t.TempDir(), "coverage.json")
	content := fmt.Sprintf(`{
  "totals": {"percent_covered": 62.5, "covered_lines": 5, "num_statements": 8},
  "files": {
    "app/main.py": {"executed_lines": [2, 3], "missing_lines": [5], "summary": {"covered_lines": 2, "num_statements": 3, "percent_covered": 66.7}},
    %q: {"executed_lines": [1], "missing_lines": [2, 3], "summary": {"covered_lines": 1, "num_statements": 4, "percent_covered": 25}}
  }
}`, filepath.ToSlash(absolute))
	if err := os.WriteFile(coveragePath, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	report := newPytestParser(root, filepath.Join(t.TempDir(), "events.jsonl"), coveragePath).Coverage()
	if report == nil {
		t.Fatal("the coverage report was not read")
	}
	if report.Mode != "pytest-cov" || report.Statements != 8 || report.Covered != 5 || report.Percent != 62.5 {
		t.Fatalf("totals %+v", report)
	}
	files := map[string]idetesting.CoverageFile{}
	for _, file := range report.Files {
		files[file.Path] = file
	}
	main, ok := files["app/main.py"]
	if !ok || main.Statements != 3 || main.Covered != 2 || len(main.Blocks) != 3 {
		t.Fatalf("main file %+v (all %+v)", main, report.Files)
	}
	if main.Blocks[0].StartLine != 2 || !main.Blocks[0].Covered || main.Blocks[2].StartLine != 5 || main.Blocks[2].Covered {
		t.Fatalf("blocks %+v", main.Blocks)
	}
	util, ok := files["app/util.py"]
	if !ok || util.Statements != 4 || len(util.Blocks) != 3 {
		t.Fatalf("absolute path was not made relative: %+v", report.Files)
	}
	if again := newPytestParser(root, "", coveragePath).Coverage(); again == nil {
		t.Fatal("coverage is read from the file")
	}
}

// TestCoverageIsOffUnlessRequested: senza coverage non si legge nessun report e il comando pytest
// resta quello di sempre.
func TestCoverageIsOffUnlessRequested(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	data, _ := jsonutil.Marshal(TestOptions{Interpreter: interpreter, Packages: []string{"tests"}})
	spec, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(spec.Arguments, " "), "--cov") {
		t.Fatalf("coverage arguments without coverage: %v", spec.Arguments)
	}
}

// TestCoverageArguments: con Coverage pytest-cov scrive un JSON fuori dal progetto e l'opzione è
// esplicita negli argomenti.
func TestCoverageArguments(t *testing.T) {
	root := t.TempDir()
	interpreter := writeFile(t, root, "python.exe", "")
	data, _ := jsonutil.Marshal(TestOptions{Interpreter: interpreter, Packages: []string{"tests"}, Coverage: true})
	spec, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(spec.Arguments, " ")
	if !strings.Contains(joined, "--cov --cov-report=json:") {
		t.Fatalf("coverage arguments %q", joined)
	}
}

// TestRealPytestCoverageReport esegue pytest-cov vero: il report arriva dal file e contiene il
// modulo del progetto. Senza pytest-cov il test si salta con il motivo (PY-9.1).
func TestRealPytestCoverageReport(t *testing.T) {
	interpreter := testInterpreterWith(t, "pytest_cov")
	root := t.TempDir()
	writeFile(t, root, "app.py", "def add(a, b):\n    return a + b\n\n\ndef unused():\n    return 0\n")
	writeFile(t, root, "tests/test_app.py", "from app import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n")
	data, _ := jsonutil.Marshal(TestOptions{Interpreter: interpreter, Packages: []string{"tests"}, Coverage: true})
	spec, parser, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: data})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, spec.Executable, spec.Arguments...)
	command.Dir = spec.WorkingDirectory
	command.Env = spec.Environment
	output, err := command.CombinedOutput()
	if err != nil && ctx.Err() != nil {
		t.Fatalf("pytest timed out: %s", output)
	}
	batch, ok := parser.(idetesting.BatchParser)
	if !ok {
		t.Fatal("the pytest parser is not a batch parser")
	}
	for _, line := range strings.Split(string(output), "\n") {
		batch.ParseAll([]byte(line))
	}
	provider, ok := parser.(idetesting.CoverageProvider)
	if !ok {
		t.Fatal("the pytest parser does not expose coverage")
	}
	report := provider.Coverage()
	if report == nil || report.Mode != "pytest-cov" || len(report.Files) == 0 {
		t.Fatalf("coverage report missing: %+v\noutput:\n%s", report, output)
	}
	found := false
	for _, file := range report.Files {
		if file.Path == "app.py" && len(file.Blocks) > 0 {
			found = true
		}
	}
	if !found {
		t.Fatalf("app.py is not in the coverage report: %+v", report.Files)
	}
	if report.Percent <= 0 || report.Percent > 100 {
		t.Fatalf("percent %v", report.Percent)
	}
}
