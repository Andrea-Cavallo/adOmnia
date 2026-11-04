package eclipsepde

import (
	"fmt"
	"sort"
)

// BundleVersion is one bundle of a target platform: its symbolic name, the highest
// version found and every version/location the target contains (the same bundle can
// appear twice in a badly built target).
type BundleVersion struct {
	SymbolicName string   `json:"symbolicName"`
	Version      string   `json:"version"`
	Versions     []string `json:"versions"`
	Locations    []string `json:"locations"`
}

// BundleChange is a bundle present in both targets at different versions.
type BundleChange struct {
	SymbolicName string `json:"symbolicName"`
	Left         string `json:"left"`
	Right        string `json:"right"`
}

// TargetComparison is the diff of two target platforms: what a migration adds, removes
// and bumps. This is the Target Platform Manager answer to "will this new target still
// compile my workspace?".
type TargetComparison struct {
	Left         string          `json:"left"`
	Right        string          `json:"right"`
	LeftBundles  int             `json:"leftBundles"`
	RightBundles int             `json:"rightBundles"`
	Common       int             `json:"common"`
	Added        []BundleVersion `json:"added"`
	Removed      []BundleVersion `json:"removed"`
	Changed      []BundleChange  `json:"changed"`
	Problems     []Problem       `json:"problems"`
}

// CompareTargets indexes two target platforms (a folder of bundles, an Eclipse install or
// a `.target` definition) and diffs their bundles by symbolic name. Read-only: neither
// target is modified, and no cached index is touched.
func CompareTargets(left, right string) (*TargetComparison, error) {
	leftIndex, err := indexTargetPath(left)
	if err != nil {
		return nil, fmt.Errorf("left target: %w", err)
	}
	rightIndex, err := indexTargetPath(right)
	if err != nil {
		return nil, fmt.Errorf("right target: %w", err)
	}
	comparison := &TargetComparison{
		Left: left, Right: right,
		LeftBundles: len(leftIndex.All()), RightBundles: len(rightIndex.All()),
		Added: []BundleVersion{}, Removed: []BundleVersion{}, Changed: []BundleChange{},
		Problems: []Problem{},
	}
	leftVersions := bundleVersions(leftIndex)
	rightVersions := bundleVersions(rightIndex)
	for name, leftBundle := range leftVersions {
		rightBundle, ok := rightVersions[name]
		if !ok {
			comparison.Removed = append(comparison.Removed, leftBundle)
			continue
		}
		comparison.Common++
		if leftBundle.Version != rightBundle.Version {
			comparison.Changed = append(comparison.Changed, BundleChange{SymbolicName: name, Left: leftBundle.Version, Right: rightBundle.Version})
		}
	}
	for name, rightBundle := range rightVersions {
		if _, ok := leftVersions[name]; !ok {
			comparison.Added = append(comparison.Added, rightBundle)
		}
	}
	sort.SliceStable(comparison.Added, func(i, j int) bool { return comparison.Added[i].SymbolicName < comparison.Added[j].SymbolicName })
	sort.SliceStable(comparison.Removed, func(i, j int) bool { return comparison.Removed[i].SymbolicName < comparison.Removed[j].SymbolicName })
	sort.SliceStable(comparison.Changed, func(i, j int) bool { return comparison.Changed[i].SymbolicName < comparison.Changed[j].SymbolicName })
	for _, problem := range leftIndex.Problems {
		comparison.Problems = append(comparison.Problems, Problem{Severity: problem.Severity, File: problem.File, Message: "left target: " + problem.Message})
	}
	for _, problem := range rightIndex.Problems {
		comparison.Problems = append(comparison.Problems, Problem{Severity: problem.Severity, File: problem.File, Message: "right target: " + problem.Message})
	}
	return comparison, nil
}

// indexTargetPath indexes one target path without the process-wide cache: comparing must
// reflect the files on disk now, not the index of the active target.
func indexTargetPath(path string) (*BundleIndex, error) {
	kind, err := targetKindOf(path)
	if err != nil {
		return nil, err
	}
	return indexProfile(TargetProfile{Name: "comparison", Kind: kind, Path: path})
}

// bundleVersions groups the index by symbolic name, keeping every version and location.
func bundleVersions(index *BundleIndex) map[string]BundleVersion {
	byName := map[string]BundleVersion{}
	seenVersion := map[string]map[string]bool{}
	for _, entry := range index.All() {
		name := entry.Bundle.SymbolicName
		version := entry.Bundle.Version.String()
		group, ok := byName[name]
		if !ok {
			group = BundleVersion{SymbolicName: name, Versions: []string{}, Locations: []string{}}
			seenVersion[name] = map[string]bool{}
		}
		if !seenVersion[name][version] {
			seenVersion[name][version] = true
			group.Versions = append(group.Versions, version)
			group.Locations = append(group.Locations, entry.Bundle.Location)
		}
		group.Version = highestVersionString(group.Version, version)
		byName[name] = group
	}
	for name, group := range byName {
		sort.Strings(group.Versions)
		sort.Strings(group.Locations)
		byName[name] = group
	}
	return byName
}

// highestVersionString picks the greater OSGi version, tolerating unparsable values.
func highestVersionString(current, candidate string) string {
	if current == "" {
		return candidate
	}
	left, leftErr := ParseVersion(current)
	right, rightErr := ParseVersion(candidate)
	if leftErr != nil || rightErr != nil {
		if candidate > current {
			return candidate
		}
		return current
	}
	if right.Compare(left) > 0 {
		return candidate
	}
	return current
}
