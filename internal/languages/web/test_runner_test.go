package web

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	idetesting "adomnia/internal/ide/testing"
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
		pretty, _ := json.MarshalIndent(value, "", "  ")
		text = string(pretty)
	} else {
		compact, _ := json.Marshal(value)
		text = string(compact)
	}
	parser := &reportParser{root: root}
	tree := idetesting.NewTree()
	for _, line := range strings.Split(text, "\n") {
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
	got := testArguments(Info{PackageManager: PNPM, TestFramework: "vitest"}, TestOptions{Run: "adds", Packages: []string{"src/sum.test.ts"}})
	want := "exec vitest run --reporter=json -t adds src/sum.test.ts"
	if strings.Join(got, " ") != want {
		t.Fatalf("pnpm arguments = %q, want %q", got, want)
	}
	if npm := strings.Join(testArguments(Info{PackageManager: NPM, TestFramework: "jest"}, TestOptions{}), " "); npm != "exec -- jest --json --ci" {
		t.Fatalf("npm arguments = %q", npm)
	}
	_, _, err := scriptAdapter{}.TestCommand(idetesting.Request{Root: root, WorkingDirectory: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "no Vitest or Jest") {
		t.Fatalf("a folder without a runner must explain itself, got %v", err)
	}
}
