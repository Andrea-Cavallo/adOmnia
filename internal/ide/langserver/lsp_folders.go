package langserver

import (
	"path/filepath"
	"sort"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// workspaceFolderRoots are the roots a language server of one language should be given in a project whose
// units of that language all live in subfolders (a monorepo: orders/ Go, billing/ Java, web/ TypeScript). A server
// started at the project root would see no go.mod / pom.xml / package.json there. It returns nil — one folder, the
// project root — when a unit of the language sits at the root (a plain module, a go.work), or when it has none.
func workspaceFolderRoots(projectRoot string, units []project.Unit, languageID string) []string {
	seen := map[string]bool{}
	var roots []string
	for _, unit := range units {
		if unit.Language != languageID || unit.Kind == "loose" {
			continue
		}
		if project.SamePath(unit.Root, projectRoot) {
			return nil
		}
		if key := filepath.Clean(unit.Root); !seen[key] {
			seen[key] = true
			roots = append(roots, key)
		}
	}
	sort.Strings(roots)
	return roots
}

// workspaceFolders is the LSP `workspaceFolders` value: the unit roots, or the project root alone.
func (state *lspSession) workspaceFolders() []map[string]any {
	if len(state.folders) == 0 {
		return []map[string]any{{"uri": state.rootURI, "name": state.name}}
	}
	folders := make([]map[string]any, 0, len(state.folders))
	for _, root := range state.folders {
		folders = append(folders, map[string]any{"uri": lsp.FileURI(root), "name": filepath.Base(root)})
	}
	return folders
}
