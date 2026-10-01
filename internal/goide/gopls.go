package goide

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	goplsModule         = "golang.org/x/tools/gopls@latest"
	goplsVersionTimeout = 8 * time.Second
)

// executableName aggiunge l'estensione richiesta dalla piattaforma a un binario Go installato.
func executableName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func goplsExecutableName() string {
	return executableName("gopls")
}

// goplsCandidates elenca i binari in ordine di priorità: personalizzato, gestito da adOmnia, GOPATH/bin, PATH.
func (s *Service) goplsCandidates(sessionID SessionID) []GoplsInfo {
	candidates := make([]GoplsInfo, 0, 4)
	s.goplsMu.RLock()
	custom := s.goplsBinaries[sessionID]
	s.goplsMu.RUnlock()
	if custom != "" {
		candidates = append(candidates, GoplsInfo{Binary: custom, Source: "custom"})
	}
	if s.toolsRoot != "" {
		candidates = append(candidates, GoplsInfo{Binary: filepath.Join(s.toolsRoot, "bin", goplsExecutableName()), Source: "managed"})
	}
	if info, ok := s.toolchain.LastDetected(sessionID); ok && info.GOPATH != "" {
		for _, gopath := range filepath.SplitList(info.GOPATH) {
			candidates = append(candidates, GoplsInfo{Binary: filepath.Join(gopath, "bin", goplsExecutableName()), Source: "GOPATH"})
		}
	}
	if found, err := exec.LookPath("gopls"); err == nil {
		candidates = append(candidates, GoplsInfo{Binary: found, Source: "PATH"})
	}
	return candidates
}

// DetectGopls individua gopls e ne legge la versione senza avviarlo come server.
func (s *Service) DetectGopls(sessionID string) (GoplsInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return GoplsInfo{}, err
	}
	managedDir := filepath.Join(s.toolsRoot, "bin")
	for _, candidate := range s.goplsCandidates(session.ID) {
		info, statErr := os.Stat(candidate.Binary)
		if statErr != nil || info.IsDir() {
			if candidate.Source == "custom" {
				return GoplsInfo{Binary: candidate.Binary, Source: "custom", ManagedDir: managedDir, Error: "il binario gopls configurato non esiste"}, nil
			}
			continue
		}
		version, versionErr := goplsVersion(candidate.Binary)
		candidate.ManagedDir = managedDir
		if versionErr != nil {
			candidate.Error = versionErr.Error()
			return candidate, nil
		}
		candidate.Available = true
		candidate.Version = version
		return candidate, nil
	}
	return GoplsInfo{ManagedDir: managedDir, Error: "gopls non trovato: installalo da Go → Install gopls oppure indica un binario personalizzato"}, nil
}

func goplsVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), goplsVersionTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "version")
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("gopls non risponde a 'gopls version'")
	}
	if err != nil {
		return "", fmt.Errorf("gopls non eseguibile: %s", strings.TrimSpace(string(output)))
	}
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && strings.HasSuffix(fields[0], "gopls") {
			return fields[1], nil
		}
	}
	return strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0]), nil
}

// ConfigureGopls imposta un binario gopls personalizzato per la sessione; stringa vuota ripristina la ricerca automatica.
func (s *Service) ConfigureGopls(sessionID, binary string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	binary = strings.TrimSpace(binary)
	if binary != "" {
		abs, err := filepath.Abs(binary)
		if err != nil {
			return fmt.Errorf("percorso gopls non valido: %w", err)
		}
		info, err := os.Stat(abs)
		if err != nil || info.IsDir() {
			return fmt.Errorf("il percorso indicato non è un eseguibile gopls")
		}
		binary = abs
	}
	s.goplsMu.Lock()
	if binary == "" {
		delete(s.goplsBinaries, SessionID(sessionID))
	} else {
		s.goplsBinaries[SessionID(sessionID)] = binary
	}
	s.goplsMu.Unlock()
	return nil
}

// InstallGopls esegue `go install` di gopls nella cartella strumenti di adOmnia dopo conferma esplicita.
func (s *Service) InstallGopls(sessionID string, confirmed bool) (Execution, error) {
	return s.installTool(sessionID, goplsModule, confirmed)
}

// installTool esegue `go install module` con GOBIN nella cartella strumenti, visibile nella Run console.
func (s *Service) installTool(sessionID, module string, confirmed bool) (Execution, error) {
	if !confirmed {
		return Execution{}, fmt.Errorf("conferma esplicita richiesta prima di scaricare lo strumento")
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("autorizza esplicitamente gli strumenti prima dell'installazione")
	}
	if s.toolsRoot == "" {
		return Execution{}, fmt.Errorf("cartella strumenti di adOmnia non configurata")
	}
	binary, err := s.toolchain.GoBinary(session.ID)
	if err != nil {
		return Execution{}, fmt.Errorf("serve un Go SDK per installare lo strumento: rilevalo o installalo prima")
	}
	binDirectory := filepath.Join(s.toolsRoot, "bin")
	if err := os.MkdirAll(binDirectory, 0o755); err != nil {
		return Execution{}, fmt.Errorf("impossibile preparare la cartella strumenti: %w", err)
	}
	environment, err := s.toolchain.Environment(session.ID, map[string]string{"GOBIN": binDirectory})
	if err != nil {
		return Execution{}, err
	}
	// Mai cambiare o scaricare toolchain Go: si installa la versione più recente compatibile con l'SDK selezionato.
	environment = withLocalToolchain(environment)
	ctx := context.Background()
	localGo, err := sdkGoVersion(ctx, binary, s.toolsRoot, environment)
	if err != nil {
		return Execution{}, err
	}
	resolved, note, err := resolveCompatibleToolModule(ctx, binary, s.toolsRoot, environment, module, localGo)
	if err != nil {
		return Execution{}, err
	}
	arguments := []string{"install", resolved}
	execution, err := s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "install", Executable: binary, Arguments: arguments,
		WorkingDirectory: s.toolsRoot, Environment: environment, DisplayCommand: displayCommand("go", arguments),
	})
	if err == nil && note != "" {
		s.processes.Notice(execution, note)
	}
	return execution, err
}

// languageServerEnvironment usa lo stesso SDK della sessione e mette il suo `go` per primo nel PATH, così gopls legge quello SDK.
func (s *Service) languageServerEnvironment(sessionID SessionID) ([]string, error) {
	environment, err := s.toolchain.Environment(sessionID, nil)
	if err != nil {
		return nil, err
	}
	binary, err := s.toolchain.GoBinary(sessionID)
	if err != nil {
		return environment, nil
	}
	goDirectory := filepath.Dir(binary)
	for index, entry := range environment {
		name, value, _ := strings.Cut(entry, "=")
		if strings.EqualFold(name, "PATH") {
			environment[index] = name + "=" + goDirectory + string(os.PathListSeparator) + value
			return environment, nil
		}
	}
	return append(environment, "PATH="+goDirectory), nil
}
