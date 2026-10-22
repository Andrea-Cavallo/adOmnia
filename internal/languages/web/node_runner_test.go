package web

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	idetesting "adomnia/internal/ide/testing"
)

func TestDetectsNodeTestScript(t *testing.T) {
	for script, want := range map[string]string{
		"node --test":                            TestNode,
		"node --test src/":                       TestNode,
		"node --experimental-strip-types --test": TestNode,
		"cross-env CI=1 node --test":             TestNode,
		"node server.js":                         "",
		"echo --test":                            "",
	} {
		if got := detectTestFramework(packageManifest{Scripts: map[string]string{"test": script}}); got != want {
			t.Errorf("script %q: framework %q, want %q", script, got, want)
		}
	}
	withVitest := packageManifest{Scripts: map[string]string{"test": "node --test"}, DevDependencies: map[string]string{"vitest": "1"}}
	if got := detectTestFramework(withVitest); got != "vitest" {
		t.Errorf("a declared Vitest must win over the node script, got %q", got)
	}
}

func TestNodeReportParserBuildsTree(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "src", "sum.test.js")
	lines := []string{
		`noise printed by the runner`,
		nodeRecordPrefix + `{"file":` + jsonString(file) + `,"path":["sum","adds"],"status":"pass","ms":1.5,"line":3}`,
		nodeRecordPrefix + `{"file":` + jsonString(file) + `,"path":["sum","edge/cases","overflows"],"status":"fail","ms":2,"line":6,"message":"1 !== 2","stack":` + jsonString("at Object.<anonymous> ("+file+":6:34)") + `}`,
		nodeRecordPrefix + `{"file":` + jsonString(file) + `,"path":["sum","later"],"status":"skip","ms":0,"line":8}`,
		nodeRecordPrefix + `{"file":` + jsonString(filepath.Join(root, "src", "broken.test.js")) + `,"path":[],"status":"fail","ms":9,"line":1,"message":"test failed"}`,
		nodeRecordPrefix + `not json`,
	}
	results, summary := applyNodeLines(root, lines)
	if summary.Passed != 1 || summary.Skipped != 1 || summary.Failed < 1 {
		t.Fatalf("summary = %+v", summary)
	}
	status := map[string]string{}
	for _, result := range results {
		status[result.Package+"|"+result.Name] = result.Status
	}
	for key, want := range map[string]string{
		"src/sum.test.js|sum/adds":                 "pass",
		"src/sum.test.js|sum/edge∕cases/overflows": "fail",
		"src/sum.test.js|sum/later":                "skip",
		"src/sum.test.js|":                         "fail",
		"src/broken.test.js|":                      "fail",
	} {
		if status[key] != want {
			t.Errorf("%s = %q, want %q (all: %v)", key, status[key], want, status)
		}
	}
	for _, result := range results {
		if result.Name == "sum/edge∕cases/overflows" && (result.Failure == nil || result.Failure.Line != 6) {
			t.Errorf("failure location = %+v, want line 6", result.Failure)
		}
	}
}

// TestNodeTestRunsTheRealRunner prova il percorso intero (comando, reporter, parser) con il Node della macchina.
func TestNodeTestRunsTheRealRunner(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	root := t.TempDir()
	write := func(name, body string) {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("package.json", `{"name":"fixture","scripts":{"test":"node --test"}}`)
	write("src/sum.test.js", `const { describe, it } = require('node:test');
const assert = require('node:assert');
describe('sum', () => {
  it('adds', () => assert.strictEqual(1 + 1, 2));
  describe('edge/cases', () => { it('overflows', () => assert.strictEqual(1, 2)); });
  it('later', { skip: 'not yet' }, () => {});
});`)
	write("src/broken.test.js", `require('./does-not-exist');`)

	spec, parser, err := scriptAdapter{}.TestCommand(idetesting.Request{Root: root, WorkingDirectory: root})
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(spec.Executable, spec.Arguments...)
	command.Dir = spec.WorkingDirectory
	var stdout bytes.Buffer
	command.Stdout = &stdout
	_ = command.Run() // esce con 1: due test falliscono di proposito

	tree := idetesting.NewTree()
	scanner := bufio.NewScanner(&stdout)
	scanner.Buffer(make([]byte, 0, 1<<20), 16<<20)
	for scanner.Scan() {
		for _, event := range parser.(idetesting.BatchParser).ParseAll(scanner.Bytes()) {
			tree.Apply(event)
		}
	}
	for _, event := range parser.(idetesting.Finisher).Finish() {
		tree.Apply(event)
	}
	results, _ := tree.Snapshot()
	status := map[string]string{}
	for _, result := range results {
		status[filepath.ToSlash(result.Package)+"|"+result.Name] = result.Status
	}
	for key, want := range map[string]string{
		"src/sum.test.js|sum/adds":                 "pass",
		"src/sum.test.js|sum/edge∕cases/overflows": "fail",
		"src/sum.test.js|sum/later":                "skip",
		"src/broken.test.js|":                      "fail",
	} {
		if status[key] != want {
			t.Errorf("%s = %q, want %q (all: %v)", key, status[key], want, status)
		}
	}
}

func applyNodeLines(root string, lines []string) ([]idetesting.TestResult, idetesting.TestSummary) {
	parser := &nodeReportParser{root: root}
	tree := idetesting.NewTree()
	for _, line := range lines {
		for _, event := range parser.ParseAll([]byte(line)) {
			tree.Apply(event)
		}
	}
	for _, event := range parser.Finish() {
		tree.Apply(event)
	}
	return tree.Snapshot()
}

func jsonString(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
