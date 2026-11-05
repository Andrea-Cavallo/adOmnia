package declared

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

func treeFromEvents(t *testing.T, events []idetesting.Event) []idetesting.TestResult {
	t.Helper()
	tree := idetesting.NewTree()
	for _, event := range events {
		tree.Apply(event)
	}
	results, _ := tree.Snapshot()
	return results
}

func findTest(results []idetesting.TestResult, pkg, name string) *idetesting.TestResult {
	// The tree nests package names on "/", which it replaces in IDs and in the rendered package.
	pkg = slashReplacer.Replace(pkg)
	for index := range results {
		if results[index].Package == pkg && results[index].Name == name {
			return &results[index]
		}
	}
	return nil
}

func TestDartReporterBuildsTheTreeWithTheFailingLine(t *testing.T) {
	parser := &dartParser{}
	lines := []string{
		`{"type":"testStart","test":{"id":1,"name":"adds","url":"test/math_test.dart","line":5}}`,
		`{"type":"testDone","testID":1,"result":"success","time":10}`,
		`{"type":"testStart","test":{"id":2,"name":"fails","url":"test/math_test.dart","line":9}}`,
		`{"type":"error","testID":2,"error":"Expected: <3>","stackTrace":"#0 main"}`,
		`{"type":"testDone","testID":2,"result":"failure","time":5}`,
	}
	var events []idetesting.Event
	for _, line := range lines {
		if event, ok := parser.Parse([]byte(line)); ok {
			events = append(events, event)
		}
	}
	results := treeFromEvents(t, events)
	if result := findTest(results, "test/math_test.dart", "adds"); result == nil || result.Status != "pass" {
		t.Fatalf("adds = %+v; results = %+v", result, results)
	}
	failed := findTest(results, "test/math_test.dart", "fails")
	if failed == nil || failed.Status != "fail" || failed.Failure == nil || failed.Failure.Line != 9 {
		t.Fatalf("fails = %+v; results = %+v", failed, results)
	}
}

func TestTAPParserReadsFailureLocation(t *testing.T) {
	parser := &tapParser{}
	for _, line := range []string{
		"t/math.t .. ",
		"ok 1 - adds",
		"not ok 2 - fails",
		"#   Failed test 'fails'",
		"#   at t/math.t line 9.",
		"1..2",
	} {
		if event, ok := parser.Parse([]byte(line)); ok {
			t.Fatalf("TAP emits only at Finish: %+v", event)
		}
	}
	results := treeFromEvents(t, parser.Finish())
	if result := findTest(results, "t/math.t", "adds"); result == nil || result.Status != "pass" {
		t.Fatalf("adds = %+v; results = %+v", result, results)
	}
	failed := findTest(results, "t/math.t", "fails")
	if failed == nil || failed.Status != "fail" || failed.Failure == nil || failed.Failure.File != "t/math.t" || failed.Failure.Line != 9 {
		t.Fatalf("fails = %+v; results = %+v", failed, results)
	}
}

func TestExUnitTraceMarksTheFailedTest(t *testing.T) {
	parser := &exUnitParser{}
	for _, line := range []string{
		"Running ExUnit with seed: 1234, max_cases: 8",
		"",
		"MathTest [test/math_test.exs]",
		"  * test adds [L#5]",
		"  * test fails [L#9]",
		"",
		"  1) test fails (MathTest)",
		"     test/math_test.exs:9",
		"     Assertion with == failed",
		"     code:  assert 1 + 1 == 3",
		"",
		"Finished in 0.02 seconds (0.00s async, 0.02s sync)",
		"2 tests, 1 failure",
	} {
		if _, ok := parser.Parse([]byte(line)); ok {
			t.Fatal("ExUnit emits only at Finish")
		}
	}
	results := treeFromEvents(t, parser.Finish())
	if result := findTest(results, "test/math_test.exs", "adds"); result == nil || result.Status != "pass" {
		t.Fatalf("adds = %+v; results = %+v", result, results)
	}
	failed := findTest(results, "test/math_test.exs", "fails")
	if failed == nil || failed.Status != "fail" || failed.Failure == nil || failed.Failure.Line != 9 || failed.Output == "" {
		t.Fatalf("fails = %+v; results = %+v", failed, results)
	}
}

