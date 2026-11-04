package eclipsepde

import (
	"fmt"
	"os"
	"path/filepath"
)

// ManifestResolution is the answer to "does this manifest resolve against the active target,
// and if not, why": the same diagnostic resolver the IDE uses, exposed without a project
// session so agents and tools can ask it directly.
type ManifestResolution struct {
	SymbolicName string              `json:"symbolicName"`
	Version      string              `json:"version"`
	Status       ResolutionStatus    `json:"status"`
	HasTarget    bool                `json:"hasTarget"`
	TargetPath   string              `json:"targetPath,omitempty"`
	Wires        []Wire              `json:"wires"`
	Missing      []MissingDependency `json:"missing"`
	Notes        []string            `json:"notes"`
	Problems     []Problem           `json:"problems"`
}

// ResolveManifest resolves one MANIFEST.MF text against the target platform of the project
// at root. jvmMajor is the Java version the project runs on (0 when unknown): it decides
// whether Bundle-RequiredExecutionEnvironment is satisfied.
func ResolveManifest(root string, manifest []byte, jvmMajor int) (*ManifestResolution, error) {
	ws, err := ImportWorkspace(root)
	if err != nil {
		return nil, err
	}
	bundle, err := ParseBundle(manifest, "manifest")
	if err != nil {
		return nil, err
	}
	resolution := &ManifestResolution{
		SymbolicName: bundle.SymbolicName,
		Version:      bundle.Version.String(),
		Wires:        []Wire{},
		Missing:      []MissingDependency{},
		Notes:        []string{},
		Problems:     []Problem{},
	}
	settings, err := LoadTargetSettings(ws.Root)
	if err != nil {
		return nil, err
	}
	platform := NewTargetPlatform()
	platform.LoadFromSettings(absoluteProfiles(settings, ws.Root))
	executionEnvironment := ""
	profile, hasTarget := platform.ActiveProfile()
	if !hasTarget {
		resolution.Problems = append(resolution.Problems, Problem{
			Severity: "warning",
			Message:  "no target platform is set: only the workspace bundles are considered, and the manifest is not resolved",
		})
		return resolution, nil
	}
	resolution.HasTarget, resolution.TargetPath = true, profile.Path
	executionEnvironment = profile.ExecutionEnvironment
	index, err := platform.Index()
	if err != nil {
		return nil, err
	}
	merged := withWorkspace(index, ws)
	resolver := NewResolver(merged)
	if jvmMajor > 0 {
		resolver.ExecutionEnvironment = javaExecutionEnvironment(jvmMajor)
	} else {
		resolver.ExecutionEnvironment = executionEnvironment
	}
	entry := &IndexedBundle{Bundle: bundle, Source: SourceWorkspace, Exploded: true}
	outcome := resolver.Resolve(entry)
	resolution.Status = outcome.Root.Status
	resolution.Wires = append(resolution.Wires, outcome.Root.Wires...)
	resolution.Notes = append(resolution.Notes, outcome.Root.Notes...)
	for _, missing := range outcome.Root.Missing {
		resolution.Missing = append(resolution.Missing, missingDependency(missing))
	}
	for _, problem := range index.Problems {
		resolution.Problems = append(resolution.Problems, problem)
	}
	return resolution, nil
}

// ResolveManifestFile reads one bundle manifest (a file or a bundle directory) and resolves
// it. A directory is looked up as <dir>/META-INF/MANIFEST.MF, a jar path is read from the
// archive.
func ResolveManifestFile(root, path string, jvmMajor int) (*ManifestResolution, error) {
	absolute := path
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Join(root, filepath.FromSlash(path))
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return nil, fmt.Errorf("manifest not found: %s", path)
	}
	var raw []byte
	switch {
	case info.IsDir():
		raw, err = os.ReadFile(filepath.Join(absolute, "META-INF", "MANIFEST.MF"))
	case filepath.Ext(absolute) == ".jar":
		raw, err = readJarManifest(absolute)
	default:
		raw, err = os.ReadFile(absolute)
	}
	if err != nil {
		return nil, err
	}
	return ResolveManifest(root, raw, jvmMajor)
}
