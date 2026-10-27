package codestudio

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/remote"
)

// Uses only an already-cached image: acceptance never pulls an image implicitly.
func TestContainerTestsAndProfileStayMappedToLocalProject(t *testing.T) {
	docker, err := exec.LookPath("docker")
	if err != nil {
		t.Skip("Docker unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	probe := exec.CommandContext(ctx, docker, "image", "inspect", "golang:1.26-alpine")
	process.Configure(probe, false)
	if err := probe.Run(); err != nil {
		t.Skip("cached golang:1.26-alpine and running Docker required")
	}
	root := t.TempDir()
	for name, content := range map[string]string{
		"go.mod":          "module example.test/container\n\ngo 1.26\n",
		"fixture_test.go": "package fixture\nimport \"testing\"\nvar sink [][]byte\nfunc TestAllocator(t *testing.T) { for i:=0;i<20;i++ { sink=append(sink,make([]byte,1<<20)) }; if len(sink)!=20 { t.Fatal(len(sink)) } }\n",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	name := newID("adomnia-p2-test")
	start := exec.CommandContext(ctx, docker, "run", "--pull=never", "--rm", "-d", "--name", name, "--mount", "type=bind,source="+root+",target=/workspace", "golang:1.26-alpine", "sleep", "300")
	process.Configure(start, false)
	if out, err := start.CombinedOutput(); err != nil {
		t.Fatalf("container start: %v %s", err, out)
	}
	t.Cleanup(func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		cmd := exec.CommandContext(cleanupCtx, docker, "rm", "-f", name)
		process.Configure(cmd, false)
		_ = cmd.Run()
	})
	events := make(chan EventEnvelope, 1024)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if _, err = service.DetectToolchain(string(session.ID)); err != nil {
		t.Fatal(err)
	}
	run, err := service.StartRun(RunRequest{SessionID: session.ID, Kind: "test", Target: ".", GoArguments: []string{"-memprofile=mem.pprof"}, Environment: map[string]string{"GOTOOLCHAIN": "local", "GOPROXY": "off"}, Remote: &remote.Target{Kind: remote.KindContainer, Name: name, Directory: "/workspace"}})
	if err != nil {
		t.Fatal(err)
	}
	timer := time.NewTimer(90 * time.Second)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			if done, ok := event.Payload.(Execution); ok && event.Type == "run.finished" && done.ID == run.ID {
				if done.Status != "exited" || done.ExitCode == nil || *done.ExitCode != 0 {
					t.Fatalf("container test failed: %#v", done)
				}
				if _, err := service.LoadProfile(string(session.ID), "mem.pprof"); err != nil {
					t.Fatalf("container profile not readable from local project: %v", err)
				}
				return
			}
		case <-timer.C:
			t.Fatal("container tests did not finish")
		}
	}
}
