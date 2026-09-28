package goide

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestGoIDEHelperProcess(t *testing.T) {
	if os.Getenv("ADOMNIA_GOIDE_HELPER") != "1" {
		return
	}
	separator := -1
	for index, argument := range os.Args {
		if argument == "--" {
			separator = index
			break
		}
	}
	if separator < 0 || separator+1 >= len(os.Args) {
		os.Exit(2)
	}
	switch os.Args[separator+1] {
	case "echo":
		fmt.Fprintln(os.Stdout, "READY")
		fmt.Fprintln(os.Stderr, "STDERR_READY")
		scanner := bufio.NewScanner(os.Stdin)
		if scanner.Scan() {
			fmt.Fprintf(os.Stdout, "ECHO:%s\n", scanner.Text())
		}
		for {
			time.Sleep(time.Second)
		}
	case "exit":
		fmt.Fprintln(os.Stdout, "DONE")
		os.Exit(0)
	case "tree":
		child := exec.Command(os.Args[0], "-test.run=TestGoIDEHelperProcess", "--", "child")
		child.Env = append(os.Environ(), "ADOMNIA_GOIDE_HELPER=1")
		if err := child.Start(); err != nil {
			os.Exit(3)
		}
		fmt.Fprintf(os.Stdout, "CHILD_PID=%d\n", child.Process.Pid)
		for {
			time.Sleep(time.Second)
		}
	case "child":
		for {
			time.Sleep(time.Second)
		}
	}
	os.Exit(0)
}

func helperSpec(mode string) CommandSpec {
	return CommandSpec{
		SessionID:        "session-process-test",
		Kind:             "run",
		Executable:       os.Args[0],
		Arguments:        []string{"-test.run=TestGoIDEHelperProcess", "--", mode},
		WorkingDirectory: os.TempDir(),
		Environment:      append(os.Environ(), "ADOMNIA_GOIDE_HELPER=1"),
		DisplayCommand:   "goide-test-helper " + mode,
	}
}

func waitProcessEvent(t *testing.T, events <-chan processEvent, predicate func(processEvent) bool) processEvent {
	t.Helper()
	deadline := time.After(8 * time.Second)
	for {
		select {
		case event := <-events:
			if predicate(event) {
				return event
			}
		case <-deadline:
			t.Fatal("timeout in attesa dell'evento di processo")
		}
	}
}

func testProcessManager(t *testing.T) (*ProcessManager, <-chan processEvent) {
	t.Helper()
	manager := NewProcessManager()
	events := make(chan processEvent, 64)
	manager.SetEventSink(func(eventType string, execution Execution, payload any) {
		events <- processEvent{eventType: eventType, execution: execution, payload: payload}
	})
	t.Cleanup(manager.Shutdown)
	return manager, events
}

func TestProcessLifecycleOutputInputAndIdempotentStop(t *testing.T) {
	manager, events := testProcessManager(t)
	execution, err := manager.Start(helperSpec("echo"))
	if err != nil {
		t.Fatal(err)
	}
	waitProcessEvent(t, events, func(event processEvent) bool {
		output, ok := event.payload.(ProcessOutput)
		return ok && event.execution.ID == execution.ID && strings.Contains(output.Text, "READY")
	})
	if err := manager.WriteStdin(execution.ID, "hello\n"); err != nil {
		t.Fatal(err)
	}
	waitProcessEvent(t, events, func(event processEvent) bool {
		output, ok := event.payload.(ProcessOutput)
		return ok && event.execution.ID == execution.ID && strings.Contains(output.Text, "ECHO:hello")
	})
	if err := manager.Stop(execution.ID); err != nil {
		t.Fatal(err)
	}
	if err := manager.Stop(execution.ID); err != nil {
		t.Fatalf("Stop ripetuto deve essere idempotente: %v", err)
	}
	finished := waitProcessEvent(t, events, func(event processEvent) bool {
		return event.eventType == "run.finished" && event.execution.ID == execution.ID
	})
	if finished.execution.Status != "stopped" {
		t.Fatalf("stato finale inatteso: %#v", finished.execution)
	}
}

func TestProcessNaturalExit(t *testing.T) {
	manager, events := testProcessManager(t)
	execution, err := manager.Start(helperSpec("exit"))
	if err != nil {
		t.Fatal(err)
	}
	finished := waitProcessEvent(t, events, func(event processEvent) bool {
		return event.eventType == "run.finished" && event.execution.ID == execution.ID
	})
	if finished.execution.Status != "exited" || finished.execution.ExitCode == nil || *finished.execution.ExitCode != 0 {
		t.Fatalf("uscita naturale inattesa: %#v", finished.execution)
	}
}

func childPIDFromEvents(t *testing.T, events <-chan processEvent, runID RunID) int {
	t.Helper()
	event := waitProcessEvent(t, events, func(event processEvent) bool {
		output, ok := event.payload.(ProcessOutput)
		return ok && event.execution.ID == runID && strings.Contains(output.Text, "CHILD_PID=")
	})
	output := event.payload.(ProcessOutput)
	value := strings.TrimSpace(strings.TrimPrefix(output.Text, "CHILD_PID="))
	pid, err := strconv.Atoi(value)
	if err != nil {
		t.Fatalf("PID figlio non valido: %q", value)
	}
	return pid
}
