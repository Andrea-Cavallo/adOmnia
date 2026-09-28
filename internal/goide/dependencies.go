package goide

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"golang.org/x/mod/modfile"
)

var moduleVersionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+\-]*$`)

type GoDependency struct {
	Path     string `json:"path"`
	Version  string `json:"version"`
	Indirect bool   `json:"indirect"`
}

type DependencyState struct {
	ModuleDirectory string         `json:"moduleDirectory"`
	ModulePath      string         `json:"modulePath"`
	GoModPath       string         `json:"goModPath"`
	GoSumPresent    bool           `json:"goSumPresent"`
	Dependencies    []GoDependency `json:"dependencies"`
}

type DependencyActionRequest struct {
	SessionID       SessionID `json:"sessionId"`
	ModuleDirectory string    `json:"moduleDirectory"`
	Action          string    `json:"action"`
	ModulePath      string    `json:"modulePath"`
	Version         string    `json:"version"`
	Confirmed       bool      `json:"confirmed"`
}

func readDependencyState(project Project, directory string) (DependencyState, error) {
	manager := NewDocumentManager()
	moduleDirectory, err := manager.resolveDirectory(project, directory)
	if err != nil {
		return DependencyState{}, err
	}
	goModPath := filepath.Join(moduleDirectory, "go.mod")
	data, err := os.ReadFile(goModPath)
	if err != nil {
		return DependencyState{}, fmt.Errorf("go.mod non leggibile: %w", err)
	}
	parsed, err := modfile.Parse(goModPath, data, nil)
	if err != nil {
		return DependencyState{}, fmt.Errorf("go.mod non valido: %w", err)
	}
	state := DependencyState{ModuleDirectory: moduleDirectory, GoModPath: goModPath, Dependencies: []GoDependency{}}
	if parsed.Module != nil {
		state.ModulePath = parsed.Module.Mod.Path
	}
	for _, requirement := range parsed.Require {
		state.Dependencies = append(state.Dependencies, GoDependency{Path: requirement.Mod.Path, Version: requirement.Mod.Version, Indirect: requirement.Indirect})
	}
	sort.Slice(state.Dependencies, func(left, right int) bool { return state.Dependencies[left].Path < state.Dependencies[right].Path })
	_, err = os.Stat(filepath.Join(moduleDirectory, "go.sum"))
	state.GoSumPresent = err == nil
	return state, nil
}

func dependencyArguments(request DependencyActionRequest) ([]string, error) {
	action := strings.ToLower(strings.TrimSpace(request.Action))
	modulePath := strings.TrimSpace(request.ModulePath)
	version := strings.TrimSpace(request.Version)
	if action != "add" && action != "update" && action != "remove" {
		return nil, fmt.Errorf("azione dipendenza non supportata")
	}
	if !modulePathPattern.MatchString(modulePath) || strings.Contains(modulePath, "//") {
		return nil, fmt.Errorf("percorso modulo non valido")
	}
	if action == "remove" {
		return []string{"get", modulePath + "@none"}, nil
	}
	if version == "" {
		version = "latest"
	}
	if version != "latest" && !moduleVersionPattern.MatchString(version) {
		return nil, fmt.Errorf("versione modulo non valida")
	}
	return []string{"get", modulePath + "@" + version}, nil
}
