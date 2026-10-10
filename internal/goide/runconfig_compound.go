package goide

import (
	"adomnia/internal/ide/run"
	"context"
	"fmt"
	"path/filepath"
	"time"
)

// composeReadyTimeout bounds the wait for containers before tasks and services start.
const composeReadyTimeout = 3 * time.Minute

// composeMember is a `docker compose up` member whose readiness gates the rest of the compound.
type composeMember struct {
	id       string
	name     string
	file     string
	services []string
}

// startCompound starts a compound in stages so a local environment comes up in order:
//  1. its `docker compose up` members (attached, with logs);
//  2. a wait until their containers are ready (healthy, running, or finished with 0);
//  3. its tasks (PreRun: migrations, seed data…), one after the other;
//  4. its other members (the services).
//
// Without Compose members and tasks every member starts at once, as before.
func (s *Service) startCompound(session Session, config RunConfiguration, secrets map[string]string) (Execution, error) {
	if err := s.validateCompound(session, config); err != nil {
		return Execution{}, err
	}
	var composes []composeMember
	var others []run.Step
	var composeSteps []run.Step
	for _, id := range config.Compound {
		member, _ := s.runConfigs.Get(session.ID, id)
		step := run.Step{Name: member.Name, Start: func() (Execution, error) { return s.StartConfiguredRun(string(session.ID), id, secrets) }}
		if file, services, ok := s.composeUpTarget(session, member); ok {
			composes = append(composes, composeMember{id: id, name: member.Name, file: file, services: services})
			composeSteps = append(composeSteps, step)
			continue
		}
		others = append(others, step)
	}
	if len(composes) == 0 && len(config.PreRun) == 0 {
		return run.Compound(s.processes, config.Name, others)
	}
	tasks, err := s.taskSteps(session, config.PreRun, phasePre, secrets)
	if err != nil {
		return Execution{}, err
	}

	var started []Execution
	for _, step := range composeSteps {
		execution, err := step.Start()
		if err != nil {
			return Execution{}, fmt.Errorf("%s: %w", step.Name, err)
		}
		started = append(started, execution)
	}
	if len(started) == 0 {
		// No containers: the first task is the run the user sees.
		first, err := s.StartRun(tasks[0].request)
		if err != nil {
			return Execution{}, fmt.Errorf("%s: %w", tasks[0].name, err)
		}
		go s.continueCompound(config.Name, first, nil, nil, tasks, others)
		return first, nil
	}
	go s.continueCompound(config.Name, started[0], composes, started, tasks, others)
	return started[0], nil
}

// continueCompound runs stages 2–4 in the background; every step and failure is
// reported as a notice in the console of the run the user is looking at.
func (s *Service) continueCompound(name string, anchor Execution, composes []composeMember, composeRuns []Execution, tasks []chainStep, others []run.Step) {
	notice := func(text string) { s.processes.Notice(anchor, name+": "+text) }
	for i, member := range composes {
		runID := composeRuns[i].ID
		alive := func() bool {
			current, ok := s.processes.Execution(runID)
			return ok && current.Status == "running"
		}
		ctx, cancel := context.WithTimeout(context.Background(), composeReadyTimeout)
		began := time.Now()
		err := run.WaitComposeReady(ctx, member.file, member.services, alive, notice)
		cancel()
		if err != nil {
			notice(fmt.Sprintf("%s not ready: %v. Tasks and services were not started.", member.name, err))
			return
		}
		notice(fmt.Sprintf("%s ready in %s.", member.name, time.Since(began).Round(100*time.Millisecond)))
	}
	if len(composes) == 0 && len(tasks) > 0 {
		// The first task is already running as the anchor.
		if !s.finishedOK(anchor, tasks[0].name, notice) {
			return
		}
		tasks = tasks[1:]
	}
	for _, task := range tasks {
		notice("running " + task.name + "…")
		execution, err := s.StartRun(task.request)
		if err != nil {
			notice(fmt.Sprintf("%s could not start: %v. Services were not started.", task.name, err))
			return
		}
		if !s.finishedOK(execution, task.name, notice) {
			return
		}
	}
	if len(others) == 0 {
		return
	}
	notice(fmt.Sprintf("starting %d %s…", len(others), plural(len(others), "service", "services")))
	if _, err := run.Compound(s.processes, name, others); err != nil {
		notice(err.Error())
	}
}

// finishedOK waits for a task and reports whether it exited with code 0.
func (s *Service) finishedOK(execution Execution, name string, notice func(string)) bool {
	final := s.awaitExecution(execution)
	if final.Status == "exited" && final.ExitCode != nil && *final.ExitCode == 0 {
		notice(name + " done.")
		return true
	}
	notice(name + " failed: the remaining tasks and the services were not started.")
	return false
}

// composeUpTarget reports the absolute Compose file and services of a `compose up` member.
func (s *Service) composeUpTarget(session Session, config RunConfiguration) (string, []string, bool) {
	if config.Kind != RunKindDockerCompose {
		return "", nil, false
	}
	arguments, err := run.NormalizeComposeArguments(config.ProgramArguments)
	if err != nil || arguments[0] != "up" {
		return "", nil, false
	}
	directory, err := s.documents.resolveDirectory(session.Project, config.WorkingDirectory)
	if err != nil {
		return "", nil, false
	}
	target := config.Target
	if target == "" {
		target = "docker-compose.yml"
	}
	return filepath.Clean(filepath.Join(directory, filepath.FromSlash(target))), arguments[1:], true
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