func TestRSpecJSONReport(t *testing.T) {
	directory := t.TempDir()
	report := `{"examples":[
		{"description":"adds","full_description":"Math adds","status":"passed","file_path":"./spec/math_spec.rb","line_number":5,"run_time":0.01},
		{"description":"fails","full_description":"Math fails","status":"failed","file_path":"./spec/math_spec.rb","line_number":9,"run_time":0.02,
		 "exception":{"message":"expected 3","backtrace":["spec/math_spec.rb:9"]}}
	]}`
	if err := os.WriteFile(filepath.Join(directory, "rspec.json"), []byte(report), 0o600); err != nil {
		t.Fatal(err)
	}
	results := treeFromEvents(t, (&reportParser{directory: directory}).Finish())
	if result := findTest(results, "./spec/math_spec.rb", "Math adds"); result == nil || result.Status != "pass" {
		t.Fatalf("adds = %+v; results = %+v", result, results)
	}
	failed := findTest(results, "./spec/math_spec.rb", "Math fails")
	if failed == nil || failed.Status != "fail" || failed.Failure == nil || failed.Failure.Line != 9 {
		t.Fatalf("fails = %+v; results = %+v", failed, results)
	}
}

func TestBustedJUnitOnStdout(t *testing.T) {
	parser := &bufferedXMLParser{}
	for _, line := range []string{
		`<testsuites><testsuite name="calc">`,
		`<testcase name="adds" classname="calc"/>`,
		`<testcase name="fails" classname="calc"><failure message="boom"/></testcase>`,
		`</testsuite></testsuites>`,
	} {
		if _, ok := parser.Parse([]byte(line)); ok {
			t.Fatal("the XML is parsed once at Finish")
		}
	}
	results := treeFromEvents(t, parser.Finish())
	if result := findTest(results, "calc", "adds"); result == nil || result.Status != "pass" {
		t.Fatalf("adds = %+v; results = %+v", result, results)
	}
	if result := findTest(results, "calc", "fails"); result == nil || result.Status != "fail" {
		t.Fatalf("fails = %+v", result)
	}
}

