package goide

import (
	"fmt"
	"strings"
)

// ListRunConfigurations elenca le configurazioni salvate della sessione.
func (s *Service) ListRunConfigurations(sessionID string) ([]RunConfiguration, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if s.importSharedRunConfigurations(session) {
		_ = s.saveState()
	}
	return s.runConfigs.List(session.ID), nil
}

// SaveRunConfiguration crea o aggiorna una configurazione dopo averla validata.
func (s *Service) SaveRunConfiguration(sessionID string, config RunConfiguration) (RunConfiguration, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return RunConfiguration{}, err
	}
	if err := s.validateConfigurationPaths(session, config); err != nil {
		return RunConfiguration{}, err
	}
	saved, err := s.runConfigs.Save(session.ID, config)
	if err != nil {
		return RunConfiguration{}, err
	}
	if err := s.saveState(); err != nil {
		return RunConfiguration{}, err
	}
	s.emit("runconfig.saved", session.ID, saved.ID, saved)
	s.syncSharedRunConfigurations(session)
	return saved, nil
}

// DuplicateRunConfiguration crea una copia indipendente della configurazione.
func (s *Service) DuplicateRunConfiguration(sessionID, configID string) (RunConfiguration, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return RunConfiguration{}, err
	}
	copied, err := s.runConfigs.Duplicate(session.ID, configID)
	if err != nil {
		return RunConfiguration{}, err
	}
	if err := s.saveState(); err != nil {
		return RunConfiguration{}, err
	}
	s.emit("runconfig.saved", session.ID, copied.ID, copied)
	s.syncSharedRunConfigurations(session)
	return copied, nil
}

// RenameRunConfiguration cambia il nome visibile della configurazione.
func (s *Service) RenameRunConfiguration(sessionID, configID, name string) (RunConfiguration, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return RunConfiguration{}, err
	}
	renamed, err := s.runConfigs.Rename(session.ID, configID, name)
	if err != nil {
		return RunConfiguration{}, err
	}
	if err := s.saveState(); err != nil {
		return RunConfiguration{}, err
	}
	s.emit("runconfig.saved", session.ID, renamed.ID, renamed)
	s.syncSharedRunConfigurations(session)
	return renamed, nil
}

// ReorderRunConfigurations applica l'ordine scelto dall'utente.
func (s *Service) ReorderRunConfigurations(sessionID string, configIDs []string) ([]RunConfiguration, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	ordered, err := s.runConfigs.Reorder(session.ID, configIDs)
	if err != nil {
		return nil, err
	}
	if err := s.saveState(); err != nil {
		return nil, err
	}
	return ordered, nil
}

// DeleteRunConfiguration rimuove definitivamente una configurazione salvata.
func (s *Service) DeleteRunConfiguration(sessionID, configID string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	if err := s.runConfigs.Delete(session.ID, configID); err != nil {
		return err
	}
	if err := s.saveState(); err != nil {
		return err
	}
	s.emit("runconfig.deleted", session.ID, configID, nil)
	s.syncSharedRunConfigurations(session)
	return nil
}

// StartConfiguredRun avvia una configurazione salvata. I valori segreti non
// sono persistiti: vanno forniti qui e restano soltanto in memoria.
func (s *Service) StartConfiguredRun(sessionID, configID string, secrets map[string]string) (Execution, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	config, err := s.runConfigs.Get(session.ID, configID)
	if err != nil {
		return Execution{}, err
	}
	if config.Kind == RunKindCompound {
		return s.startCompound(session, config, secrets)
	}
	request, err := s.buildRunRequest(session, config, secrets)
	if err != nil {
		return Execution{}, err
	}
	pre, err := s.taskSteps(session, config.PreRun, phasePre, secrets)
	if err != nil {
		return Execution{}, err
	}
	post, err := s.taskSteps(session, config.PostRun, phasePost, secrets)
	if err != nil {
		return Execution{}, err
	}
	steps := append(append(pre, chainStep{name: config.Name, phase: phaseMain, request: request}), post...)
	first, err := s.StartRun(steps[0].request)
	if err != nil {
		return Execution{}, err
	}
	if len(steps) > 1 {
		go s.runChain(first, steps)
	}
	return first, nil
}

// StartConfiguredBuild compila il package di una configurazione package o build con tutti i suoi
// parametri (GOOS/GOARCH, tag, env file, race). Le variabili segrete non servono alla build e vengono omesse.
func (s *Service) StartConfiguredBuild(sessionID, configID string) (Execution, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	config, err := s.runConfigs.Get(session.ID, configID)
	if err != nil {
		return Execution{}, err
	}
	if config.Kind != RunKindPackage && config.Kind != RunKindBuild {
		return Execution{}, fmt.Errorf("la build è disponibile per configurazioni package o build")
	}
	public := config.Environment[:0:0]
	for _, entry := range config.Environment {
		if !entry.Secret {
			public = append(public, entry)
		}
	}
	config.Environment, config.Kind, config.Port = public, RunKindBuild, 0
	request, err := s.buildRunRequest(session, config, nil)
	if err != nil {
		return Execution{}, err
	}
	return s.StartRun(request)
}

