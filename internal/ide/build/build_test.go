package build

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// fakeLanguage is the smallest adapter that detects one unit and proposes a build command: the
// build package must work only through the adapter contract, never through a concrete language.
type fakeLanguage struct {
	target      string
	arguments   []string
	withSuggest bool
}

func (f *fakeLanguage) ID() string   { return "fake" }
func (f *fakeLanguage) Name() string { return "Fake" }

func (f *fakeLanguage) DetectUnits(_ context.Context, root string) ([]project.Unit, error) {
	return []project.Unit{{Language: "fake", Kind: "fake-project", Root: root, Name: "demo"}}, nil
}

func (f *fakeLanguage) Suggest(context.Context, string, project.Unit) []run.Suggestion {
	if !f.withSuggest {
		return nil
	}
	return []run.Suggestion{{
		ID: "fake", Language: "fake", Action: "build", Title: "Fake · build",
		Configuration: run.Configuration{Kind: "command", Name: "Fake build", Target: f.target, ProgramArguments: f.arguments},
	}}
}

func fakeRegistry(t *testing.T, adapter language.Language) *language.Registry {
	t.Helper()
	registry := language.NewRegistry()
	if err := registry.Register(adapter); err != nil {
		t.Fatalf("register: %v", err)
	}
	return registry
}

// newFixture puts the current test binary inside the project as its build tool, so the test
// needs no Gradle, no network and no shell. run.Command keeps a command inside the project when
// it carries a path, which is exactly the wrapper case.
func newFixture(t *testing.T) (root, target string) {
	t.Helper()
	root = t.TempDir()
	name := "buildtool"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("test executable: %v", err)
	}
	destination := filepath.Join(root, name)
	if err := os.Link(executable, destination); err != nil {
		data, readErr := os.ReadFile(executable)
		if readErr != nil {
			t.Fatalf("read test executable: %v", readErr)
		}
		if writeErr := os.WriteFile(destination, data, 0o755); writeErr != nil {
			t.Fatalf("copy test executable: %v", writeErr)
		}
	}
	return root, "./" + name
}

func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_BUILD_HELPER") != "1" {
		return
	}
	os.Stdout.WriteString("fake build output\n")
	if os.Getenv("GO_BUILD_HELPER_FAILS") == "1" {
		os.Exit(3)
	}
	os.Exit(0)
}

func TestDetectResolvesTheAdapterCommand(t *testing.T) {
	root, target := newFixture(t)
	adapter := &fakeLanguage{target: target, arguments: []string{"build"}, withSuggest: true}
	plan, err := Detect(context.Background(), fakeRegistry(t, adapter), root, Options{})
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if len(plan.Units) != 1 {
		t.Fatalf("expected one unit, got %d", len(plan.Units))
	}
	unit := plan.Units[0]
	if !unit.Runnable {
		t.Fatalf("expected a runnable unit, reason: %s", unit.Reason)
	}
	if unit.Executable != filepath.Join(root, filepath.Base(target)) || strings.Join(unit.Arguments, " ") != "build" {
		t.Fatalf("unexpected command: %+v", unit)
	}
	if unit.Title != "Fake · build" || unit.Language != "fake" {
		t.Fatalf("unit lost its adapter identity: %+v", unit)
	}
}

func TestDetectWithoutAToolIsNotRunnable(t *testing.T) {
	adapter := &fakeLanguage{withSuggest: false}
	plan, err := Detect(context.Background(), fakeRegistry(t, adapter), t.TempDir(), Options{})
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if len(plan.Units) != 1 || plan.Units[0].Runnable {
		t.Fatalf("expected a unit that cannot run, got %+v", plan.Units)
	}
	if !strings.Contains(plan.Units[0].Reason, "no build tool") {
		t.Fatalf("the reason must explain the missing tool, got %q", plan.Units[0].Reason)
	}
}

func TestDetectRejectsAMissingToolOnPath(t *testing.T) {
	adapter := &fakeLanguage{target: "tool-that-does-not-exist-adomnia", withSuggest: true}
	plan, err := Detect(context.Background(), fakeRegistry(t, adapter), t.TempDir(), Options{})
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if plan.Units[0].Runnable || !strings.Contains(plan.Units[0].Reason, "not found") {
		t.Fatalf("expected a not-found reason, got %+v", plan.Units[0])
	}
}

func TestTaskReplacesTheArgumentsOfACommandBuild(t *testing.T) {
	root, target := newFixture(t)
	adapter := &fakeLanguage{target: target, arguments: []string{"build"}, withSuggest: true}
	plan, err := Detect(context.Background(), fakeRegistry(t, adapter), root, Options{Task: "clean build"})
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if got := strings.Join(plan.Units[0].Arguments, " "); got != "clean build" {
		t.Fatalf("expected the override arguments, got %q", got)
	}
}

func TestExecuteReportsSuccessAndOutput(t *testing.T) {
	root, target := newFixture(t)
	adapter := &fakeLanguage{target: target, arguments: []string{"-test.run=TestHelperProcess"}, withSuggest: true}
	t.Setenv("GO_WANT_BUILD_HELPER", "1")
	plan, err := Detect(context.Background(), fakeRegistry(t, adapter), root, Options{})
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	results := plan.Execute(context.Background(), Options{Timeout: 2 * time.Minute})
	if len(results) != 1 {
		t.Fatalf("expected one result, got %d", len(results))
	}
	result := results[0]
	if result.Status != StatusOK || result.ExitCode != 0 {
		t.Fatalf("expected a successful build, got %+v", result)
	}
	if !strings.Contains(result.Output, "fake build output") {
		t.Fatalf("the output tail is missing: %q", result.Output)
	}
}

func TestExecuteReportsFailureAndExitCode(t *testing.T) {
	root, target := newFixture(t)
	adapter := &fakeLanguage{target: target, arguments: []string{"-test.run=TestHelperProcess"}, withSuggest: true}
	t.Setenv("GO_WANT_BUILD_HELPER", "1")
	t.Setenv("GO_BUILD_HELPER_FAILS", "1")
	plan, err := Detect(context.Background(), fakeRegistry(t, adapter), root, Options{})
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	results := plan.Execute(context.Background(), Options{Timeout: 2 * time.Minute})
	if results[0].Status != StatusFailed || results[0].ExitCode != 3 {
		t.Fatalf("expected a failed build with exit code 3, got %+v", results[0])
	}
}

func TestExecuteSkipsAUnitWithoutTool(t *testing.T) {
	adapter := &fakeLanguage{withSuggest: false}
	plan, err := Detect(context.Background(), fakeRegistry(t, adapter), t.TempDir(), Options{})
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	results := plan.Execute(context.Background(), Options{})
	if results[0].Status != StatusSkipped || results[0].Reason == "" {
		t.Fatalf("expected a skipped unit with a reason, got %+v", results[0])
	}
}

func TestTailBufferKeepsTheEndOfTheLog(t *testing.T) {
	buffer := &tailBuffer{limit: 16}
	buffer.Write([]byte("first line that will be dropped\nlast line\n"))
	if !buffer.truncated {
		t.Fatal("expected the buffer to report truncation")
	}
	if got := buffer.Text(); got != "last line" {
		t.Fatalf("expected the last line only, got %q", got)
	}
}

func TestDetectRejectsAFileAsRoot(t *testing.T) {
	file := filepath.Join(t.TempDir(), "build.gradle")
	if err := os.WriteFile(file, []byte("// build"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := Detect(context.Background(), fakeRegistry(t, &fakeLanguage{withSuggest: true}), file, Options{}); err == nil {
		t.Fatal("expected an error for a file root")
	}
}
