package eclipsepde

import (
	"fmt"
	"os"
	"sort"
)

// TargetSourceKind is where a target platform's bundles come from (spec
// section 7, "Sorgenti da supportare").
type TargetSourceKind string

const (
	// TargetLocalDirectory is the confirmed main use case: a custom directory
	// of OSGi bundles/jars.
	TargetLocalDirectory TargetSourceKind = "local-directory"
	// TargetEclipseDefinition is an Eclipse .target file (parsed in a later
	// phase; accepted here for registration).
	TargetEclipseDefinition TargetSourceKind = "eclipse-target-file"
	// TargetEclipseInstall is an existing Eclipse installation's plugins dir.
	TargetEclipseInstall TargetSourceKind = "eclipse-install"
)

// TargetProfile is one registered target platform. Section 7 requires multiple
// named targets with origin, path and environment, reproducibly storable
// without copying the jars.
type TargetProfile struct {
	Name string
	Kind TargetSourceKind
	Path string
	// ExecutionEnvironment is the expected EE, e.g. "JavaSE-1.6".
	ExecutionEnvironment string
	// Offline records that the target must work without network access.
	Offline bool
}

// TargetPlatform manages the registered profiles and the active one (section 7
// operations: Set Active / Add / Remove / Reindex / Validate / Resolve).
type TargetPlatform struct {
	Profiles []TargetProfile
	// Active is the name of the active profile ("" = none).
	Active string
	// index caches the bundles of the active profile until Reindex.
	index *BundleIndex
}

// NewTargetPlatform returns an empty manager.
func NewTargetPlatform() *TargetPlatform {
	return &TargetPlatform{}
}

// Add registers a profile; names must be unique.
func (tp *TargetPlatform) Add(p TargetProfile) error {
	if p.Name == "" {
		return fmt.Errorf("target profile needs a name")
	}
	for _, existing := range tp.Profiles {
		if existing.Name == p.Name {
			return fmt.Errorf("target profile %q already exists", p.Name)
		}
	}
	tp.Profiles = append(tp.Profiles, p)
	tp.index = nil
	return nil
}

// Remove unregisters a profile by name; it clears Active when it was active.
func (tp *TargetPlatform) Remove(name string) error {
	for i, p := range tp.Profiles {
		if p.Name != name {
			continue
		}
		tp.Profiles = append(tp.Profiles[:i], tp.Profiles[i+1:]...)
		if tp.Active == name {
			tp.Active = ""
		}
		tp.index = nil
		return nil
	}
	return fmt.Errorf("target profile %q not found", name)
}

// SetActive marks a profile active and drops the cached index.
func (tp *TargetPlatform) SetActive(name string) error {
	for _, p := range tp.Profiles {
		if p.Name == name {
			tp.Active = name
			tp.index = nil
			return nil
		}
	}
	return fmt.Errorf("target profile %q not found", name)
}

// ActiveProfile returns the active profile, if any.
func (tp *TargetPlatform) ActiveProfile() (TargetProfile, bool) {
	for _, p := range tp.Profiles {
		if p.Name == tp.Active {
			return p, true
		}
	}
	return TargetProfile{}, false
}

// Index returns the bundle index of the active profile, indexing it on first
// use. Subsequent calls return the cache; call Reindex after the target changes.
func (tp *TargetPlatform) Index() (*BundleIndex, error) {
	if tp.index != nil {
		return tp.index, nil
	}
	profile, ok := tp.ActiveProfile()
	if !ok {
		return nil, fmt.Errorf("no active target platform")
	}
	idx := NewBundleIndex()
	if err := idx.IndexTargetDirectory(profile.Path); err != nil {
		return nil, err
	}
	tp.index = idx
	return idx, nil
}

// Reindex drops the cache and indexes the active target again.
func (tp *TargetPlatform) Reindex() (*BundleIndex, error) {
	tp.index = nil
	return tp.Index()
}

// ValidationResult is the outcome of Validate: profile problems plus index
// statistics and conflicts (section 7: "Segnalare duplicati e conflitti di
// versione", "Validare file mancanti, manifest malformati").
type ValidationResult struct {
	Problems []Problem
	// BundlesIndexed, WorkspaceBundles and Unresolved are the statistics shown
	// in the target platform layout of section 7.
	BundlesIndexed   int
	WorkspaceBundles int
	Unresolved       int
	// ExactDuplicates lists names indexed more than once at the same version.
	ExactDuplicates map[string][]string
	// MultiVersion lists names indexed at several versions.
	MultiVersion map[string][]string
}

// Validate checks the active target and, optionally, a workspace against it:
// unreadable paths, malformed manifests, duplicate bundles and unresolved
// workspace bundles.
func (tp *TargetPlatform) Validate(ws *Workspace) (*ValidationResult, error) {
	result := &ValidationResult{ExactDuplicates: map[string][]string{}, MultiVersion: map[string][]string{}}

	profile, ok := tp.ActiveProfile()
	if !ok {
		return nil, fmt.Errorf("no active target platform")
	}
	if !fileExists(profile.Path) {
		result.Problems = append(result.Problems, Problem{
			Severity: "error", File: profile.Path,
			Message: fmt.Sprintf("target platform path of %q does not exist", profile.Name),
		})
		return result, nil
	}

	idx, err := tp.Index()
	if err != nil {
		return nil, err
	}
	result.BundlesIndexed = len(idx.All())
	result.Problems = append(result.Problems, idx.Problems...)
	result.ExactDuplicates, result.MultiVersion = idx.Duplicates()
	for name, locations := range result.ExactDuplicates {
		result.Problems = append(result.Problems, Problem{
			Severity: "warning",
			Message:  fmt.Sprintf("bundle %s is present %d times in the target (%v): PDE will pick one", name, len(locations), locations),
		})
	}

	if ws != nil {
		result.WorkspaceBundles = len(ws.Bundles())
		resolver := NewResolver(idx)
		for _, res := range resolver.StatusOf(ws.Projects) {
			if res.Status == StatusUnresolved {
				result.Unresolved++
				for _, missing := range res.Missing {
					result.Problems = append(result.Problems, Problem{
						Severity: "error", Project: res.Bundle.Bundle.SymbolicName,
						Message: fmt.Sprintf("unresolved: %s (available: %s)", missing.Requirement.String(), joinOrNone(missing.Available)),
					})
				}
			}
		}
	}
	sort.SliceStable(result.Problems, func(i, j int) bool { return result.Problems[i].Message < result.Problems[j].Message })
	return result, nil
}

// String renders the statistics block of the section 7 layout.
func (v *ValidationResult) String() string {
	return fmt.Sprintf("[Bundles indexed] %d  [Workspace bundles] %d  [Unresolved] %d",
		v.BundlesIndexed, v.WorkspaceBundles, v.Unresolved)
}

// IsUsable reports whether the profile path exists and is a directory.
func (p TargetProfile) IsUsable() bool {
	info, err := os.Stat(p.Path)
	return err == nil && info.IsDir()
}