func TestSingleTestRerunNarrowsTheCommand(t *testing.T) {
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(name string) (string, error) { return "/bin/" + name, nil }
	root := t.TempDir()
	cases := []struct {
		language string
		filter   string
		want     []string
	}{
		{"dart", "adds", []string{"-n", "^adds$"}},
		{"ruby", "adds", []string{"-e", "adds"}},
		{"lua", "adds", []string{"--filter", "adds"}},
		{"elixir", "test/math_test.exs:9", []string{"test/math_test.exs:9"}},
		{"scala", "adds", []string{"testOnly * -- -z adds"}},
		{"haskell", "Math.adds", []string{`--ta=-p/Math\.adds/`}},
	}
	for _, test := range cases {
		adapter := rowAdapter(t, test.language)
		runner, ok := adapter.(language.TestRunner)
		if !ok {
			t.Fatalf("%s has no test runner", test.language)
		}
		options, _ := json.Marshal(map[string]string{"run": test.filter})
		spec, _, err := runner.TestCommand(idetesting.Request{
			Root: root, WorkingDirectory: root,
			LanguageOptions: options,
		})
		if err != nil {
			t.Fatalf("%s: %v", test.language, err)
		}
		for _, want := range test.want {
			if !slices.Contains(spec.Arguments, want) {
				t.Fatalf("%s arguments = %v, missing %q", test.language, spec.Arguments, want)
			}
		}
	}
	zig := rowAdapter(t, "zig").(language.TestRunner)
	if _, _, err := zig.TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"run":"adds"}`)}); err == nil {
		t.Fatal("a language without a single-test filter must say so")
	}
}

func TestZigRunnerLinesAndFailureLocation(t *testing.T) {
	parser := &zigParser{}
	for _, line := range []string{
		"1/2 test.add... OK",
		"2/2 test.sub... FAIL (TestExpectedEqual)",
		"/ws/src/math.zig:9:5: 0x000 in test.sub",
	} {
		if _, ok := parser.Parse([]byte(line)); ok {
			t.Fatal("Zig emits only at Finish")
		}
	}
	results := treeFromEvents(t, parser.Finish())
	if result := findTest(results, "zig", "test.add"); result == nil || result.Status != "pass" {
		t.Fatalf("add = %+v", result)
	}
	failed := findTest(results, "zig", "test.sub")
	if failed == nil || failed.Status != "fail" || failed.Failure == nil || failed.Failure.Line != 9 {
		t.Fatalf("sub = %+v", failed)
	}
}

func TestTastyXMLReport(t *testing.T) {
	directory := t.TempDir()
	report := `<test-suite>
		<test-case name="Math.adds" result="success" time="0.01"/>
		<test-case name="Math.fails" result="failure" time="0.02"><failure><message>boom</message></failure></test-case>
	</test-suite>`
	if err := os.WriteFile(filepath.Join(directory, "tasty.xml"), []byte(report), 0o600); err != nil {
		t.Fatal(err)
	}
	results := treeFromEvents(t, (&reportParser{directory: directory}).Finish())
	if result := findTest(results, "tasty", "Math.adds"); result == nil || result.Status != "pass" {
		t.Fatalf("adds = %+v", result)
	}
	if result := findTest(results, "tasty", "Math.fails"); result == nil || result.Status != "fail" {
		t.Fatalf("fails = %+v", result)
	}
}

func TestScalaReadsProjectReportsWithoutDeletingThem(t *testing.T) {
	root := t.TempDir()
	directory := scalaReportDirectory(root)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	report := `<testsuite name="MathSpec"><testcase name="adds" classname="MathSpec"/><testcase name="fails" classname="MathSpec"><failure message="boom"/></testcase></testsuite>`
	if err := os.WriteFile(filepath.Join(directory, "math.xml"), []byte(report), 0o600); err != nil {
		t.Fatal(err)
	}
	parser := &reportParser{directory: directory, keep: true}
	results := treeFromEvents(t, parser.Finish())
	if result := findTest(results, "MathSpec", "adds"); result == nil || result.Status != "pass" {
		t.Fatalf("adds = %+v", result)
	}
	if _, err := os.Stat(directory); err != nil {
		t.Fatalf("the project report folder must survive: %v", err)
	}
}

func TestCTestFindsTheConfiguredBuildDirectory(t *testing.T) {
	root := t.TempDir()
	if _, err := ctestBuildDirectory(root); err == nil {
		t.Fatal("a project without a configured build must say so")
	}
	if err := os.MkdirAll(filepath.Join(root, "build"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "build", "CTestTestfile.cmake"), []byte("#"), 0o600); err != nil {
		t.Fatal(err)
	}
	if dir, err := ctestBuildDirectory(root); err != nil || dir != "build" {
		t.Fatalf("build dir = %q, %v", dir, err)
	}

	preset := t.TempDir()
	if err := os.MkdirAll(filepath.Join(preset, "cmake-build-debug"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(preset, "cmake-build-debug", "CTestTestfile.cmake"), []byte("#"), 0o600); err != nil {
		t.Fatal(err)
	}
	args, err := prepareCTest(preset, []string{"--test-dir", "build", "--output-junit", "x.xml"})
	if err != nil || args[1] != "cmake-build-debug" || args[0] != "--test-dir" {
		t.Fatalf("args = %v, %v", args, err)
	}
}
