package golang

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
)

// RunOptions belongs to the Go adapter; the core stores its JSON unchanged.
type RunOptions struct {
	GoArguments  []string `json:"goArguments,omitempty"`
	BuildTags    []string `json:"buildTags,omitempty"`
	ExtraTargets []string `json:"extraTargets,omitempty"`
	GOOS         string   `json:"goos,omitempty"`
	GOARCH       string   `json:"goarch,omitempty"`
	Race         bool     `json:"race,omitempty"`
	Coverage     bool     `json:"coverage,omitempty"`
	Profile      string   `json:"profile,omitempty"`
	DebugFlags   []string `json:"debugFlags,omitempty"`
}

func (*Language) RunKinds() []string {
	return []string{"run", "build", "test", "vet", "generate", "install", "tidy", "go-tool", "package", "files"}
}

func (l *Language) CommandSpec(request run.Request) (run.CommandSpec, error) {
	if !slices.Contains(l.RunKinds(), request.Kind) {
		return run.CommandSpec{}, fmt.Errorf("tipo Go non supportato: %s", request.Kind)
	}
	var options RunOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return run.CommandSpec{}, fmt.Errorf("opzioni Go non valide: %w", err)
		}
	}
	if err := ValidateGoArguments(request.Root, request.WorkingDirectory, options.GoArguments); err != nil {
		return run.CommandSpec{}, err
	}
	if request.Kind != "go-tool" {
		for _, target := range append([]string{request.Target}, options.ExtraTargets...) {
			if strings.TrimSpace(target) == "" || strings.HasPrefix(target, "-") || strings.ContainsRune(target, '\x00') {
				return run.CommandSpec{}, fmt.Errorf("target Go non valido")
			}
			path := filepath.FromSlash(target)
			if filepath.IsAbs(path) || filepath.VolumeName(path) != "" {
				return run.CommandSpec{}, fmt.Errorf("il target deve restare relativo al progetto")
			}
			path = filepath.Join(request.WorkingDirectory, path)
			if err := project.EnsureWithin(request.Root, path); err != nil {
				return run.CommandSpec{}, err
			}
			if resolved, err := filepath.EvalSymlinks(path); err == nil {
				if err := project.EnsureWithin(request.Root, resolved); err != nil {
					return run.CommandSpec{}, err
				}
			}
		}
	}
	if strings.TrimSpace(request.Executable) == "" {
		return run.CommandSpec{}, fmt.Errorf("go non disponibile: rileva o configura la toolchain prima di eseguire")
	}
	kind := request.Kind
	if kind == "package" || kind == "files" {
		kind = "run"
	}
	arguments := append([]string{kind}, options.GoArguments...)
	if kind == "tidy" {
		arguments = []string{"mod", "tidy"}
	} else if kind == "go-tool" {
		arguments = append([]string{request.Target}, request.ProgramArguments...)
	} else {
		if len(options.BuildTags) > 0 && kind != "generate" {
			arguments = append(arguments, "-tags", strings.Join(options.BuildTags, ","))
		}
		arguments = append(arguments, request.Target)
		arguments = append(arguments, options.ExtraTargets...)
	}
	display := displayRunCommand("go", arguments)
	if kind == "run" || kind == "test" {
		arguments = append(arguments, request.ProgramArguments...)
		if kind == "run" && len(request.ProgramArguments) > 0 {
			display += fmt.Sprintf(" <%d program args>", len(request.ProgramArguments))
		} else if kind == "test" {
			display = displayRunCommand("go", arguments)
		}
	}
	return run.CommandSpec{Executable: request.Executable, Arguments: arguments, DisplayCommand: display, WorkingDirectory: request.WorkingDirectory, Environment: request.Environment, Kind: request.Kind}, nil
}

func displayRunCommand(executable string, arguments []string) string {
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
