package resources

import (
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestSampleOwnProcessAndRefresh(t *testing.T) {
	first := Sample(nil)
	if len(first.Processes) == 0 || first.Processes[0].PID != os.Getpid() || first.Processes[0].RAM == 0 {
		t.Fatalf("no real memory: %+v", first)
	}
	sampler.Lock()
	sampler.cached.At = time.Time{}
	sampler.Unlock()
	second := Sample(nil)
	if second.Processes[0].CPU == nil || *second.Processes[0].CPU < 0 {
		t.Fatalf("no CPU delta: %+v", second)
	}
}

func TestSampleIncludesChildProcesses(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.Command(self, "-test.run=^$", "-test.timeout=10s")
	child.Env = append(os.Environ(), "ADOMNIA_RESOURCES_SLEEP=1")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.Process.Kill(); _ = child.Wait() })
	sampler.Lock()
	sampler.cached.At = time.Time{}
	sampler.Unlock()
	snapshot := Sample([]Target{{PID: child.Process.Pid, Name: "fixture"}})
	for _, usage := range snapshot.Processes {
		if usage.PID == child.Process.Pid {
			if usage.Name != "fixture" {
				t.Errorf("explicit target name lost: %+v", usage)
			}
			return
		}
	}
	t.Fatalf("child %d missing from %+v", child.Process.Pid, snapshot.Processes)
}

func TestMain(m *testing.M) {
	if os.Getenv("ADOMNIA_RESOURCES_SLEEP") == "1" {
		time.Sleep(5 * time.Second)
		os.Exit(0)
	}
	os.Exit(m.Run())
}
