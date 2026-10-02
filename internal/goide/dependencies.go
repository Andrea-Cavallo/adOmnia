package goide

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

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

// GoExclusion è una direttiva exclude: quella versione del modulo non viene mai scelta.
type GoExclusion struct {
	Path    string `json:"path"`
	Version string `json:"version"`
}

// GoRetraction è una direttiva retract del modulo stesso: Low == High per una singola versione.
type GoRetraction struct {
	Low       string `json:"low"`
	High      string `json:"high"`
	Rationale string `json:"rationale,omitempty"`
}

type DependencyState struct {
	ModuleDirectory string          `json:"moduleDirectory"`
	ModulePath      string          `json:"modulePath"`
	GoModPath       string          `json:"goModPath"`
	GoSumPresent    bool            `json:"goSumPresent"`
	GoVersion       string          `json:"goVersion,omitempty"`
	Toolchain       string          `json:"toolchain,omitempty"`
	Dependencies    []GoDependency  `json:"dependencies"`
	Replacements    []GoReplacement `json:"replacements"`
	Excludes        []GoExclusion   `json:"excludes"`
	Retracts        []GoRetraction  `json:"retracts"`
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
	state := DependencyState{ModuleDirectory: moduleDirectory, GoModPath: goModPath, Dependencies: []GoDependency{}, Replacements: []GoReplacement{}, Excludes: []GoExclusion{}, Retracts: []GoRetraction{}}
	if parsed.Module != nil {
		state.ModulePath = parsed.Module.Mod.Path
	}
	if parsed.Go != nil {
		state.GoVersion = parsed.Go.Version
	}
	if parsed.Toolchain != nil {
		state.Toolchain = parsed.Toolchain.Name
	}
	for _, exclude := range parsed.Exclude {
		state.Excludes = append(state.Excludes, GoExclusion{Path: exclude.Mod.Path, Version: exclude.Mod.Version})
	}
	for _, retract := range parsed.Retract {
		state.Retracts = append(state.Retracts, GoRetraction{Low: retract.Low, High: retract.High, Rationale: retract.Rationale})
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
	// tidydiff mostra cosa cambierebbe go mod tidy senza toccare go.mod e go.sum (Go 1.23+).
	"tidydiff": {"mod", "tidy", "-diff"},
}

var (
	goDirectivePattern = regexp.MustCompile(`^1\.\d+(\.\d+)?((rc|beta)\d+)?$`)
	toolchainPattern   = regexp.MustCompile(`^(go1\.\d+(\.\d+)?((rc|beta)\d+)?(-[A-Za-z0-9.+\-]+)?|none)$`)
	semverPattern      = regexp.MustCompile(`^v\d+\.\d+\.\d+(-[0-9A-Za-z.\-]+)?(\+[0-9A-Za-z.\-]+)?$`)
)

// goModEditArguments gestisce le direttive di go.mod che non riguardano una dipendenza:
// go, toolchain, module, retract. ok=false se l'azione non è una di queste.
func goModEditArguments(action string, request DependencyActionRequest) ([]string, bool, error) {
	value := strings.TrimSpace(request.Version)
	switch action {
	case "goversion":
		if !goDirectivePattern.MatchString(value) {
			return nil, true, fmt.Errorf("versione Go non valida: usa 1.23 o 1.23.4")
		}
		return []string{"mod", "edit", "-go=" + value}, true, nil
	case "toolchain":
		if !toolchainPattern.MatchString(value) {
			return nil, true, fmt.Errorf("toolchain non valida: usa go1.23.4 oppure none")
		}
		return []string{"mod", "edit", "-toolchain=" + value}, true, nil
	case "module":
		path := strings.TrimSpace(request.ModulePath)
		if !modulePathPattern.MatchString(path) || strings.Contains(path, "//") {
			return nil, true, fmt.Errorf("module path non valido")
		}
		return []string{"mod", "edit", "-module=" + path}, true, nil
	case "retract", "dropretract":
		if !validRetraction(value) {
			return nil, true, fmt.Errorf("retract non valido: usa v1.2.3 oppure [v1.0.0,v1.2.0]")
		}
		return []string{"mod", "edit", "-" + action + "=" + value}, true, nil
	}
	return nil, false, nil
}

func validRetraction(value string) bool {
	if semverPattern.MatchString(value) {
		return true
	}
	inner, ok := strings.CutPrefix(value, "[")
	if !ok {
		return false
	}
	inner, ok = strings.CutSuffix(inner, "]")
	low, high, found := strings.Cut(inner, ",")
	return ok && found && semverPattern.MatchString(strings.TrimSpace(low)) && semverPattern.MatchString(strings.TrimSpace(high))
}

// dependencyArguments traduce un'azione rapida del go.mod in argomenti strutturati del comando go.
func dependencyArguments(request DependencyActionRequest, moduleDirectory string) ([]string, error) {
	action := strings.ToLower(strings.TrimSpace(request.Action))
	if arguments, ok := moduleWideActions[action]; ok {
		return append([]string(nil), arguments...), nil
	}
	if arguments, ok, err := goModEditArguments(action, request); ok {
		return arguments, err
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
	case "exclude", "dropexclude":
		version := strings.TrimSpace(request.Version)
		if !semverPattern.MatchString(version) {
			return nil, fmt.Errorf("versione da escludere non valida: usa v1.2.3")
		}
		return []string{"mod", "edit", "-" + action + "=" + modulePath + "@" + version}, nil
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

// moduleVersionsTimeout: la lista versioni passa dal GOPROXY, su VPN può essere lenta.
const moduleVersionsTimeout = 30 * time.Second

// ListModuleVersions elenca le versioni pubblicate di una dipendenza (go list -m -versions), dalla più
// recente: serve a scegliere un aggiornamento o un downgrade. Contatta il GOPROXY configurato.
func (s *Service) ListModuleVersions(sessionID, moduleDirectory, modulePath string) ([]string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	modulePath = strings.TrimSpace(modulePath)
	if !modulePathPattern.MatchString(modulePath) || strings.Contains(modulePath, "//") {
		return nil, fmt.Errorf("percorso modulo non valido")
	}
	directory, err := s.documents.resolveDirectory(session.Project, moduleDirectory)
	if err != nil {
		return nil, err
	}
	output, err := s.runModuleCommand(session.ID, directory, moduleVersionsTimeout, "list", "-m", "-versions", "-json", modulePath)
	if err != nil {
		return nil, err
	}
	return parseModuleVersions(output)
}

// parseModuleVersions legge l'output JSON di go list -m -versions e restituisce le versioni dalla più recente.
func parseModuleVersions(output string) ([]string, error) {
	var listed struct {
		Versions []string `json:"Versions"`
		Version  string   `json:"Version"`
	}
	if err := json.Unmarshal([]byte(output), &listed); err != nil {
		return nil, fmt.Errorf("risposta di go list non leggibile: %w", err)
	}
	versions := listed.Versions
	if len(versions) == 0 && listed.Version != "" {
		versions = []string{listed.Version}
	}
	reversed := make([]string, 0, len(versions))
	for index := len(versions) - 1; index >= 0; index-- {
		reversed = append(reversed, versions[index])
	}
	return reversed, nil
}