// buildRunRequest traduce una configurazione salvata in una richiesta di esecuzione.
func (s *Service) buildRunRequest(session Session, config RunConfiguration, secrets map[string]string) (RunRequest, error) {
	if err := s.validateConfigurationPaths(session, config); err != nil {
		return RunRequest{}, err
	}
	environment := make(map[string]string, len(config.Environment))
	for _, entry := range config.Environment {
		value, err := resolveEntryValue(entry, secrets)
		if err != nil {
			return RunRequest{}, err
		}
		environment[entry.Key] = value
	}
	docker := config.Docker
	docker.BuildArgs = make([]EnvironmentEntry, 0, len(config.Docker.BuildArgs))
	for _, entry := range config.Docker.BuildArgs {
		value, err := resolveEntryValue(entry, secrets)
		if err != nil {
			return RunRequest{}, err
		}
		docker.BuildArgs = append(docker.BuildArgs, EnvironmentEntry{Key: entry.Key, Value: value, Secret: entry.Secret})
	}

	request := RunRequest{
		SessionID:        session.ID,
		WorkingDirectory: config.WorkingDirectory,
		GoArguments:      append([]string(nil), config.GoArguments...),
		ProgramArguments: append([]string(nil), config.ProgramArguments...),
		BuildTags:        append([]string(nil), config.BuildTags...),
		Environment:      environment,
		Docker:           docker,
		Secrets:          config.RequiredSecrets(),
	}
	switch config.Kind {
	case RunKindBuild:
		request.Kind = "build"
		request.Target = config.Target
	case RunKindPackage:
		request.Kind = "run"
		request.Target = config.Target
	case RunKindFiles:
		request.Kind = "run"
		request.Target = config.Files[0]
		request.ExtraTargets = append([]string(nil), config.Files[1:]...)
	case RunKindTest:
		request.Kind = "test"
		request.Target = config.Target
	case RunKindBinary:
		request.Kind = "binary"
		request.Target = config.BinaryPath
	case RunKindMake, RunKindDockerBuild, RunKindDockerRun, RunKindDockerCompose, RunKindCommand, RunKindGoTool:
		request.Kind = string(config.Kind)
		request.Target = config.Target
	case RunKindCompound:
		return RunRequest{}, fmt.Errorf("una configurazione compound avvia altre configurazioni, non un comando")
	default:
		return RunRequest{}, fmt.Errorf("tipo di configurazione %q non supportato", config.Kind)
	}
	workingDirectory, err := s.documents.resolveDirectory(session.Project, config.WorkingDirectory)
	if err != nil {
		return RunRequest{}, err
	}
	if err := applyRunParameters(session.Project.RealPath, workingDirectory, config, &request); err != nil {
		return RunRequest{}, err
	}
	return request, nil
}

// validateConfigurationPaths confina alla radice del progetto ogni percorso
// citato dalla configurazione, prima ancora di avviare qualunque processo.
func (s *Service) validateConfigurationPaths(session Session, config RunConfiguration) error {
	workingDirectory, err := s.documents.resolveDirectory(session.Project, config.WorkingDirectory)
	if err != nil {
		return err
	}
	switch config.Kind {
	case RunKindMake, RunKindDockerBuild, RunKindDockerRun, RunKindDockerCompose:
		normalized, err := normalizeToolConfiguration(config)
		if err != nil {
			return err
		}
		return validateToolPaths(session.Project.RealPath, workingDirectory, normalized.Kind, normalized.Target, normalized.Docker)
	case RunKindPackage, RunKindBuild, RunKindTest:
		if config.Target != "" {
			return validateRunTarget(session.Project.RealPath, workingDirectory, config.Target)
		}
	case RunKindFiles:
		for _, file := range config.Files {
			if err := validateRunTarget(session.Project.RealPath, workingDirectory, file); err != nil {
				return err
			}
		}
	case RunKindBinary:
		return validateRunTarget(session.Project.RealPath, workingDirectory, config.BinaryPath)
	case RunKindCommand:
		if strings.ContainsAny(config.Target, `/\`) {
			return validateRunTarget(session.Project.RealPath, workingDirectory, config.Target)
		}
	case RunKindCompound:
		return s.validateCompound(session, config)
	}
	return validateGoArguments(session.Project.RealPath, workingDirectory, config.GoArguments)
}

// resolveEntryValue restituisce il valore di una voce, prendendo i segreti da quelli forniti all'avvio.
func resolveEntryValue(entry EnvironmentEntry, secrets map[string]string) (string, error) {
	if !entry.Secret {
		return entry.Value, nil
	}
	value, provided := secrets[entry.Key]
	if !provided || value == "" {
		return "", fmt.Errorf("%q è segreta: fornisci il valore per avviare", entry.Key)
	}
	return value, nil
}

// RunRequestFor restituisce la richiesta strutturata di un'esecuzione, se ancora nota.
func (s *Service) RunRequestFor(runID string) (RunRequest, bool) {
	s.runMu.RLock()
	defer s.runMu.RUnlock()
	request, ok := s.runRequests[RunID(runID)]
	return request, ok
}
