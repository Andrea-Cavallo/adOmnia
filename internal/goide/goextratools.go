package goide

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// GoToolInfo dice dove si trova un tool Go (govulncheck, goimports, mockgen, stringer o uno dell'utente).
type GoToolInfo struct {
	Binary    string `json:"binary"`
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	// Source: managed (cartella strumenti di adOmnia), gobin, gopath o path.
	Source string `json:"source,omitempty"`
	Error  string `json:"error,omitempty"`
}

var (
	toolBinaryPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	// Un modulo go install: percorso di import più @versione (latest, v1.2.3, un commit).
	toolModulePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._~/-]{2,199}@[A-Za-z0-9._+-]{1,64}$`)
)

// DetectGoTool cerca il binario nella cartella strumenti di adOmnia, in GOBIN, in GOPATH/bin e nel PATH.
func (s *Service) DetectGoTool(sessionID, binary string) (GoToolInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return GoToolInfo{}, err
	}
	binary = strings.TrimSpace(binary)
	if !toolBinaryPattern.MatchString(binary) {
		return GoToolInfo{}, fmt.Errorf("nome di tool non valido: %q", binary)
	}
	info := GoToolInfo{Binary: binary}
	name := executableName(binary)
	candidates := []struct{ dir, source string }{}
	if s.toolsRoot != "" {
		candidates = append(candidates, struct{ dir, source string }{filepath.Join(s.toolsRoot, "bin"), "managed"})
	}
	if detected, ok := s.toolchain.LastDetected(session.ID); ok {
		if gobin := s.toolchain.Configuration(session.ID).Environment["GOBIN"]; gobin != "" {
			candidates = append(candidates, struct{ dir, source string }{gobin, "gobin"})
		}
		if gopath := detected.GOPATH; gopath != "" {
			for _, entry := range filepath.SplitList(gopath) {
				candidates = append(candidates, struct{ dir, source string }{filepath.Join(entry, "bin"), "gopath"})
			}
		}
	}
	for _, candidate := range candidates {
		path := filepath.Join(candidate.dir, name)
		if stat, err := os.Stat(path); err == nil && !stat.IsDir() {
			info.Available, info.Path, info.Source = true, path, candidate.source
			return info, nil
		}
	}
	if path, err := exec.LookPath(binary); err == nil {
		info.Available, info.Path, info.Source = true, path, "path"
		return info, nil
	}
	info.Error = binary + " non è installato: installalo con go install"
	return info, nil
}

// InstallGoModule esegue `go install <modulo>@<versione>` nella cartella strumenti, dopo conferma esplicita.
func (s *Service) InstallGoModule(sessionID, module string, confirmed bool) (Execution, error) {
	module = strings.TrimSpace(module)
	if !toolModulePattern.MatchString(module) || strings.Contains(module, "..") {
		return Execution{}, fmt.Errorf("modulo non valido: usa percorso@versione, es. golang.org/x/vuln/cmd/govulncheck@latest")
	}
	return s.installTool(sessionID, module, confirmed)
}

// RunGoTool esegue un tool Go rilevato con argomenti strutturati (mai una shell), nella cartella indicata del progetto.
func (s *Service) RunGoTool(sessionID, binary string, arguments []string, workingDirectory string) (Execution, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	info, err := s.DetectGoTool(sessionID, binary)
	if err != nil {
		return Execution{}, err
	}
	if !info.Available {
		return Execution{}, fmt.Errorf("%s", info.Error)
	}
	directory, err := s.documents.resolveDirectory(session.Project, workingDirectory)
	if err != nil {
		return Execution{}, err
	}
	for _, argument := range arguments {
		if strings.ContainsRune(argument, '\x00') {
			return Execution{}, fmt.Errorf("argomento non valido")
		}
	}
	// I tool Go invocano a loro volta `go` (packages.Load): serve lo stesso SDK del progetto per primo nel PATH.
	environment, err := s.languageServerEnvironment(session.ID)
	if err != nil {
		return Execution{}, err
	}
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "tool", Executable: info.Path, Arguments: append([]string(nil), arguments...),
		WorkingDirectory: directory, Environment: environment, DisplayCommand: displayCommand(binary, arguments),
	})
}
