package run

import (
	"adomnia/internal/ide/project"
	"adomnia/internal/ide/sdk"
	"fmt"

	"path/filepath"
	"strings"
)

const (
	RunKindMake          Kind = "make"
	RunKindDockerBuild   Kind = "docker-build"
	RunKindDockerRun     Kind = "docker-run"
	RunKindDockerCompose Kind = "docker-compose"
)

type ToolProject struct{ Name, RealPath string }
type Session struct {
	ID      SessionID
	Project ToolProject
}
type ToolRequest struct {
	SessionID                      SessionID
	Kind, Target, WorkingDirectory string
	ProgramArguments               []string
	Environment                    map[string]string
	Docker                         DockerOptions
	Secrets                        []string
}
type Tools struct {
	Processes   *ProcessManager
	ResolveMake func(SessionID) (string, error)
	Remember    func(RunID, ToolRequest)
	Authorized  func(SessionID) bool
}

var ensureWithinRoot = project.EnsureWithin
var validEnvironmentName = sdk.ValidEnvironmentName

func Environment(overrides map[string]string) ([]string, error) {
	env, err := sdk.ProcessEnvironment(nil, overrides)
	if err != nil {
		return nil, err
	}
	return sdk.EnvironmentList(env), nil
}
func trimArguments(values []string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			out = append(out, s)
		}
	}
	return out
}
func validateRunTarget(root, workingDirectory, target string) error {
	trimmed := strings.TrimSpace(target)
	if trimmed == "" || strings.HasPrefix(trimmed, "-") || strings.ContainsRune(trimmed, '\x00') {
		return fmt.Errorf("target non valido")
	}
	converted := filepath.FromSlash(trimmed)
	if filepath.IsAbs(converted) || filepath.VolumeName(converted) != "" {
		return fmt.Errorf("il target deve restare relativo al progetto")
	}
	candidate := filepath.Clean(filepath.Join(workingDirectory, converted))
	if err := ensureWithinRoot(root, candidate); err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(candidate); err == nil {
		return ensureWithinRoot(root, resolved)
	}
	return nil
}

var ValidateTarget = validateRunTarget

func displayCommand(executable string, arguments []string) string {
	parts := []string{executable}
	for _, argument := range arguments {
		if strings.ContainsAny(argument, " \t\"") {
			parts = append(parts, fmt.Sprintf("%q", argument))
		} else {
			parts = append(parts, argument)
		}
	}
	return strings.Join(parts, " ")
}
