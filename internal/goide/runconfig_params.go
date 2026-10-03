package goide

import (
	"adomnia/internal/ide/run"
	"adomnia/internal/languages/golang"
	"fmt"
	"strings"
	"time"
)

const (
	runTaskTimeout    = 30 * time.Minute
	coverageDirectory = ".gocoverdata"
)

func configGoOptions(c RunConfiguration) golang.RunOptions {
	return golang.RunOptions{GoArguments: c.GoArguments, BuildTags: c.BuildTags, GOOS: c.GOOS, GOARCH: c.GOARCH, Race: c.Race, Coverage: c.Coverage, Profile: c.Profile, DebugFlags: c.DebugFlags}
}
func normalizeRunParameters(config RunConfiguration) (RunConfiguration, error) {
	config.GOOS = strings.TrimSpace(config.GOOS)
	config.GOARCH = strings.TrimSpace(config.GOARCH)
	config.Profile = strings.TrimSpace(config.Profile)
	config.DebugFlags = trimArguments(config.DebugFlags)
	if config.Language == "" || config.Language == golang.ID {
		if err := golang.ValidateRunOptions(string(config.Kind), configGoOptions(config)); err != nil {
			return config, err
		}
	}
	common, err := run.NormalizeParameters(toCoreConfiguration(config))
	config.EnvFile, config.PreRun, config.PostRun = common.EnvFile, common.PreRun, common.PostRun
	return config, err
}
func applyRunParameters(root, wd string, config RunConfiguration, request *RunRequest) error {
	if request.Environment == nil {
		request.Environment = make(map[string]string)
	}
	if err := run.ApplyParameters(root, wd, toCoreConfiguration(config), request.Environment); err != nil {
		return err
	}
	if config.Language == "" || config.Language == golang.ID {
		options := configGoOptions(config)
		options.GoArguments = request.GoArguments
		args, err := golang.ApplyRunOptions(wd, string(config.Kind), options, request.Environment)
		if err != nil {
			return err
		}
		request.GoArguments = args
	}
	return nil
}

var normalizeTaskIDs = run.NormalizeTaskIDs
var portAvailable = run.PortAvailable
var loadEnvFile = run.LoadEnvFile
var parseEnvFile = run.ParseEnvFile

type chainPhase int

const (
	phasePre chainPhase = iota
	phaseMain
	phasePost
)

// chainStep è una configurazione della catena Run, già tradotta in richiesta.
type chainStep struct {
	name    string
	phase   chainPhase
	request RunRequest
}

// taskSteps risolve subito i task, così configurazioni mancanti o segreti assenti emergono prima dell'avvio.
// ponytail: un solo livello, i pre/post dei task stessi vengono ignorati; così non servono controlli sui cicli.
func (s *Service) taskSteps(session Session, ids []string, phase chainPhase, secrets map[string]string) ([]chainStep, error) {
	steps := make([]chainStep, 0, len(ids))
	for _, id := range ids {
		config, err := s.runConfigs.Get(session.ID, id)
		if err != nil {
			return nil, fmt.Errorf("task non trovato: la configurazione è stata eliminata")
		}
		request, err := s.buildRunRequest(session, config, secrets)
		if err != nil {
			return nil, fmt.Errorf("task %q: %w", config.Name, err)
		}
		steps = append(steps, chainStep{name: config.Name, phase: phase, request: request})
	}
	return steps, nil
}

// runChain attende ogni passo e avvia il successivo. steps[0] è già in esecuzione come current.
// Un task prima dell'avvio fallito blocca la principale; i task dopo partono qualunque sia l'esito della
// principale, salvo stop manuale; un task dopo fallito salta i rimanenti.
func (s *Service) runChain(current Execution, steps []chainStep) {
	prepared := make([]run.Step, 0, len(steps))
	for _, step := range steps {
		prepared = append(prepared, run.Step{Name: step.name, Phase: run.Phase(step.phase), Start: func() (Execution, error) { return s.StartRun(step.request) }})
	}
	run.Chain(s.processes, current, prepared)
}

// awaitExecution attende la fine dell'esecuzione e ne restituisce lo stato finale.
func (s *Service) awaitExecution(execution Execution) Execution {
	s.processes.WaitStopped(execution.ID, runTaskTimeout)
	if final, ok := s.processes.Execution(execution.ID); ok {
		return final
	}
	return execution
}
