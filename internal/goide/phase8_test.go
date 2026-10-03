package goide

import (
	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type fixtureRunner struct{ binary string }

func (f *fixtureRunner) ID() string         { return "fixture" }
func (f *fixtureRunner) Name() string       { return "Fixture" }
func (f *fixtureRunner) RunKinds() []string { return []string{"fixture-run"} }
func (f *fixtureRunner) CommandSpec(r run.Request) (run.CommandSpec, error) {
	var options struct {
		Marker string `json:"marker"`
	}
	if err := json.Unmarshal(r.LanguageOptions, &options); err != nil {
		return run.CommandSpec{}, err
	}
	if options.Marker != "opaque-kept" {
		return run.CommandSpec{}, fmt.Errorf("options lost")
	}
	return run.CommandSpec{Executable: f.binary, Arguments: []string{"-test.run=^TestPhase8Process$"}, Environment: r.Environment, DisplayCommand: "fixture"}, nil
}
func (f *fixtureRunner) TestCommand(r idetesting.Request) (run.CommandSpec, idetesting.EventParser, error) {
	s, err := f.CommandSpec(run.Request{LanguageOptions: r.LanguageOptions, Environment: r.Environment})
	return s, fixtureParser{}, err
}

type fixtureParser struct{}

func (fixtureParser) Parse(line []byte) (idetesting.Event, bool) {
	if string(line) == "fixture-pass" {
		return idetesting.Event{Action: "pass", Package: "fixture", Test: "case", Output: "fixture-pass"}, true
	}
	return idetesting.Event{}, false
}
func TestPhase8Process(t *testing.T) {
	if os.Getenv("ADOMNIA_PHASE8_HELPER") != "1" {
		return
	}
	if os.Getenv("PHASE8_REQUIRE_ENV") == "1" && (os.Getenv("FROM_FILE") != "explicit" || os.Getenv("FILE_ONLY") != "loaded" || os.Getenv("PORT") == "") {
		os.Exit(3)
	}
	fmt.Print("fixture-pass")
	os.Exit(0)
}

func TestPhase8RegistryRunAndTestsWithoutGo(t *testing.T) {
	root := t.TempDir()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	name := "runner" + filepath.Ext(binary)
	if err := os.WriteFile(filepath.Join(root, name), data, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", root)
	t.Setenv("GOTOOLCHAIN", "")
	if _, err := exec.LookPath("go"); err == nil {
		t.Fatal("Go must be absent")
	}
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	if err := service.workspace.languages.Register(&fixtureRunner{binary: filepath.Join(root, name)}); err != nil {
		t.Fatal(err)
	}
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	options := json.RawMessage(`{"marker":"opaque-kept"}`)
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("FROM_FILE=ignored\nFILE_ONLY=loaded\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OpenDocument(string(session.ID), ".env"); err != nil {
		t.Fatal(err)
	}
	saved, err := service.SaveRunConfiguration(string(session.ID), RunConfiguration{Name: "other language", Kind: "fixture-run", Language: "fixture", LanguageOptions: options, EnvFile: ".env", Port: freePort(t), Environment: []EnvironmentEntry{{Key: "ADOMNIA_PHASE8_HELPER", Value: "1"}, {Key: "PHASE8_REQUIRE_ENV", Value: "1"}, {Key: "FROM_FILE", Value: "explicit"}}})
	if err != nil {
		t.Fatal(err)
	}
	started, err := service.StartConfiguredRun(string(session.ID), saved.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !service.processes.WaitStopped(started.ID, runTaskTimeout) {
		t.Fatal("run did not finish")
	}
	e, _ := service.processes.Execution(started.ID)
	if e.ExitCode == nil || *e.ExitCode != 0 {
		t.Fatalf("run failed: %+v", e)
	}
	tests, err := service.StartTests(TestRunRequest{SessionID: session.ID, Language: "fixture", LanguageOptions: options, Environment: map[string]string{"ADOMNIA_PHASE8_HELPER": "1"}})
	if err != nil {
		t.Fatal(err)
	}
	final := waitTestRun(t, recorder, tests.RunID)
	if final.Summary.Passed != 1 {
		t.Fatalf("neutral parser lost tail: %+v", final)
	}
	snapshot, err := service.GetTestRun(string(tests.RunID))
	if err != nil || len(snapshot.Results) != 2 {
		t.Fatalf("snapshot: %+v %v", snapshot, err)
	}
	listed, err := service.ListTestRuns(string(session.ID))
	if err != nil || len(listed) != 1 {
		t.Fatalf("history: %v %v", listed, err)
	}
	command, err := service.StartRun(RunRequest{SessionID: session.ID, Kind: "command", Target: "./" + name, ProgramArguments: []string{"-test.run=^TestPhase8Process$"}, Environment: map[string]string{"ADOMNIA_PHASE8_HELPER": "1"}})
	if err != nil {
		t.Fatal(err)
	}
	if !service.processes.WaitStopped(command.ID, runTaskTimeout) {
		t.Fatal("command did not finish")
	}
	finished, _ := service.processes.Execution(command.ID)
	if finished.ExitCode == nil || *finished.ExitCode != 0 {
		t.Fatalf("command failed: %+v", finished)
	}
	environment, err := run.Environment(map[string]string{"ADOMNIA_PHASE8_HELPER": "1"})
	if err != nil {
		t.Fatal(err)
	}
	coreRun, err := service.runConfigs.core.Start(service.processes, session.ID, &fixtureRunner{binary: filepath.Join(root, name)}, run.Request{Kind: "fixture-run", Root: root, WorkingDirectory: root, Target: ".", LanguageOptions: options, Environment: environment})
	if err != nil {
		t.Fatal(err)
	}
	if !service.processes.WaitStopped(coreRun.ID, runTaskTimeout) {
		t.Fatal("core runner did not finish")
	}
	for _, value := range []string{string(saved.LanguageOptions), string(snapshot.Request.LanguageOptions)} {
		if !strings.Contains(value, "opaque-kept") {
			t.Fatal("opaque options lost")
		}
	}
	service.tests.CloseSession(session.ID)
	if len(service.tests.List(session.ID)) != 0 {
		t.Fatal("history retained after closing session")
	}
}

func TestPhase8OpaqueGoTestOptions(t *testing.T) {
	service, recorder, session := startTestProject(t)
	started, err := service.StartTests(TestRunRequest{SessionID: session.ID, LanguageOptions: json.RawMessage(`{"packages":["./calc"],"run":"^TestAdd$","coverage":true}`)})
	if err != nil {
		t.Fatal(err)
	}
	finished := waitTestRun(t, recorder, started.RunID)
	if finished.Coverage == nil || len(finished.Coverage.Files) == 0 {
		t.Fatal("opaque coverage ignored")
	}
	if len(finished.Request.Packages) != 1 || finished.Request.Packages[0] != "./calc" {
		t.Fatal("opaque scope ignored")
	}
	if _, err := service.StartTests(TestRunRequest{SessionID: session.ID, LanguageOptions: json.RawMessage(`{"packages":["../outside"]}`)}); err == nil {
		t.Fatal("opaque packages escaped project")
	}
}

func TestPhase8ToolBuildAndContainerRememberConcurrent(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	tools := service.tools(RunRequest{Target: "original"})
	var group sync.WaitGroup
	for _, id := range []RunID{"build", "container"} {
		group.Add(1)
		go func() {
			defer group.Done()
			for range 32 {
				tools.Remember(id, run.ToolRequest{SessionID: "session", Kind: "docker-run", Target: string(id), Docker: run.DockerOptions{Context: "normalized"}})
			}
		}()
	}
	group.Wait()
	for _, id := range []RunID{"build", "container"} {
		request, ok := service.RunRequestFor(string(id))
		if !ok || request.Target != string(id) || request.Docker.Context != "normalized" {
			t.Fatalf("concurrent rerun request lost: %+v", request)
		}
	}
}
