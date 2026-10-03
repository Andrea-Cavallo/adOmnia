package golang

import (
	"adomnia/internal/ide/run"
	"encoding/json"
	"strings"
	"testing"
)

func TestOpaqueRunOptionsApplyGoFlagsAndEnvironment(t *testing.T) {
	root := t.TempDir()
	options, _ := json.Marshal(RunOptions{Race: true, Coverage: true, GOOS: "linux", GOARCH: "amd64", Profile: "cpu"})
	spec, err := New().CommandSpec(run.Request{Root: root, WorkingDirectory: root, Kind: "test", Target: ".", Executable: "go", LanguageOptions: options, Environment: []string{"CGO_ENABLED=0"}})
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(spec.Arguments, " ")
	for _, flag := range []string{"-race", "-cover", "-cpuprofile=cpu.pprof"} {
		if !strings.Contains(args, flag) {
			t.Fatalf("missing %s: %v", flag, spec.Arguments)
		}
	}
	env := strings.Join(spec.Environment, "\n")
	for _, entry := range []string{"GOOS=linux", "GOARCH=amd64", "CGO_ENABLED=0"} {
		if !strings.Contains(env, entry) {
			t.Fatalf("missing %s", entry)
		}
	}
}
