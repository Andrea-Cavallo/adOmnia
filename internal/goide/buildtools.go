package goide

import (
	"adomnia/internal/ide/run"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// MakeInfo descrive il make usato dalla sessione.
type MakeInfo struct {
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	Source    string `json:"source,omitempty"`
	Error     string `json:"error,omitempty"`
}

const makeMissingMessage = "make non trovato: installalo (Windows: winget install ezwinports.make, choco install make o scoop install make) oppure indica il binario in Go → Tool Paths"

// makeCandidates: binario personalizzato, poi make/gmake/mingw32-make nel PATH e il percorso standard di GnuWin32.
func (s *Service) makeCandidates(sessionID SessionID) []MakeInfo {
	s.goplsMu.Lock()
	custom := s.makeBinaries[sessionID]
	s.goplsMu.Unlock()
	if custom != "" {
		return []MakeInfo{{Binary: custom, Source: "custom"}}
	}
	candidates := []MakeInfo{}
	for _, name := range []string{"make", "gmake", "mingw32-make"} {
		if binary, err := exec.LookPath(name); err == nil {
			candidates = append(candidates, MakeInfo{Binary: binary, Source: "path"})
		}
	}
	if programs := os.Getenv("ProgramFiles(x86)"); programs != "" {
		candidates = append(candidates, MakeInfo{Binary: filepath.Join(programs, "GnuWin32", "bin", "make.exe"), Source: "gnuwin32"})
	}
	return candidates
}

func (s *Service) resolveMake(sessionID SessionID) (string, error) {
	info := s.detectMake(sessionID)
	if !info.Available {
		return "", errors.New(info.Error)
	}
	return info.Binary, nil
}

func (s *Service) detectMake(sessionID SessionID) MakeInfo {
	for _, candidate := range s.makeCandidates(sessionID) {
		if stat, err := os.Stat(candidate.Binary); err == nil && !stat.IsDir() {
			candidate.Available = true
			return candidate
		}
		if candidate.Source == "custom" {
			return MakeInfo{Binary: candidate.Binary, Source: "custom", Error: "il binario make configurato non esiste"}
		}
	}
	return MakeInfo{Error: makeMissingMessage}
}

// DetectMake indica quale make userebbe la sessione.
func (s *Service) DetectMake(sessionID string) (MakeInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return MakeInfo{}, err
	}
	return s.detectMake(session.ID), nil
}

// ConfigureMake imposta un binario make personalizzato; vuoto torna alla ricerca automatica.
func (s *Service) ConfigureMake(sessionID, binary string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	binary = strings.TrimSpace(binary)
	if binary != "" {
		abs, err := filepath.Abs(binary)
		if err != nil {
			return fmt.Errorf("percorso make non valido: %w", err)
		}
		if info, err := os.Stat(abs); err != nil || info.IsDir() {
			return fmt.Errorf("il percorso indicato non è un eseguibile make")
		}
		binary = abs
	}
	s.goplsMu.Lock()
	if binary == "" {
		delete(s.makeBinaries, session.ID)
	} else {
		s.makeBinaries[session.ID] = binary
	}
	s.goplsMu.Unlock()
	return nil
}

func toolRequest(r RunRequest) run.ToolRequest {
	return run.ToolRequest{SessionID: r.SessionID, Kind: r.Kind, Target: r.Target, WorkingDirectory: r.WorkingDirectory, ProgramArguments: r.ProgramArguments, Environment: r.Environment, Docker: r.Docker, Secrets: r.Secrets}
}
func toolSession(s Session) run.Session {
	return run.Session{ID: s.ID, Project: run.ToolProject{Name: s.Project.Name, RealPath: s.Project.RealPath}}
}
func (s *Service) tools(request RunRequest) *run.Tools {
	return &run.Tools{Processes: s.processes, ResolveMake: s.resolveMake, Authorized: func(id SessionID) bool {
		session, err := s.session(string(id))
		return err == nil && session.Project.Authorization == AuthorizationPermitted
	}, Remember: func(id RunID, r run.ToolRequest) {
		remembered := request
		remembered.SessionID, remembered.Kind, remembered.Target, remembered.WorkingDirectory = r.SessionID, r.Kind, r.Target, r.WorkingDirectory
		remembered.Docker, remembered.Environment, remembered.ProgramArguments, remembered.Secrets = r.Docker, r.Environment, r.ProgramArguments, r.Secrets
		s.rememberRunRequest(id, remembered)
	}}
}
func (s *Service) startToolRun(session Session, kind, wd string, request RunRequest) (Execution, error) {
	return s.tools(request).StartToolRun(toolSession(session), kind, wd, toolRequest(request))
}
func (s *Service) toolCommandSpec(session Session, kind, wd, target string, request RunRequest) (CommandSpec, error) {
	return s.tools(request).ToolCommandSpec(toolSession(session), kind, wd, target, toolRequest(request))
}
func (s *Service) dockerRunSpec(session Session, wd string, request RunRequest) (CommandSpec, string, error) {
	return s.tools(request).DockerRunSpec(toolSession(session), wd, toolRequest(request))
}
func imageTag(session Session, options DockerOptions) string {
	return run.ImageTag(toolSession(session), options)
}
func normalizeToolConfiguration(config RunConfiguration) (RunConfiguration, error) {
	n, err := run.NormalizeToolConfiguration(toCoreConfiguration(config))
	config.Target, config.Files, config.BinaryPath, config.GoArguments, config.BuildTags, config.Docker, config.ProgramArguments = n.Target, nil, "", nil, nil, n.Docker, n.ProgramArguments
	return config, err
}
func toolEnvironment(kind string, r RunRequest) map[string]string {
	return run.ToolEnvironment(kind, toolRequest(r))
}

var isToolRunKind = run.IsToolRunKind
var normalizeMakeArguments = run.NormalizeMakeArguments
var normalizeComposeArguments = run.NormalizeComposeArguments
var normalizeDockerOptions = run.NormalizeDockerOptions
var normalizeEntries = run.NormalizeEntries
var splitVolume = run.SplitVolume

func validateToolPaths(root, wd string, kind RunConfigurationKind, target string, docker DockerOptions) error {
	return run.ValidateToolPaths(root, wd, run.Kind(kind), target, docker)
}

var dockerBuildArguments = run.DockerBuildArguments
var composeCommandSpec = run.ComposeCommandSpec
var keyValueArgument = run.KeyValueArgument
var secretSet = run.SecretSet
var resolveDocker = run.ResolveDocker
