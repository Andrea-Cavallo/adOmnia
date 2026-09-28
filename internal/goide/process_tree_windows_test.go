//go:build windows

package goide

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestWindowsStopTerminatesChildTree(t *testing.T) {
	manager, events := testProcessManager(t)
	execution, err := manager.Start(helperSpec("tree"))
	if err != nil {
		t.Fatal(err)
	}
	childPID := childPIDFromEvents(t, events, execution.ID)
	if err := manager.Stop(execution.ID); err != nil {
		t.Fatal(err)
	}
	waitProcessEvent(t, events, func(event processEvent) bool {
		return event.eventType == "run.finished" && event.execution.ID == execution.ID
	})
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		output, taskErr := exec.Command("tasklist.exe", "/FI", fmt.Sprintf("PID eq %d", childPID), "/FO", "CSV", "/NH").CombinedOutput()
		if taskErr == nil && !strings.Contains(string(output), strconv.Itoa(childPID)) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("il processo figlio %d è rimasto attivo dopo Stop", childPID)
}
