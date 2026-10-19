package eclipsepde

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// BundleSource says where an indexed bundle comes from.
type BundleSource string

const (
	// SourceTarget marks bundles indexed from the target platform.
	SourceTarget BundleSource = "target"
	// SourceWorkspace marks bundles that are workspace projects.
	SourceWorkspace BundleSource = "workspace"
)

// IndexedBundle is one bundle known to the index: its metadata plus where it
// came from. Exploded bundles are directories with a META-INF/MANIFEST.MF.
type IndexedBundle struct {
	Bundle *Bundle
	Source BundleSource
	// Exploded is true when the bundle is an unpacked directory, not a JAR.
	Exploded bool
}

// BundleIndex indexes the bundles of a target platform and the workspace, and
// answers the resolver's lookups. It is a cache: rebuild it with Reindex after
// the target or the manifests change (spec section 7 "Reindex / Validate").
type BundleIndex struct {
	// byName maps Bundle-SymbolicName to all its indexed versions.
	byName map[string][]*IndexedBundle
	// all preserves insertion order for stable listings.
	all []*IndexedBundle
	// Problems collects index-time issues (unreadable jars, malformed manifests).
	Problems []Problem
}

// NewBundleIndex returns an empty index.
func NewBundleIndex() *BundleIndex {
	return &BundleIndex{byName: map[string][]*IndexedBundle{}}
}

// Add indexes one bundle. Duplicates (same symbolic name and version from
// different locations) are kept and reported through Duplicates().
func (idx *BundleIndex) Add(entry *IndexedBundle) {
	idx.all = append(idx.all, entry)
	idx.byName[entry.Bundle.SymbolicName] = append(idx.byName[entry.Bundle.SymbolicName], entry)
}

// All returns every indexed bundle in insertion order.
func (idx *BundleIndex) All() []*IndexedBundle { return idx.all }

// ByName returns all indexed versions of a symbolic name (sorted by version).
func (idx *BundleIndex) ByName(name string) []*IndexedBundle {
	entries := append([]*IndexedBundle{}, idx.byName[name]...)
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Bundle.Version.Compare(entries[j].Bundle.Version) < 0
	})
	return entries
}

// BestMatch picks the highest version of name satisfying the range. ok is
// false when nothing matches; candidates lists the available versions to power
// "Explain Dependency" diagnostics.
func (idx *BundleIndex) BestMatch(name string, r VersionRange, rOK bool) (entry *IndexedBundle, candidates []string, ok bool) {
	entries := idx.ByName(name)
	for _, e := range entries {
		candidates = append(candidates, e.Bundle.Version.String())
	}
	for i := len(entries) - 1; i >= 0; i-- {
		if !rOK || r.Match(entries[i].Bundle.Version) {
			return entries[i], candidates, true
		}
	}
	return nil, candidates, false
}

// ProvidersOf lists every bundle exporting the given package, newest first.
// The returned entries carry the export version in ExportVersion.
func (idx *BundleIndex) ProvidersOf(pkg string) []Provider {
	var out []Provider
	for _, e := range idx.all {
		for _, clause := range e.Bundle.ExportPackage {
			if clause.Name != pkg {
				continue
			}
			version := Version{}
			if v, ok, err := clause.VersionRangeOf("version"); err == nil && ok {
				version = v.Floor
			}
			out = append(out, Provider{Entry: e, ExportVersion: version})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].ExportVersion.Compare(out[j].ExportVersion) < 0
	})
	return out
}

// Provider is one Export-Package match from the index.
type Provider struct {
	Entry         *IndexedBundle
	ExportVersion Version
}

