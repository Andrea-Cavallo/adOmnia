package goide

import (
	"bufio"
	"bytes"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	maxEnvFileSize    = 256 * 1024
	maxRunTasks       = 10
	runTaskTimeout    = 30 * time.Minute
	coverageDirectory = ".gocoverdata"
)

var (
	platformNamePattern = regexp.MustCompile(`^[a-z0-9]{1,16}$`)
	// Profili di go test: ogni tipo scrive il proprio file nella cartella del package.
	profileFlags = map[string]string{"cpu": "-cpuprofile=cpu.pprof", "mem": "-memprofile=mem.pprof", "block": "-blockprofile=block.pprof", "mutex": "-mutexprofile=mutex.pprof", "trace": "-trace=trace.out"}
)

// normalizeRunParameters convalida i parametri avanzati comuni a tutti i tipi di configurazione.
func normalizeRunParameters(config RunConfiguration) (RunConfiguration, error) {
	config.EnvFile = strings.TrimSpace(config.EnvFile)
	config.GOOS = strings.TrimSpace(config.GOOS)
	config.GOARCH = strings.TrimSpace(config.GOARCH)
	for label, value := range map[string]string{"GOOS": config.GOOS, "GOARCH": config.GOARCH} {
		if value != "" && !platformNamePattern.MatchString(value) {
			return config, fmt.Errorf("%s non valido: %q", label, value)
		}
	}
	config.Profile = strings.TrimSpace(config.Profile)
	if config.Profile != "" {
		if _, ok := profileFlags[config.Profile]; !ok {
			return config, fmt.Errorf("profilo non supportato: %q (cpu, mem, block, mutex, trace)", config.Profile)
		}
		if config.Kind != RunKindTest {
			return config, fmt.Errorf("il profiling è disponibile per le configurazioni di test")
		}
	}
	if config.Port < 0 || config.Port > 65535 {
		return config, fmt.Errorf("porta non valida: %d", config.Port)
	}
	config.DebugFlags = trimArguments(config.DebugFlags)
	var err error
	if config.PreRun, err = normalizeTaskIDs(config.ID, config.PreRun, "prima"); err != nil {
		return config, err
	}
	if config.PostRun, err = normalizeTaskIDs(config.ID, config.PostRun, "dopo"); err != nil {
		return config, err
	}
	return config, nil
}

func normalizeTaskIDs(self string, ids []string, when string) ([]string, error) {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || slices.Contains(result, id) {
			continue
		}
		if self != "" && id == self {
			return nil, fmt.Errorf("una configurazione non può eseguire se stessa %s dell'avvio", when)
		}
		result = append(result, id)
	}
	if len(result) > maxRunTasks {
		return nil, fmt.Errorf("massimo %d task %s dell'avvio", maxRunTasks, when)
	}
	return result, nil
}

// applyRunParameters traduce i parametri avanzati in ambiente e flag Go della richiesta.
// Le variabili esplicite della configurazione vincono su quelle del file .env.
func applyRunParameters(root, workingDirectory string, config RunConfiguration, request *RunRequest) error {
	if config.EnvFile != "" {
		fromFile, err := loadEnvFile(root, workingDirectory, config.EnvFile)
		if err != nil {
			return err
		}
		for key, value := range fromFile {
			if _, explicit := request.Environment[key]; !explicit {
				request.Environment[key] = value
			}
		}
	}
	if config.GOOS != "" {
		request.Environment["GOOS"] = config.GOOS
	}
	if config.GOARCH != "" {
		request.Environment["GOARCH"] = config.GOARCH
	}
	goKind := config.Kind == RunKindPackage || config.Kind == RunKindFiles || config.Kind == RunKindBuild || config.Kind == RunKindTest
	if config.Race && goKind {
		request.GoArguments = prependFlag(request.GoArguments, "-race")
		if _, set := request.Environment["CGO_ENABLED"]; !set {
			request.Environment["CGO_ENABLED"] = "1" // il race detector richiede cgo
		}
	}
	if config.Coverage && goKind {
		request.GoArguments = prependFlag(request.GoArguments, "-cover")
		if config.Kind != RunKindTest {
			// Un binario compilato con -cover scrive i dati solo se GOCOVERDIR esiste.
			directory := filepath.Join(workingDirectory, coverageDirectory)
			if err := os.MkdirAll(directory, 0o755); err != nil {
				return fmt.Errorf("impossibile creare %s: %w", coverageDirectory, err)
			}
			request.Environment["GOCOVERDIR"] = directory
		}
	}
	if flag := profileFlags[config.Profile]; flag != "" {
		request.GoArguments = append(request.GoArguments, flag)
	}
	if config.Port > 0 {
		if err := portAvailable(config.Port); err != nil {
			return err
		}
		request.Environment["PORT"] = strconv.Itoa(config.Port)
	}
	return nil
}

