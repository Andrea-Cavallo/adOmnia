package run

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

type Phase int

const (
	Pre Phase = iota
	Main
	Post
)

type Step struct {
	Name  string
	Phase Phase
	Start func() (Execution, error)
	// Ready, when set, makes the following steps of a compound wait for it (see Compound).
	Ready func(alive func() bool) error
}

// Chain runs prepared tasks in order; a stopped main run cancels post tasks.
func Chain(processes *ProcessManager, current Execution, steps []Step) {
	for i := 0; i+1 < len(steps); i++ {
		step := steps[i]
		if !processes.WaitStopped(current.ID, 30*time.Minute) {
			processes.Notice(current, "Timeout del task: catena interrotta.")
			return
		}
		finished, ok := processes.Execution(current.ID)
		if !ok {
			return
		}
		success := finished.Status == "exited" && finished.ExitCode != nil && *finished.ExitCode == 0
		if (step.Phase == Pre || step.Phase == Post) && !success {
			processes.Notice(finished, fmt.Sprintf("Task %q non riuscito: i passi successivi sono stati saltati.", step.Name))
			return
		}
		if finished.Status == "stopped" {
			return
		}
		next := steps[i+1]
		e, err := next.Start()
		if err != nil {
			processes.Notice(finished, fmt.Sprintf("Avvio di %q fallito: %v", next.Name, err))
			return
		}
		current = e
	}
}

// Compound starts the steps in order. A step with Ready gates the ones after it: they start only once Ready
// succeeds (e.g. its port accepts connections), so a frontend can follow its backend.
func Compound(processes *ProcessManager, name string, steps []Step) (Execution, error) {
	first, failures := compoundFrom(processes, name, steps, nil)
	if first == nil {
		return Execution{}, fmt.Errorf("no configuration of the compound started: %s", strings.Join(failures, "; "))
	}
	if len(failures) > 0 {
		processes.Notice(*first, "Compound "+name+": non partite "+strings.Join(failures, "; "))
	}
	return *first, nil
}

func compoundFrom(processes *ProcessManager, name string, steps []Step, anchor *Execution) (*Execution, []string) {
	first := anchor
	var failures []string
	for i, step := range steps {
		started, err := step.Start()
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", step.Name, err))
			continue
		}
		if first == nil {
			first = &started
		}
		if step.Ready == nil || i+1 == len(steps) {
			continue
		}
		go continueAfterReady(processes, name, step, started, *first, steps[i+1:])
		break
	}
	return first, failures
}

func continueAfterReady(processes *ProcessManager, name string, gate Step, started, anchor Execution, rest []Step) {
	alive := func() bool {
		current, ok := processes.Execution(started.ID)
		return ok && current.Status == "running"
	}
	if err := gate.Ready(alive); err != nil {
		processes.Notice(anchor, fmt.Sprintf("%s: %s not ready: %v. The next services were not started.", name, gate.Name, err))
		return
	}
	processes.Notice(anchor, name+": "+gate.Name+" ready.")
	if _, failures := compoundFrom(processes, name, rest, &anchor); len(failures) > 0 {
		processes.Notice(anchor, "Compound "+name+": non partite "+strings.Join(failures, "; "))
	}
}

// WaitPort returns once something accepts TCP connections on localhost:port. It fails when the run stops, or
// after timeout.
func WaitPort(port int, timeout time.Duration, alive func() bool) error {
	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !alive() {
			return fmt.Errorf("the process stopped before port %d opened", port)
		}
		if conn, err := net.DialTimeout("tcp", address, 500*time.Millisecond); err == nil {
			_ = conn.Close()
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("port %d did not open within %s", port, timeout)
}
