package goide

import (
	"os"
	"path/filepath"
	"sort"

	"golang.org/x/mod/modfile"
)

// WorkspaceModule è un modulo del progetto con i moduli dello stesso progetto che richiede.
type WorkspaceModule struct {
	ModulePath string `json:"modulePath"`
	// Directory è la cartella del modulo relativa al progetto ('' per la radice).
	Directory string `json:"directory"`
	// Requires sono i module path di altri moduli del progetto richiesti in go.mod.
	Requires []string `json:"requires"`
	// Replaced segnala i require soddisfatti da una replace verso una cartella locale.
	Replaced []string `json:"replaced"`
	// Error spiega un go.mod che non si legge.
	Error string `json:"error,omitempty"`
}

// WorkspaceModuleGraph legge i go.mod dei moduli del progetto (multi-modulo o go.work) senza
// avviare processi e restituisce le dipendenze tra loro, ordinate per module path.
func (s *Service) WorkspaceModuleGraph(sessionID string) ([]WorkspaceModule, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return workspaceModuleGraph(session.Project.RealPath, goLayoutOf(session.Project).Modules), nil
}

func workspaceModuleGraph(root string, modules []GoModule) []WorkspaceModule {
	known := map[string]bool{}
	for _, module := range modules {
		if module.ModulePath != "" {
			known[module.ModulePath] = true
		}
	}
	result := make([]WorkspaceModule, 0, len(modules))
	for _, module := range modules {
		entry := WorkspaceModule{ModulePath: module.ModulePath, Directory: filepath.ToSlash(relativeWithin(root, module.Path)), Requires: []string{}, Replaced: []string{}}
		data, err := os.ReadFile(filepath.Join(module.Path, "go.mod"))
		if err != nil {
			entry.Error = err.Error()
			result = append(result, entry)
			continue
		}
		parsed, err := modfile.Parse("go.mod", data, nil)
		if err != nil {
			entry.Error = err.Error()
			result = append(result, entry)
			continue
		}
		if entry.ModulePath == "" && parsed.Module != nil {
			entry.ModulePath = parsed.Module.Mod.Path
		}
		for _, require := range parsed.Require {
			if known[require.Mod.Path] && require.Mod.Path != entry.ModulePath {
				entry.Requires = append(entry.Requires, require.Mod.Path)
			}
		}
		for _, replace := range parsed.Replace {
			if known[replace.Old.Path] && modfile.IsDirectoryPath(replace.New.Path) {
				entry.Replaced = append(entry.Replaced, replace.Old.Path)
			}
		}
		sort.Strings(entry.Requires)
		sort.Strings(entry.Replaced)
		result = append(result, entry)
	}
	sort.Slice(result, func(left, right int) bool { return result[left].ModulePath < result[right].ModulePath })
	return result
}
