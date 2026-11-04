package eclipsepde

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ActivatorInfo is one Bundle-Activator of the workspace, with the Java source
// location of its start/stop methods: the Activator Inspector opens them and sets
// breakpoints there. A bundle without Bundle-Activator is not an error (fragments and
// plain libraries have none) and is simply absent from the list.
type ActivatorInfo struct {
	Bundle    string `json:"bundle"`
	Version   string `json:"version"`
	Class     string `json:"class"`
	Policy    string `json:"policy"`
	Lazy      bool   `json:"lazy"`
	StartLine int    `json:"startLine,omitzero"`
	StopLine  int    `json:"stopLine,omitzero"`
	// File is the activator source relative to the project root when it is inside it,
	// else absolute. Empty when the class is inside a Bundle-ClassPath jar.
	File string `json:"file,omitempty"`
	// FileExists is false when the class is declared but its source is not in the
	// bundle source folders (generated activator, classes in a jar, wrong package).
	FileExists bool `json:"fileExists"`
	// Location is the bundle directory (relative when inside the project).
	Location string `json:"location"`
}

var (
	activatorStartMethod = regexp.MustCompile(`\bvoid\s+start\s*\(\s*(?:final\s+)?(?:[\w.]+\.)?BundleContext\b`)
	activatorStopMethod  = regexp.MustCompile(`\bvoid\s+stop\s*\(\s*(?:final\s+)?(?:[\w.]+\.)?BundleContext\b`)
)

// Activators lists the Bundles-Activator of the workspace bundles, in bundle order.
// It reads manifests and Java sources; it never compiles or starts anything.
func Activators(ws *Workspace) []ActivatorInfo {
	var out []ActivatorInfo
	for _, proj := range ws.Bundles() {
		bundle := proj.Bundle
		if bundle == nil || bundle.Activator == "" {
			continue
		}
		info := ActivatorInfo{
			Bundle:   bundle.SymbolicName,
			Version:  bundle.Version.String(),
			Class:    bundle.Activator,
			Policy:   bundle.ActivationPolicy,
			Lazy:     bundle.LazyActivation,
			Location: relativeOrAbsolute(ws.Root, proj.Dir),
		}
		if info.Policy == "" {
			info.Policy = "eager"
		}
		if source := activatorSource(proj, bundle.Activator); source != "" {
			info.File = relativeOrAbsolute(ws.Root, source)
			info.FileExists = true
			info.StartLine, info.StopLine = activatorLines(source)
		}
		out = append(out, info)
	}
	return out
}

// activatorSource resolves a class name to its .java file inside the bundle: the
// package becomes folders under the first source folder that contains it. A class
// inside a Bundle-ClassPath jar has no source here.
func activatorSource(proj *EclipseProject, class string) string {
	relative := filepath.FromSlash(strings.ReplaceAll(class, ".", "/")) + ".java"
	for _, folder := range sourceRootsOf(proj) {
		path := filepath.Join(folder, relative)
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path
		}
	}
	return ""
}

// sourceRootsOf is every folder that may hold the sources of a bundle: the .classpath
// source entries, build.properties source.., and the PDE conventions (src, the bundle
// root). A project without .classpath still has its sources in src/.
func sourceRootsOf(proj *EclipseProject) []string {
	candidates := append([]string{}, proj.sourceFolders()...)
	candidates = append(candidates, filepath.Join(proj.Dir, "src"), proj.Dir)
	seen := map[string]bool{}
	roots := make([]string, 0, len(candidates))
	for _, folder := range candidates {
		if folder == "" || seen[folder] {
			continue
		}
		seen[folder] = true
		roots = append(roots, folder)
	}
	return roots
}

// activatorLines finds the declaration lines of start(BundleContext) and
// stop(BundleContext). ok is implied by a non-zero line.
func activatorLines(path string) (start, stop int) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, 0
	}
	for index, line := range strings.Split(string(data), "\n") {
		if start == 0 && activatorStartMethod.MatchString(line) {
			start = index + 1
		}
		if stop == 0 && activatorStopMethod.MatchString(line) {
			stop = index + 1
		}
		if start != 0 && stop != 0 {
			break
		}
	}
	return start, stop
}

// relativeOrAbsolute keeps paths inside the project shareable and readable.
func relativeOrAbsolute(root, path string) string {
	if rel, ok := relativeWithin(root, path); ok {
		return rel
	}
	return path
}
