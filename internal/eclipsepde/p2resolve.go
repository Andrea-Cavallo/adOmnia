package eclipsepde

import (
	"fmt"
	"runtime"
	"sort"
	"strings"
)

// p2Catalog indexes the units of the repositories of one location.
type p2Catalog struct {
	byID       map[string][]*p2IU
	byProvided map[string][]*p2IU
}

func newP2Catalog(units []*p2IU) *p2Catalog {
	catalog := &p2Catalog{byID: map[string][]*p2IU{}, byProvided: map[string][]*p2IU{}}
	for _, unit := range units {
		catalog.byID[unit.ID] = append(catalog.byID[unit.ID], unit)
		for _, capability := range unit.Provides {
			key := capability.Namespace + "\x00" + capability.Name
			catalog.byProvided[key] = append(catalog.byProvided[key], unit)
		}
	}
	return catalog
}

// root finds a unit listed in the .target: the exact version, or the newest for "0.0.0".
func (c *p2Catalog) root(unit P2Unit, env map[string]string) (*p2IU, error) {
	wanted := strings.TrimSpace(unit.Version)
	var best *p2IU
	for _, candidate := range c.byID[unit.ID] {
		if !candidate.Filter.matches(env) {
			continue
		}
		if wanted != "" && wanted != "0.0.0" {
			if v, err := ParseVersion(wanted); err == nil && candidate.Version.Compare(v) == 0 {
				return candidate, nil
			}
			continue
		}
		if best == nil || candidate.Version.Compare(best.Version) > 0 {
			best = candidate
		}
	}
	if best == nil {
		return nil, fmt.Errorf("%s %s is not in the repositories", unit.ID, orNewest(wanted))
	}
	return best, nil
}

func orNewest(version string) string {
	if version == "" || version == "0.0.0" {
		return "(newest)"
	}
	return version
}

// provider is the newest unit offering the capability within the range.
func (c *p2Catalog) provider(requirement p2Requirement, env map[string]string) *p2IU {
	var best *p2IU
	var bestVersion Version
	for _, candidate := range c.byProvided[requirement.Namespace+"\x00"+requirement.Name] {
		if !candidate.Filter.matches(env) {
			continue
		}
		for _, capability := range candidate.Provides {
			if capability.Namespace != requirement.Namespace || capability.Name != requirement.Name || !requirement.Range.Match(capability.Version) {
				continue
			}
			if best == nil || capability.Version.Compare(bestVersion) > 0 {
				best, bestVersion = candidate, capability.Version
			}
		}
	}
	return best
}

// p2Plan is the outcome of resolving one location: the bundle artifacts to
// fetch and why something could not be included.
type p2Plan struct {
	Bundles  []p2ArtifactKey
	Problems []string
}

// resolveP2Location follows PDE's two include modes. "slicer" takes the listed
// units and what they include exactly (strict `[v,v]` requirements: feature
// contents). "planner" (the default, "include required software") also takes
// every non-optional requirement, and optional greedy ones when available,
// choosing the newest provider. With includeAllPlatforms every filter passes.
func resolveP2Location(catalog *p2Catalog, location P2Location) p2Plan {
	env := p2Environment(location.IncludeAllPlatforms)
	planner := location.IncludeMode != "slicer"
	plan := p2Plan{}
	selected := map[*p2IU]bool{}
	var queue []*p2IU
	add := func(unit *p2IU) {
		if !selected[unit] {
			selected[unit] = true
			queue = append(queue, unit)
		}
	}
	for _, unit := range location.Units {
		found, err := catalog.root(unit, env)
		if err != nil {
			plan.Problems = append(plan.Problems, err.Error())
			continue
		}
		add(found)
	}
	missing := map[string]bool{}
	for len(queue) > 0 {
		unit := queue[0]
		queue = queue[1:]
		for _, requirement := range unit.Requires {
			if !followRequirement(requirement, planner, env) {
				continue
			}
			if provider := catalog.provider(requirement, env); provider != nil {
				add(provider)
				continue
			}
			if requirement.Optional || (requirement.Namespace == p2NamespacePackage && providedByJRE(requirement.Name)) {
				continue
			}
			message := fmt.Sprintf("%s requires %s %s %s, which the repositories do not provide", unit.ID, requirement.Namespace, requirement.Name, requirement.Range)
			if !missing[message] {
				missing[message] = true
				plan.Problems = append(plan.Problems, message)
			}
		}
	}
	if location.IncludeSource {
		for unit := range selected {
			for _, source := range catalog.byID[unit.ID+".source"] {
				if source.Version.Compare(unit.Version) == 0 {
					selected[source] = true
				}
			}
		}
	}
	plan.Bundles = bundleArtifacts(selected)
	sort.Strings(plan.Problems)
	return plan
}

func followRequirement(requirement p2Requirement, planner bool, env map[string]string) bool {
	if !requirement.Filter.matches(env) {
		return false
	}
	if !planner {
		return !requirement.Optional && requirement.strict()
	}
	return !requirement.Optional || requirement.Greedy
}

func bundleArtifacts(selected map[*p2IU]bool) []p2ArtifactKey {
	var bundles []p2ArtifactKey
	for unit := range selected {
		for _, artifact := range unit.Artifacts {
			if artifact.Classifier == p2ClassifierBundle {
				bundles = append(bundles, artifact)
			}
		}
	}
	sort.Slice(bundles, func(i, j int) bool {
		if bundles[i].ID != bundles[j].ID {
			return bundles[i].ID < bundles[j].ID
		}
		return bundles[i].Version < bundles[j].Version
	})
	return bundles
}

// p2Environment is the platform p2 filters are evaluated against: this machine,
// as PDE does for a target without explicit environment. A nil map with
// includeAllPlatforms makes every filter pass.
func p2Environment(allPlatforms bool) map[string]string {
	if allPlatforms {
		return nil
	}
	osName, ws := runtime.GOOS, ""
	switch runtime.GOOS {
	case "darwin":
		osName, ws = "macosx", "cocoa"
	case "windows":
		osName, ws = "win32", "win32"
	default:
		ws = "gtk"
	}
	arch := runtime.GOARCH
	switch arch {
	case "amd64":
		arch = "x86_64"
	case "arm64":
		arch = "aarch64"
	case "386":
		arch = "x86"
	}
	return map[string]string{"osgi.os": osName, "osgi.ws": ws, "osgi.arch": arch, "osgi.nl": "en_US", "org.eclipse.update.install.features": "true"}
}