func prependFlag(arguments []string, flag string) []string {
	if slices.Contains(arguments, flag) {
		return arguments
	}
	return append([]string{flag}, arguments...)
}

// portAvailable fallisce subito se la porta è già occupata, invece di lasciare che il programma crolli al bind.
func portAvailable(port int) error {
	listener, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return fmt.Errorf("la porta %d è già in uso: chiudi il processo che la occupa o scegline un'altra", port)
	}
	return listener.Close()
}

// loadEnvFile legge un file .env confinato al progetto: KEY=VALUE, commenti #, prefisso export, virgolette.
func loadEnvFile(root, workingDirectory, path string) (map[string]string, error) {
	candidate := filepath.FromSlash(path)
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(workingDirectory, candidate)
	}
	candidate = filepath.Clean(candidate)
	if err := ensureWithinRoot(root, candidate); err != nil {
		return nil, fmt.Errorf("env file fuori dal progetto: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(candidate); err == nil {
		if err := ensureWithinRoot(root, resolved); err != nil {
			return nil, fmt.Errorf("env file fuori dal progetto: %w", err)
		}
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return nil, fmt.Errorf("env file %s non trovato", path)
	}
	if info.IsDir() || info.Size() > maxEnvFileSize {
		return nil, fmt.Errorf("env file %s non valido o più grande di 256 KB", path)
	}
	data, err := os.ReadFile(candidate)
	if err != nil {
		return nil, fmt.Errorf("lettura env file %s fallita: %w", path, err)
	}
	return parseEnvFile(data)
}

func parseEnvFile(data []byte) (map[string]string, error) {
	values := make(map[string]string)
	scanner := bufio.NewScanner(bytes.NewReader(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})))
	for number := 1; scanner.Scan(); number++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || !environmentNamePattern.MatchString(key) {
			return nil, fmt.Errorf("env file, riga %d: atteso NOME=valore", number)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			quote := value[0]
			value = value[1 : len(value)-1]
			if quote == '"' {
				value = strings.NewReplacer(`\n`, "\n", `\"`, `"`, `\\`, `\`).Replace(value)
			}
		} else if index := strings.Index(value, " #"); index >= 0 {
			value = strings.TrimSpace(value[:index])
		}
		values[key] = value
	}
	return values, scanner.Err()
}

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
	for index := 0; index+1 < len(steps); index++ {
		step := steps[index]
		finished := s.awaitExecution(current)
		succeeded := finished.Status == "exited" && finished.ExitCode != nil && *finished.ExitCode == 0
		switch {
		case step.phase == phasePre && !succeeded:
			s.processes.Notice(finished, fmt.Sprintf("Task %q non riuscito: la configurazione principale non è stata avviata.", step.name))
			return
		case step.phase == phaseMain && finished.Status == "stopped":
			return
		case step.phase == phasePost && !succeeded:
			s.processes.Notice(finished, fmt.Sprintf("Task %q non riuscito: i task successivi sono stati saltati.", step.name))
			return
		}
		next := steps[index+1]
		execution, err := s.StartRun(next.request)
		if err != nil {
			s.processes.Notice(finished, fmt.Sprintf("Avvio di %q fallito: %v", next.name, err))
			return
		}
		current = execution
	}
}

// awaitExecution attende la fine dell'esecuzione e ne restituisce lo stato finale.
func (s *Service) awaitExecution(execution Execution) Execution {
	s.processes.WaitStopped(execution.ID, runTaskTimeout)
	if final, ok := s.processes.Execution(execution.ID); ok {
		return final
	}
	return execution
}
