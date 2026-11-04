package eclipsepde

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestRealProjectTiming(t *testing.T) {
	kepler, java := realJava6(t)
	root := os.Getenv("ADOMNIA_TEST_PROJECT")
	if root == "" {
		t.Skip("no project")
	}
	lap := time.Now()
	mark := func(name string) { t.Logf("%-14s %v", name, time.Since(lap).Round(time.Millisecond)); lap = time.Now() }
	report, err := SetTarget(root, kepler)
	if err != nil {
		t.Fatal(err)
	}
	mark("set target")
	t.Logf("bundles=%d target=%d unresolved=%d", len(report.Bundles), report.TargetBundles, report.Unresolved)
	for _, b := range report.Bundles {
		t.Logf("%s %s %s %s missing=%d", b.SymbolicName, b.Version, b.ExecutionEnvironment, b.Status, len(b.Missing))
		for _, m := range b.Missing {
			t.Logf("   %s %s %s optional=%v available=%v", m.Kind, m.Name, m.Range, m.Optional, m.Available)
		}
	}
	plan, err := PlanBuild(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	mark("plan")
	for _, p := range plan.Problems {
		t.Log(p)
	}
	for _, step := range plan.Steps {
		t.Logf("step %s level=%s sources=%v output=%s args=%d", step.Bundle, step.Environment, step.Sources, step.Output, len(step.Arguments))
		found, output := runCompile(t, java, step)
		mark("compile")
		t.Logf("%d problems", len(found))
		for i, d := range found {
			if i < 12 {
				t.Logf("   %s:%d %s", d.File, d.Line, d.Message)
			}
		}
		if len(found) == 0 && strings.TrimSpace(output) != "" {
			t.Log(output[:min(len(output), 1500)])
		}
	}
	launch, err := PrepareLaunch(root, LaunchJVM{Major: 6, Arch: "x86_64"})
	if err != nil {
		t.Fatal(err)
	}
	mark("prepare launch")
	for _, p := range launch.Problems {
		t.Log(p)
	}
	command := exec.Command(java, launch.Arguments...)
	command.Dir = launch.Directory
	output, _ := runFor(command, 40*time.Second)
	mark("framework 40s")
	t.Log(output[:min(len(output), 3000)])
}

func runFor(command *exec.Cmd, limit time.Duration) (string, error) {
	var out strings.Builder
	command.Stdout, command.Stderr = &out, &out
	stdin, err := command.StdinPipe()
	if err != nil {
		return "", err
	}
	defer func() { _ = stdin.Close() }()
	if err := command.Start(); err != nil {
		return "", err
	}
	time.Sleep(limit)
	_ = command.Process.Kill()
	_ = command.Wait()
	return out.String(), nil
}
