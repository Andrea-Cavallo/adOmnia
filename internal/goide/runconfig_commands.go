package goide

import (
	"adomnia/internal/ide/run"
	"adomnia/internal/languages/golang"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	maxCompoundConfigurations = 10
	sharedRunConfigFile       = ".adomnia/run-configurations.json"
	maxSharedRunConfigBytes   = 1 << 20
)

// normalizeCommandConfiguration preserves the legacy facade while core owns common rules.
func normalizeCommandConfiguration(config RunConfiguration) (RunConfiguration, error) {
	if config.Kind == RunKindGoTool {
		config.Target = strings.TrimSpace(config.Target)
		config.Files, config.BinaryPath, config.Compound = nil, "", nil
		if !golang.ValidSubcommand(config.Target) {
			return config, fmt.Errorf("indica il comando go (es. generate, vet, tool)")
		}
		return config, nil
	}
	normalized, err := run.NormalizeCommandConfiguration(toCoreConfiguration(config))
	config.Target, config.Files, config.BinaryPath, config.Compound, config.PreRun, config.PostRun = normalized.Target, normalized.Files, normalized.BinaryPath, normalized.Compound, normalized.PreRun, normalized.PostRun
	return config, err
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

// startCommandRun avvia un comando qualsiasi o un sottocomando go, senza shell, nella working directory.
func (s *Service) startCommandRun(session Session, kind, workingDirectory string, request RunRequest) (Execution, error) {
	target := strings.TrimSpace(request.Target)
	languageID := "generic"
	if kind == string(RunKindGoTool) {
		languageID = golang.ID
	}
	environment, err := s.executionEnvironment(session.ID, languageID, request.Environment)
	if err != nil {
		return Execution{}, err
	}
	var spec CommandSpec
	if kind == string(RunKindGoTool) {
		if !golang.ValidSubcommand(target) {
			return Execution{}, fmt.Errorf("comando go non valido: %q", target)
		}
		spec, err = s.runCommandSpec(session.ID, kind, workingDirectory, target, request)
		if err != nil {
			return Execution{}, err
		}
	} else {
		spec, err = run.Command(session.Project.RealPath, workingDirectory, target, request.ProgramArguments)
		if err != nil {
			return Execution{}, err
		}
	}
	spec.SessionID, spec.Kind, spec.WorkingDirectory, spec.Environment = session.ID, kind, workingDirectory, environment
	execution, err := s.processes.Start(spec)
	if err != nil {
		return Execution{}, err
	}
	request.SessionID, request.WorkingDirectory, request.Kind = session.ID, workingDirectory, kind
	s.rememberRunRequest(execution.ID, request)
	return execution, nil
}

// resolveCommandExecutable: un percorso (./scripts/x.sh) resta confinato al progetto, un nome si cerca nel PATH.
var resolveCommandExecutable = run.ResolveCommandExecutable

// validateCompound accetta solo configurazioni esistenti della sessione e non a loro volta compound.
func (s *Service) validateCompound(session Session, config RunConfiguration) error {
	for _, id := range config.Compound {
		member, err := s.runConfigs.Get(session.ID, id)
		if err != nil {
			return fmt.Errorf("la compound cita una configurazione inesistente: %s", id)
		}
		if member.Kind == RunKindCompound {
			return fmt.Errorf("una compound non può contenere un'altra compound (%s)", member.Name)
		}
	}
	return nil
}

// startCompound avvia in parallelo le configurazioni della compound; restituisce la prima esecuzione partita.
func (s *Service) startCompound(session Session, config RunConfiguration, secrets map[string]string) (Execution, error) {
	if err := s.validateCompound(session, config); err != nil {
		return Execution{}, err
	}
	steps := make([]run.Step, 0, len(config.Compound))
	for _, id := range config.Compound {
		member, _ := s.runConfigs.Get(session.ID, id)
		steps = append(steps, run.Step{Name: member.Name, Start: func() (Execution, error) { return s.StartConfiguredRun(string(session.ID), id, secrets) }})
	}
	return run.Compound(s.processes, config.Name, steps)
}

type sharedRunConfigurations struct {
	Format         string             `json:"format"`
	Version        int                `json:"version"`
	Configurations []RunConfiguration `json:"configurations"`
}

// syncSharedRunConfigurations riscrive .adomnia/run-configurations.json con le configurazioni condivise:
// JSON leggibile e stabile per Git, senza valori segreti né stato personale (pin, riavvio al salvataggio).
func (s *Service) syncSharedRunConfigurations(session Session) {
	path := filepath.Join(session.Project.RealPath, filepath.FromSlash(sharedRunConfigFile))
	shared := make([]RunConfiguration, 0)
	for _, config := range s.runConfigs.List(session.ID) {
		if !config.Shared {
			continue
		}
		clean := redactConfiguration(config)
		clean.SessionID, clean.Pinned, clean.RestartOnSave = "", false, false
		shared = append(shared, clean)
	}
	if len(shared) == 0 {
		if _, err := os.Stat(path); err != nil {
			return // nessuna configurazione condivisa e nessun file da aggiornare
		}
	}
	sort.SliceStable(shared, func(i, j int) bool { return shared[i].Order < shared[j].Order })
	data, err := json.MarshalIndent(sharedRunConfigurations{Format: "adomnia-run-configurations", Version: 1, Configurations: shared}, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(path, append(data, '\n'), 0o644)
}

// importSharedRunConfigurations porta nella sessione le configurazioni condivise dal repository.
// Per quelle già presenti vince il file (è la versione del team), ma pin e riavvio al salvataggio restano locali.
func (s *Service) importSharedRunConfigurations(session Session) bool {
	path := filepath.Join(session.Project.RealPath, filepath.FromSlash(sharedRunConfigFile))
	info, err := os.Stat(path)
	if err != nil || info.Size() > maxSharedRunConfigBytes {
		return false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	var file sharedRunConfigurations
	if json.Unmarshal(data, &file) != nil || file.Format != "adomnia-run-configurations" {
		return false
	}
	changed := false
	for _, config := range file.Configurations {
		if config.ID == "" {
			continue
		}
		config.Shared = true
		if s.validateConfigurationPaths(session, config) != nil {
			continue
		}
		if s.runConfigs.Import(session.ID, config) {
			changed = true
		}
	}
	return changed
}

// Import inserisce o aggiorna una configurazione condivisa mantenendone l'ID; restituisce true se è cambiato qualcosa.
func (m *RunConfigManager) Import(sessionID SessionID, config RunConfiguration) bool {
	normalized, err := normalizeConfiguration(config)
	if err != nil {
		return false
	}
	return m.core.Import(sessionID, toCoreConfiguration(normalized))
}

func sameSharedContent(left, right RunConfiguration) bool {
	a, _ := json.Marshal(redactConfiguration(left))
	b, _ := json.Marshal(redactConfiguration(right))
	return string(a) == string(b)
}
