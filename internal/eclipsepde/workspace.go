package eclipsepde

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Workspace is the result of importing an Eclipse workspace folder: one or more
// projects plus the problems found reading them. The import is strictly
// read-only (spec section 6).
type Workspace struct {
	Root     string
	Projects []*EclipseProject
	Problems []Problem
}

// ImportWorkspace scans root for Eclipse projects (directories containing a
// `.project` file), loads their PDE metadata and reports problems. Files are
// only read, never modified.
func ImportWorkspace(root string) (*Workspace, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s: not a directory", abs)
	}
	ws := &Workspace{Root: abs}

	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(abs, entry.Name())
		if !fileExists(filepath.Join(dir, ".project")) {
			continue
		}
		proj, err := ReadEclipseProject(dir)
		if err != nil {
			ws.Problems = append(ws.Problems, Problem{
				Severity: "error", File: filepath.Join(entry.Name(), ".project"),
				Message: "project cannot be imported: " + err.Error(),
			})
			continue
		}
		ws.Projects = append(ws.Projects, proj)
	}
	sort.Slice(ws.Projects, func(i, j int) bool { return ws.Projects[i].Name < ws.Projects[j].Name })

	// Workspace-level checks: duplicate project names, bundles without manifests
	// when they carry the plug-in nature.
	seen := map[string]string{}
	for _, proj := range ws.Projects {
		if prev, dup := seen[proj.Name]; dup {
			ws.Problems = append(ws.Problems, Problem{
				Severity: "error", Project: proj.Name,
				Message: fmt.Sprintf("duplicate project name %q also used by %s", proj.Name, prev),
			})
		}
		seen[proj.Name] = proj.Dir
		if proj.HasNature("org.eclipse.pde.PluginNature") && proj.Bundle == nil {
			ws.Problems = append(ws.Problems, Problem{
				Severity: "warning", Project: proj.Name,
				Message: "project has the plug-in nature but no META-INF/MANIFEST.MF",
			})
		}
	}
	return ws, nil
}

// Bundles lists the workspace projects that are OSGi bundles.
func (w *Workspace) Bundles() []*EclipseProject {
	var out []*EclipseProject
	for _, p := range w.Projects {
		if p.IsPdePlugin() {
			out = append(out, p)
		}
	}
	return out
}

// ProjectByName finds a workspace project by its Eclipse name.
func (w *Workspace) ProjectByName(name string) *EclipseProject {
	for _, p := range w.Projects {
		if p.Name == name {
			return p
		}
	}
	return nil
}

// AllProblems returns workspace problems followed by per-project problems.
func (w *Workspace) AllProblems() []Problem {
	out := append([]Problem{}, w.Problems...)
	for _, p := range w.Projects {
		out = append(out, p.Problems...)
	}
	return out
}
