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

type GoReplacement struct {
	Path       string `json:"path"`
	Version    string `json:"version,omitempty"`
	NewPath    string `json:"newPath"`
	NewVersion string `json:"newVersion,omitempty"`
	Local      bool   `json:"local"`
}

type DependencyState struct {
	ModuleDirectory string          `json:"moduleDirectory"`
	ModulePath      string          `json:"modulePath"`
	GoModPath       string          `json:"goModPath"`
	GoSumPresent    bool            `json:"goSumPresent"`
	Dependencies    []GoDependency  `json:"dependencies"`
	Replacements    []GoReplacement `json:"replacements"`
}

type DependencyActionRequest struct {
	SessionID       SessionID `json:"sessionId"`
	ModuleDirectory string    `json:"moduleDirectory"`
	Action          string    `json:"action"`
	ModulePath      string    `json:"modulePath"`
	Version         string    `json:"version"`
	LocalPath       string    `json:"localPath,omitempty"`
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
	state := DependencyState{ModuleDirectory: moduleDirectory, GoModPath: goModPath, Dependencies: []GoDependency{}, Replacements: []GoReplacement{}}
	if parsed.Module != nil {
		state.ModulePath = parsed.Module.Mod.Path
	}
	for _, requirement := range parsed.Require {
		state.Dependencies = append(state.Dependencies, GoDependency{Path: requirement.Mod.Path, Version: requirement.Mod.Version, Indirect: requirement.Indirect})
	}
	sort.Slice(state.Dependencies, func(left, right int) bool { return state.Dependencies[left].Path < state.Dependencies[right].Path })
	for _, replacement := range parsed.Replace {
		state.Replacements = append(state.Replacements, GoReplacement{
			Path: replacement.Old.Path, Version: replacement.Old.Version, NewPath: replacement.New.Path,
			NewVersion: replacement.New.Version, Local: replacement.New.Version == "",
		})
	}
	_, err = os.Stat(filepath.Join(moduleDirectory, "go.sum"))
	state.GoSumPresent = err == nil
	return state, nil
}

// moduleWideActions non richiedono un modulo specifico: agiscono sull'intero go.mod.
var moduleWideActions = map[string][]string{
	"updateall":   {"get", "-u", "./..."},
	"updatepatch": {"get", "-u=patch", "./..."},
	"download":    {"mod", "download"},
	"verify":      {"mod", "verify"},
	"tidy":        {"mod", "tidy"},
}

// dependencyArguments traduce un'azione rapida del go.mod in argomenti strutturati del comando go.
func dependencyArguments(request DependencyActionRequest, moduleDirectory string) ([]string, error) {
	action := strings.ToLower(strings.TrimSpace(request.Action))
	if arguments, ok := moduleWideActions[action]; ok {
		return append([]string(nil), arguments...), nil
	}
	modulePath := strings.TrimSpace(request.ModulePath)
	if !modulePathPattern.MatchString(modulePath) || strings.Contains(modulePath, "//") {
		return nil, fmt.Errorf("percorso modulo non valido")
	}
	switch action {
	case "remove":
		return []string{"get", modulePath + "@none"}, nil
	case "dropreplace":
		return []string{"mod", "edit", "-dropreplace=" + modulePath}, nil
	case "replace":
		local, err := localReplacementPath(moduleDirectory, request.LocalPath)
		if err != nil {
			return nil, err
		}
		return []string{"mod", "edit", "-replace=" + modulePath + "=" + local}, nil
	case "add", "update":
		version := strings.TrimSpace(request.Version)
		if version == "" {
			version = "latest"
		}
		if version != "latest" && !moduleVersionPattern.MatchString(version) {
			return nil, fmt.Errorf("versione modulo non valida")
		}
		return []string{"get", modulePath + "@" + version}, nil
	}
	return nil, fmt.Errorf("azione dipendenza non supportata")
}

// localReplacementPath valida la cartella locale di una replace (deve contenere un go.mod) e la
// esprime relativa al modulo quando possibile, come la scriverebbe uno sviluppatore: ../mylib.
func localReplacementPath(moduleDirectory, candidate string) (string, error) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", fmt.Errorf("scegli la cartella locale del modulo")
	}
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(moduleDirectory, candidate)
	}
	candidate = filepath.Clean(candidate)
	if strings.ContainsAny(candidate, "=\x00") {
		return "", fmt.Errorf("percorso locale non valido")
	}
	if info, err := os.Stat(filepath.Join(candidate, "go.mod")); err != nil || info.IsDir() {
		return "", fmt.Errorf("la cartella scelta non contiene un go.mod")
	}
	relative, err := filepath.Rel(moduleDirectory, candidate)
	if err != nil || filepath.VolumeName(relative) != "" {
		return filepath.ToSlash(candidate), nil
	}
	relative = filepath.ToSlash(relative)
	if !strings.HasPrefix(relative, ".") {
		relative = "./" + relative
	}
	return relative, nil
}
