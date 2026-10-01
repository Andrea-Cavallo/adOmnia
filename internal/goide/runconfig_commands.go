package goide

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	maxCompoundConfigurations = 10
	sharedRunConfigFile       = ".adomnia/run-configurations.json"
	maxSharedRunConfigBytes   = 1 << 20
)

var goSubcommandPattern = regexp.MustCompile(`^[a-z][a-z0-9]{0,31}$`)

// normalizeCommandConfiguration valida i tipi command, go-tool e compound.
func normalizeCommandConfiguration(config RunConfiguration) (RunConfiguration, error) {
	config.Target = strings.TrimSpace(config.Target)
	config.Files, config.BinaryPath = nil, ""
	switch config.Kind {
	case RunKindCommand:
		if config.Target == "" || strings.ContainsRune(config.Target, '\x00') || strings.HasPrefix(config.Target, "-") {
			return config, fmt.Errorf("indica il comando da eseguire (es. npm, ./scripts/seed.sh)")
		}
	case RunKindGoTool:
		if !goSubcommandPattern.MatchString(config.Target) {
			return config, fmt.Errorf("indica il comando go (es. generate, vet, tool)")
		}
	case RunKindCompound:
		config.Target = ""
		ids := make([]string, 0, len(config.Compound))
		for _, id := range config.Compound {
			id = strings.TrimSpace(id)
			if id != "" && id != config.ID && !contains(ids, id) {
				ids = append(ids, id)
			}
		}
		if len(ids) < 2 {
			return config, fmt.Errorf("una configurazione compound avvia almeno due configurazioni")
		}
		if len(ids) > maxCompoundConfigurations {
			return config, fmt.Errorf("massimo %d configurazioni in una compound", maxCompoundConfigurations)
		}
		config.Compound = ids
		config.PreRun, config.PostRun = nil, nil
	}
	if config.Kind != RunKindCompound {
		config.Compound = nil
	}
	return config, nil
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
	environment, err := s.toolchain.Environment(session.ID, request.Environment)
	if err != nil {
		return Execution{}, err
	}
	var spec CommandSpec
	if kind == string(RunKindGoTool) {
		if !goSubcommandPattern.MatchString(target) {
			return Execution{}, fmt.Errorf("comando go non valido: %q", target)
		}
		binary, err := s.toolchain.GoBinary(session.ID)
		if err != nil {
			return Execution{}, errors.New("go non disponibile: rileva o configura la toolchain prima di eseguire")
		}
		arguments := append([]string{target}, request.ProgramArguments...)
		spec = CommandSpec{Executable: binary, Arguments: arguments, DisplayCommand: displayCommand("go", arguments)}
	} else {
		executable, err := resolveCommandExecutable(session.Project.RealPath, workingDirectory, target)
		if err != nil {
			return Execution{}, err
		}
		spec = CommandSpec{Executable: executable, Arguments: append([]string(nil), request.ProgramArguments...), DisplayCommand: displayCommand(target, request.ProgramArguments)}
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
func resolveCommandExecutable(root, workingDirectory, target string) (string, error) {
	if strings.ContainsAny(target, `/\`) {
		if err := validateRunTarget(root, workingDirectory, target); err != nil {
			return "", err
		}
		path := filepath.Clean(filepath.Join(workingDirectory, filepath.FromSlash(target)))
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			return "", fmt.Errorf("comando non trovato nel progetto: %s", target)
		}
		return path, nil
	}
	path, err := exec.LookPath(target)
	if err != nil {
		return "", fmt.Errorf("%s non trovato nel PATH", target)
	}
	return path, nil
}

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
	var first *Execution
	var failures []string
	for _, id := range config.Compound {
		execution, err := s.StartConfiguredRun(string(session.ID), id, secrets)
		if err != nil {
			member, _ := s.runConfigs.Get(session.ID, id)
			failures = append(failures, fmt.Sprintf("%s: %v", member.Name, err))
			continue
		}
		if first == nil {
			started := execution
			first = &started
		}
	}
	if first == nil {
		return Execution{}, fmt.Errorf("nessuna configurazione della compound è partita: %s", strings.Join(failures, "; "))
	}
	if len(failures) > 0 {
		s.processes.Notice(*first, "Compound "+config.Name+": non partite "+strings.Join(failures, "; "))
	}
	return *first, nil
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
	normalized.ID, normalized.SessionID, normalized.Shared = config.ID, sessionID, true
	m.mu.Lock()
	defer m.mu.Unlock()
	existing := m.configs[sessionID]
	for index, current := range existing {
		if current.ID != config.ID {
			continue
		}
		normalized.Pinned, normalized.RestartOnSave = current.Pinned, current.RestartOnSave
		normalized.Order, normalized.CreatedAt, normalized.UpdatedAt = current.Order, current.CreatedAt, current.UpdatedAt
		// I segreti non sono nel file: si tiene la versione locale senza perderli.
		if sameSharedContent(current, normalized) {
			return false
		}
		existing[index] = normalized
		return true
	}
	if len(existing) >= maxRunConfigurationsPerSession {
		return false
	}
	normalized.Order = len(existing)
	m.configs[sessionID] = append(existing, normalized)
	return true
}

func sameSharedContent(left, right RunConfiguration) bool {
	a, _ := json.Marshal(redactConfiguration(left))
	b, _ := json.Marshal(redactConfiguration(right))
	return string(a) == string(b)
}