// Duplicates returns symbolic names indexed more than once at the same version
// (a real PDE conflict) and names with more than one version (a warning).
func (idx *BundleIndex) Duplicates() (exact map[string][]string, multiVersion map[string][]string) {
	exact = map[string][]string{}
	multiVersion = map[string][]string{}
	for name, entries := range idx.byName {
		seenVersion := map[string][]string{}
		for _, e := range entries {
			v := e.Bundle.Version.String()
			seenVersion[v] = append(seenVersion[v], e.Bundle.Location)
		}
		for v, locations := range seenVersion {
			if len(locations) > 1 {
				exact[name+"_"+v] = locations
			}
		}
		if len(entries) > 1 {
			for _, e := range entries {
				multiVersion[name] = append(multiVersion[name], e.Bundle.Version.String())
			}
		}
	}
	return exact, multiVersion
}

// IndexTargetDirectory indexes a Custom Target Platform given as a local
// directory (spec section 7, source #1: the confirmed use case). Both JARs and
// exploded bundle directories are indexed. Nothing is copied or modified.
func (idx *BundleIndex) IndexTargetDirectory(root string) error {
	abs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("target platform %s: not a directory", abs)
	}
	return filepath.WalkDir(abs, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			idx.Problems = append(idx.Problems, Problem{
				Severity: "warning", File: path,
				Message: "target entry is not readable: " + err.Error(),
			})
			return nil
		}
		if d.IsDir() {
			if fileExists(filepath.Join(path, "META-INF", "MANIFEST.MF")) {
				idx.indexExplodedBundle(path)
				return filepath.SkipDir // nested bundles are separate entries
			}
			return nil
		}
		if strings.EqualFold(filepath.Ext(path), ".jar") {
			idx.indexJarBundle(path)
		}
		return nil
	})
}

func (idx *BundleIndex) indexJarBundle(jarPath string) {
	raw, err := readJarManifest(jarPath)
	if err != nil {
		idx.Problems = append(idx.Problems, Problem{
			Severity: "warning", File: jarPath,
			Message: "jar has no readable manifest: " + err.Error(),
		})
		return
	}
	bundle, err := ParseBundle(raw, jarPath)
	if err != nil {
		idx.Problems = append(idx.Problems, Problem{
			Severity: "warning", File: jarPath,
			Message: "jar manifest is not a valid bundle: " + err.Error(),
		})
		return
	}
	idx.Add(&IndexedBundle{Bundle: bundle, Source: SourceTarget})
}

func (idx *BundleIndex) indexExplodedBundle(dir string) {
	raw, err := os.ReadFile(filepath.Join(dir, "META-INF", "MANIFEST.MF"))
	if err != nil {
		idx.Problems = append(idx.Problems, Problem{
			Severity: "warning", File: dir,
			Message: "exploded bundle manifest is not readable: " + err.Error(),
		})
		return
	}
	bundle, err := ParseBundle(raw, dir)
	if err != nil {
		idx.Problems = append(idx.Problems, Problem{
			Severity: "warning", File: dir,
			Message: "exploded bundle manifest is not a valid bundle: " + err.Error(),
		})
		return
	}
	idx.Add(&IndexedBundle{Bundle: bundle, Source: SourceTarget, Exploded: true})
}

// readJarManifest extracts META-INF/MANIFEST.MF from a jar without unpacking it.
func readJarManifest(jarPath string) ([]byte, error) {
	reader, err := zip.OpenReader(jarPath)
	if err != nil {
		return nil, err
	}
	defer func() { _ = reader.Close() }()
	for _, f := range reader.File {
		if strings.EqualFold(f.Name, "META-INF/MANIFEST.MF") {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer func() { _ = rc.Close() }()
			return io.ReadAll(rc)
		}
	}
	return nil, fmt.Errorf("META-INF/MANIFEST.MF not found")
}

// AddWorkspaceProject indexes a workspace project that is a bundle.
func (idx *BundleIndex) AddWorkspaceProject(proj *EclipseProject) {
	if proj.Bundle == nil {
		return
	}
	idx.Add(&IndexedBundle{Bundle: proj.Bundle, Source: SourceWorkspace, Exploded: true})
}
