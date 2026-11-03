package eclipsepde

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// maxProjectDepth bounds the search for nested projects in a large repository.
const maxProjectDepth = 4

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

	for _, dir := range projectDirectories(abs) {
		proj, err := ReadEclipseProject(dir)
		if err != nil {
			ws.Problems = append(ws.Problems, Problem{
				Severity: "error", File: filepath.Join(dir, ".project"),
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

// projectDirectories finds the folders holding a `.project`: the opened folder
// itself, or projects nested in it (legacy repositories often use plugins/<name>).
// It does not descend into a project, build output or hidden folders such as
// Eclipse's `.metadata`. Unreadable folders are skipped.
func projectDirectories(root string) []string {
	var out []string
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return filepath.SkipDir
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && (project.IgnoredDirectory(entry.Name()) || strings.HasPrefix(entry.Name(), ".")) {
			return filepath.SkipDir
		}
		if fileExists(filepath.Join(path, ".project")) {
			out = append(out, path)
			return filepath.SkipDir
		}
		if rel, relErr := filepath.Rel(root, path); relErr == nil && strings.Count(rel, string(filepath.Separator)) >= maxProjectDepth {
			return filepath.SkipDir
		}
		return nil
	})
	return out
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
