package eclipsepde

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
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
	for _, entry := range slices.Backward(entries) {
		if !rOK || r.Match(entry.Bundle.Version) {
			return entry, candidates, true
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
			out = append(out, Provider{Entry: e, ExportVersion: version, Clause: clause})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].ExportVersion.Compare(out[j].ExportVersion) < 0
	})
	return out
}

// fragmentsOf lists the fragments attached to host, for every platform.
func (idx *BundleIndex) fragmentsOf(host *IndexedBundle) []*IndexedBundle {
	var fragments []*IndexedBundle
	for _, entry := range idx.all {
		clause := entry.Bundle.FragmentHost
		if clause == nil || clause.Name != host.Bundle.SymbolicName {
			continue
		}
		if rng, ok, err := clause.VersionRangeOf("bundle-version"); err != nil || !ok || rng.Match(host.Bundle.Version) {
			fragments = append(fragments, entry)
		}
	}
	return fragments
}

// RuntimeFragmentsOf lists the fragments of host that can load on this platform.
// otherPlatforms is true when host has fragments but none for this platform: a host such
// as org.eclipse.swt then has no classes at all (a 32-bit Eclipse with a 64-bit JVM).
func (idx *BundleIndex) RuntimeFragmentsOf(host *IndexedBundle, platform map[string]string) (fragments []*IndexedBundle, otherPlatforms bool) {
	all := idx.fragmentsOf(host)
	for _, entry := range all {
		if entry.Bundle.MatchesPlatform(platform) {
			fragments = append(fragments, entry)
		}
	}
	return fragments, len(fragments) == 0 && len(all) > 0
}

// CompileFragmentsOf lists the fragments to compile against. Without one for this machine any
// platform will do: the classes have the same API, and a target is often for another architecture.
func (idx *BundleIndex) CompileFragmentsOf(host *IndexedBundle) []*IndexedBundle {
	fragments, otherPlatforms := idx.RuntimeFragmentsOf(host, p2Environment(false))
	if otherPlatforms {
		return idx.fragmentsOf(host)[:1]
	}
	return fragments
}

// Provider is one Export-Package match from the index.
type Provider struct {
	Entry         *IndexedBundle
	ExportVersion Version
	// Clause is the Export-Package clause, for attribute matching.
	Clause Clause
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

// targetEntry is one bundle of a target platform directory, before its manifest
// is parsed: either a jar or an exploded folder.
type targetEntry struct {
	path     string
	exploded bool
}

// IndexTargetDirectory indexes a Custom Target Platform given as a local
// directory (spec section 7, source #1: the confirmed use case). Both JARs and
// exploded bundle directories are indexed. Nothing is copied or modified.
//
// The walk stays serial (it decides what is a bundle), then the manifests are
// read in parallel and added in the original order: a real Eclipse install is
// about a thousand jars, and opening them one by one is what made the first
// index of a target look like a freeze.
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
	var entries []targetEntry
	if err := filepath.WalkDir(abs, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			idx.Problems = append(idx.Problems, Problem{
				Severity: "warning", File: path,
				Message: "target entry is not readable: " + err.Error(),
			})
			return nil
		}
		if d.IsDir() {
			// An installed Eclipse feature also has a manifest, but it is not a bundle.
			if fileExists(filepath.Join(path, "feature.xml")) {
				return filepath.SkipDir
			}
			if fileExists(filepath.Join(path, "META-INF", "MANIFEST.MF")) {
				entries = append(entries, targetEntry{path: path, exploded: true})
				return filepath.SkipDir // nested bundles are separate entries
			}
			return nil
		}
		if strings.EqualFold(filepath.Ext(path), ".jar") {
			entries = append(entries, targetEntry{path: path})
		}
		return nil
	}); err != nil {
		return err
	}
	idx.indexEntries(entries)
	return nil
}

// indexEntries parses the manifests of entries in parallel and adds them in the
// same order the walk produced them, so the index and its problems do not depend
// on which worker finished first.
func (idx *BundleIndex) indexEntries(entries []targetEntry) {
	if len(entries) == 0 {
		return
	}
	workers := min(runtime.GOMAXPROCS(0), maxIndexWorkers, len(entries))
	type parsed struct {
		bundle  *IndexedBundle
		problem *Problem
	}
	results := make([]parsed, len(entries))
	jobs := make(chan int)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				bundle, problem := parseTargetEntry(entries[index])
				results[index] = parsed{bundle: bundle, problem: problem}
			}
		}()
	}
	for index := range entries {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	for _, result := range results {
		idx.addParsed(result.bundle, result.problem)
	}
}

func (idx *BundleIndex) addParsed(bundle *IndexedBundle, problem *Problem) {
	if problem != nil {
		idx.Problems = append(idx.Problems, *problem)
		return
	}
	if bundle != nil {
		idx.Add(bundle)
	}
}

// maxIndexWorkers bounds the parallel manifest reads: enough to hide the disk and
// antivirus latency, small enough not to fight the rest of the app for I/O.
const maxIndexWorkers = 8

// parseTargetEntry reads one entry without touching the index, so it is safe to
// call from several goroutines at once.
func parseTargetEntry(entry targetEntry) (*IndexedBundle, *Problem) {
	if entry.exploded {
		raw, err := os.ReadFile(filepath.Join(entry.path, "META-INF", "MANIFEST.MF"))
		if err != nil {
			return nil, &Problem{Severity: "warning", File: entry.path, Message: "exploded bundle manifest is not readable: " + err.Error()}
		}
		bundle, err := ParseBundle(raw, entry.path)
		if err != nil {
			return nil, &Problem{Severity: "warning", File: entry.path, Message: "exploded bundle manifest is not a valid bundle: " + err.Error()}
		}
		return &IndexedBundle{Bundle: bundle, Source: SourceTarget, Exploded: true}, nil
	}
	raw, err := readJarManifest(entry.path)
	if err != nil {
		return nil, &Problem{Severity: "warning", File: entry.path, Message: "jar has no readable manifest: " + err.Error()}
	}
	bundle, err := ParseBundle(raw, entry.path)
	if err != nil {
		return nil, &Problem{Severity: "warning", File: entry.path, Message: "jar manifest is not a valid bundle: " + err.Error()}
	}
	return &IndexedBundle{Bundle: bundle, Source: SourceTarget}, nil
}

func (idx *BundleIndex) indexJarBundle(jarPath string) {
	idx.addParsed(parseTargetEntry(targetEntry{path: jarPath}))
}

func (idx *BundleIndex) indexExplodedBundle(dir string) {
	idx.addParsed(parseTargetEntry(targetEntry{path: dir, exploded: true}))
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
