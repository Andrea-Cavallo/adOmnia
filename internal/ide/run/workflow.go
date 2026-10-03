package run

import (
	"fmt"
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

func Compound(processes *ProcessManager, name string, steps []Step) (Execution, error) {
	var first *Execution
	var failures []string
	for _, step := range steps {
		e, err := step.Start()
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", step.Name, err))
			continue
		}
		if first == nil {
			first = &e
		}
	}
	if first == nil {
		return Execution{}, fmt.Errorf("nessuna configurazione della compound è partita: %s", strings.Join(failures, "; "))
	}
	if len(failures) > 0 {
		processes.Notice(*first, "Compound "+name+": non partite "+strings.Join(failures, "; "))
	}
	return *first, nil
}
