package goide

import "fmt"

// ListRunConfigurations elenca le configurazioni salvate della sessione.
func (s *Service) ListRunConfigurations(sessionID string) ([]RunConfiguration, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
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
	request, err := s.buildRunRequest(session, config, secrets)
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
		if !entry.Secret {
			environment[entry.Key] = entry.Value
			continue
		}
		value, provided := secrets[entry.Key]
		if !provided || value == "" {
			return RunRequest{}, fmt.Errorf("la variabile %q è segreta: fornisci il valore per avviare", entry.Key)
		}
		environment[entry.Key] = value
	}

	request := RunRequest{
		SessionID:        session.ID,
		WorkingDirectory: config.WorkingDirectory,
		GoArguments:      append([]string(nil), config.GoArguments...),
		ProgramArguments: append([]string(nil), config.ProgramArguments...),
		BuildTags:        append([]string(nil), config.BuildTags...),
		Environment:      environment,
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
		return RunRequest{}, fmt.Errorf("le configurazioni di test saranno eseguibili con il test runner della Fase 4")
	case RunKindBinary:
		return RunRequest{}, fmt.Errorf("l'esecuzione di un binario già compilato non è ancora disponibile")
	default:
		return RunRequest{}, fmt.Errorf("tipo di configurazione %q non supportato", config.Kind)
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
	}
	return validateGoArguments(session.Project.RealPath, workingDirectory, config.GoArguments)
}
