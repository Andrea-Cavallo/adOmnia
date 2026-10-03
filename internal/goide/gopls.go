package goide

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"adomnia/internal/languages/golang"
)

// DetectGopls individua gopls (personalizzato, cartella strumenti, GOPATH/bin, PATH) e ne legge la versione.
func (s *Service) DetectGopls(sessionID string) (GoplsInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return GoplsInfo{}, err
	}
	s.goplsMu.RLock()
	custom := s.goplsBinaries[session.ID]
	s.goplsMu.RUnlock()
	return golang.LocateGopls(custom, s.toolsRoot, s.sessionGOPATH(session.ID)), nil
}

// sessionGOPATH è il GOPATH dell'SDK rilevato per la sessione (vuoto se non ancora rilevato).
func (s *Service) sessionGOPATH(sessionID SessionID) string {
	if info, ok := s.toolchain.LastDetected(sessionID); ok {
		return info.GOPATH
	}
	return ""
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
	return s.installTool(sessionID, golang.GoplsModule, confirmed)
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
