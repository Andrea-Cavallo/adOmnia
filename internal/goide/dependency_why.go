package goide

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"
)

// DependencyWhy è la catena di import più corta dal modulo principale al modulo dipendente
// (`go mod why -m`), o il motivo per cui non serve.
type DependencyWhy struct {
	Module  string   `json:"module"`
	Chain   []string `json:"chain"`
	Needed  bool     `json:"needed"`
	Message string   `json:"message,omitempty"`
}

// ParseModWhy legge l'output di `go mod why -m`.
func ParseModWhy(module, output string) DependencyWhy {
	why := DependencyWhy{Module: module, Chain: []string{}}
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "" || strings.HasPrefix(line, "#"):
		case strings.HasPrefix(line, "("):
			why.Message = strings.Trim(line, "()")
		default:
			why.Chain = append(why.Chain, line)
		}
	}
	why.Needed = len(why.Chain) > 0
	return why
}

// DependencyWhy esegue `go mod why -m module` nella radice del progetto (sola lettura, nessuna rete).
func (s *Service) DependencyWhy(sessionID, module string) (DependencyWhy, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DependencyWhy{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return DependencyWhy{}, errors.New("trust the project to run go mod why")
	}
	if !modulePathPattern.MatchString(module) {
		return DependencyWhy{}, errors.New("invalid module path")
	}
	environment, err := s.toolchain.Environment(SessionID(sessionID), nil)
	if err != nil {
		return DependencyWhy{}, err
	}
	binary, err := s.toolchain.GoBinary(SessionID(sessionID))
	if err != nil {
		return DependencyWhy{}, errors.New("go is not available: detect or configure the toolchain")
	}
	directory := session.Project.RealPath
	if modules := goLayoutOf(session.Project).Modules; len(modules) > 0 {
		directory = modules[0].Path
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "mod", "why", "-m", module)
	command.Dir, command.Env = directory, append(withGoFirstInPath(environment, binary), "GOPROXY=off")
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if err != nil {
		return DependencyWhy{Module: module, Chain: []string{}, Message: strings.TrimSpace(string(output))}, nil
	}
	return ParseModWhy(module, string(output)), nil
}
