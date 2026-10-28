package web

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

const sampleReport = `{"testResults":[
 {"name":"ROOT/src/sum.test.ts","status":"failed","startTime":1000,"endTime":1250,"assertionResults":[
  {"ancestorTitles":["sum"],"title":"adds","status":"passed","duration":3},
  {"ancestorTitles":["sum","edge/cases"],"title":"overflows","status":"failed","duration":5,"failureMessages":["Error: boom\n    at ROOT/src/sum.test.ts:12:9\n    at node_modules/x/index.js:1:1"]},
  {"ancestorTitles":["sum"],"title":"later","status":"pending","duration":0}]},
 {"name":"ROOT/src/broken.test.ts","status":"failed","message":"SyntaxError: Unexpected token","assertionResults":[]}]}`

func runParser(t *testing.T, root, report string, indented bool) ([]idetesting.TestResult, idetesting.TestSummary) {
	t.Helper()
	text := strings.ReplaceAll(report, "ROOT", filepath.ToSlash(root))
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		t.Fatal(err)
	}
	if indented {
		pretty, _ := jsonutil.Marshal(value, jsontext.WithIndent("  "))
		text = string(pretty)
	} else {
		compact, _ := jsonutil.Marshal(value)
		text = string(compact)
	}
	parser := &reportParser{root: root}
	tree := idetesting.NewTree()
	for line := range strings.SplitSeq(text, "\n") {
		for _, event := range parser.ParseAll([]byte(line)) {
			tree.Apply(event)
		}
	}
	return tree.Snapshot()
}

func TestReportParserBuildsTreeFromJestAndVitestShapes(t *testing.T) {
	root := t.TempDir()
	for _, indented := range []bool{false, true} {
		results, summary := runParser(t, root, sampleReport, indented)
		if summary.Passed != 1 || summary.Failed != 2 || summary.Skipped != 1 {
			t.Fatalf("indented=%v summary = %+v", indented, summary)
		}
		status := map[string]string{}
		for _, result := range results {
			status[result.Package+"|"+result.Name] = result.Status
		}
		if status["src/sum.test.ts|sum/edge∕cases/overflows"] != "fail" || status["src/sum.test.ts|sum/adds"] != "pass" {
			t.Fatalf("indented=%v statuses = %v", indented, status)
		}
		for _, result := range results {
			if strings.HasSuffix(result.Name, "overflows") && (result.Failure == nil || result.Failure.Line != 12 || result.Failure.RelativePath != "src/sum.test.ts") {
				t.Fatalf("failure location = %+v", result.Failure)
			}
			if result.Package == "src/broken.test.ts" && result.Name == "" && !strings.Contains(result.Output, "SyntaxError") {
				t.Fatalf("suite error lost: %+v", result)
			}
		}
	}
}

func TestReportParserIgnoresNoiseBeforeTheReport(t *testing.T) {
	parser := &reportParser{root: t.TempDir()}
	if events := parser.ParseAll([]byte("> app@1.0.0 test")); len(events) != 0 {
		t.Fatalf("noise produced events: %v", events)
	}
}

func TestTestCommandUsesTheProjectRunner(t *testing.T) {
	root := t.TempDir()
	manifest := `{"name":"app","devDependencies":{"vitest":"^2.0.0"}}`
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o700); err != nil {
		t.Fatal(err)
	}
	got := testArguments(Info{PackageManager: PNPM, TestFramework: "vitest"}, TestOptions{Run: "adds", Packages: []string{"src/sum.test.ts"}}, "out.json")
	want := "exec vitest run --reporter=json --outputFile=out.json -t adds src/sum.test.ts"
	if strings.Join(got, " ") != want {
		t.Fatalf("pnpm arguments = %q, want %q", got, want)
	}
	if npm := strings.Join(testArguments(Info{PackageManager: NPM, TestFramework: "jest"}, TestOptions{}, ""), " "); npm != "exec -- jest --json --ci" {
		t.Fatalf("npm arguments = %q", npm)
	}
	_, _, err := scriptAdapter{}.TestCommand(idetesting.Request{Root: root, WorkingDirectory: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "no Vitest or Jest") {
		t.Fatalf("a folder without a runner must explain itself, got %v", err)
	}
}

func TestReportParserReadsTheFileVitestAnnounces(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(t.TempDir(), "report.json")
	text := strings.ReplaceAll(sampleReport, "ROOT", filepath.ToSlash(root))
	if err := os.WriteFile(file, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	parser := &reportParser{root: root, file: file}
	tree := idetesting.NewTree()
	for _, event := range parser.ParseAll([]byte("JSON report written to " + file)) {
		tree.Apply(event)
	}
	if _, summary := tree.Snapshot(); summary.Passed != 1 || summary.Failed != 2 {
		t.Fatalf("summary = %+v", summary)
	}
	if _, err := os.Stat(file); err == nil {
		t.Fatal("the report file must be removed after reading")
	}
}

func TestBatchArgumentsAreCheckedOnWindows(t *testing.T) {
	err := run.CheckBatchSafe(`C:\Program Files\nodejs\npm.cmd`, []string{"exec", "--", "vitest", "-t", "a & b"})
	if runtime.GOOS == "windows" && (err == nil || !strings.Contains(err.Error(), "whole test file")) {
		t.Fatalf("a batch-file package manager must not receive %q, got %v", "a & b", err)
	}
	if runtime.GOOS != "windows" && err != nil {
		t.Fatalf("only Windows batch files need the check, got %v", err)
	}
	if err := run.CheckBatchSafe(`C:\tools\node.exe`, []string{"-t", "a & b"}); err != nil {
		t.Fatalf("a real executable takes any argument, got %v", err)
	}
	if err := run.CheckBatchSafe(`C:\Program Files\nodejs\npm.cmd`, []string{"exec", "--", "vitest", "run", "--reporter=json", "-t", `sum\x20adds$`}); err != nil {
		t.Fatalf("an encoded filter is safe, got %v", err)
	}
}
