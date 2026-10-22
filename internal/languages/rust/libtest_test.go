package rust

import (
	"strconv"
	"strings"
	"testing"

	idetesting "adomnia/internal/ide/testing"
)

func parseRust(t *testing.T, pkg string, output string) []idetesting.TestResult {
	t.Helper()
	parser := newLibtestParser(pkg)
	tree := idetesting.NewTree()
	for _, line := range strings.Split(output, "\n") {
		if event, ok := parser.Parse([]byte(line)); ok {
			tree.Apply(event)
		}
	}
	results, _ := tree.Snapshot()
	return results
}

func TestLibtestParsesPassFailAndPanicLocation(t *testing.T) {
	output := `running 2 tests
test tests::it_works ... ok
test tests::fails ... FAILED

failures:

---- tests::fails stdout ----
thread 'tests::fails' panicked at src/lib.rs:5:5:
assertion failed
note: run with ` + "`RUST_BACKTRACE=1`" + ` environment variable to display a backtrace


failures:
    tests::fails

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
`
	results := parseRust(t, "mylib", output)
	byID := map[string]idetesting.TestResult{}
	for _, r := range results {
		byID[r.ID] = r
	}
	ok := byID["mylib\x00tests/it_works"]
	if ok.Status != "pass" {
		t.Fatalf("it_works = %+v", ok)
	}
	fail := byID["mylib\x00tests/fails"]
	if fail.Status != "fail" {
		t.Fatalf("fails = %+v", fail)
	}
	if fail.Failure == nil || fail.Failure.File != "src/lib.rs" || fail.Failure.Line != 5 {
		t.Fatalf("panic location = %+v", fail.Failure)
	}
	if !strings.Contains(fail.Output, "assertion failed") {
		t.Fatalf("output = %q", fail.Output)
	}
}

func TestLibtestIgnoredAndIntegration(t *testing.T) {
	output := `     Running unittests src/lib.rs (target/debug/deps/mylib-0123456789abcdef)

running 2 tests
test slow ... ignored
test fast ... ok

test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out

     Running tests/integration.rs (target/debug/deps/integration-0123456789abcdef)

running 1 test
test it_works ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
`
	results := parseRust(t, "mylib", output)
	byID := map[string]idetesting.TestResult{}
	for _, r := range results {
		byID[r.ID] = r
	}
	if byID["mylib\x00slow"].Status != "skip" {
		t.Fatalf("slow = %+v", byID["mylib\x00slow"])
	}
	// Il test di integrazione è prefissato dal file per non confondersi con gli unit test.
	if byID["mylib\x00tests/integration.rs/it_works"].Status != "pass" {
		t.Fatalf("integration = %+v", byID)
	}
}

func TestLibtestCompileErrorIsBuildOutput(t *testing.T) {
	output := "error[E0308]: mismatched types\n  --> src/lib.rs:3:5\n"
	parser := newLibtestParser("mylib")
	var events []idetesting.Event
	for _, line := range strings.Split(output, "\n") {
		if ev, ok := parser.Parse([]byte(line)); ok {
			events = append(events, ev)
		}
	}
	if len(events) != 1 || events[0].Action != "build-output" || events[0].Package != "mylib" {
		t.Fatalf("events = %+v", events)
	}
}

func TestTestCommandBuildsCargoTest(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"mylib\"\n")
	cargo := writeFile(t, root, "cargo.exe", "")
	original := pathCargo
	pathCargo = func() string { return cargo }
	defer func() { pathCargo = original }()

	spec, parser, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"run":"tests::it_works"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if joined := strings.Join(spec.Arguments, " "); joined != "test --no-fail-fast tests::it_works -- --exact" {
		t.Fatalf("arguments = %q", joined)
	}
	if parser == nil {
		t.Fatal("parser must not be nil")
	}
}

func TestTestCommandRejectsOptionShapedRun(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"mylib\"\n")
	cargo := writeFile(t, root, "cargo.exe", "")
	original := pathCargo
	pathCargo = func() string { return cargo }
	defer func() { pathCargo = original }()

	if _, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"run":"--nocapture"}`)}); err == nil {
		t.Fatal("a test name shaped like an option must be rejected")
	}
}

func TestLibtestFilterAcceptsTreeNamesAndLibtestPaths(t *testing.T) {
	cases := []struct {
		run   string
		want  string
		exact bool
	}{
		{"tests::it_works", "tests::it_works", true},
		{"tests/it_works", "tests::it_works", true},
		{"tests/api.rs/health_check", "health_check", true},
		{"handlers/user/tests/creates", "handlers::user::tests::creates", true},
		{"src/lib.rs - add (line 3)", "src/lib.rs - add (line 3)", true},
		{"tests::", "tests::", false},
		{"handlers/", "handlers::", false},
	}
	for _, tc := range cases {
		if got, exact := libtestFilter(tc.run); got != tc.want || exact != tc.exact {
			t.Errorf("libtestFilter(%q) = %q, %v; want %q, %v", tc.run, got, exact, tc.want, tc.exact)
		}
	}
}

func TestTestCommandRerunFromTreeNameRunsTheTest(t *testing.T) {
	root := t.TempDir()
	cargo := writeFile(t, root, "cargo.exe", "")
	spec, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"toolchain":` + strconv.Quote(cargo) + `,"run":"tests/it_works"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(spec.Arguments, " "); got != "test --no-fail-fast tests::it_works -- --exact" {
		t.Fatalf("args = %q", got)
	}
}

func TestTestCommandRerunFailedPassesEveryNameAfterTheSeparator(t *testing.T) {
	root := t.TempDir()
	cargo := writeFile(t, root, "cargo.exe", "")
	options := `{"toolchain":` + strconv.Quote(cargo) + `,"run":"tests::a\ntests::b"}`
	spec, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(options)})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(spec.Arguments, " "); got != "test --no-fail-fast -- --exact tests::a tests::b" {
		t.Fatalf("args = %q", got)
	}
	for _, bad := range []string{`"--nocapture"`, `"tests::a\n--ignored"`} {
		bad := `{"toolchain":` + strconv.Quote(cargo) + `,"run":` + bad + `}`
		if _, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: []byte(bad)}); err == nil {
			t.Fatalf("%s must be rejected", bad)
		}
	}
}

// RS-5.2 / workspace virtuale: senza [package] il nome del crate arriva dalle righe `Running` e
// `Doc-tests`; prima il pacchetto vuoto faceva scartare ogni evento e l'albero restava vuoto.
func TestLibtestVirtualWorkspaceAttributesTestsToTheirCrates(t *testing.T) {
	output := `     Running unittests src/lib.rs (target/debug/deps/util-0123456789abcdef)

running 1 test
test tests::doubles ... ok

     Running unittests crates/api/src/main.rs (target/debug/deps/api-0123456789abcdef)

running 1 test
test handlers::tests::health ... FAILED

     Running crates\api\tests\it.rs (target\debug\deps\it-0123456789abcdef)

running 1 test
test boots ... ok

   Doc-tests util

running 1 test
test src/lib.rs - double (line 2) ... ok
`
	results := parseRust(t, "workspace", output)
	ids := map[string]string{}
	for _, result := range results {
		ids[result.ID] = result.Status
	}
	want := map[string]string{
		"util\x00tests/doubles":                "pass",
		"api\x00handlers/tests/health":         "fail",
		"api\x00tests/it.rs/boots":             "pass",
		"util\x00src/lib.rs - double (line 2)": "pass",
	}
	for id, status := range want {
		if ids[id] != status {
			t.Errorf("%q = %q, want %q (all: %v)", id, ids[id], status, ids)
		}
	}
}
