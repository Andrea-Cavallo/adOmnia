package resources

import (
	"os"
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
