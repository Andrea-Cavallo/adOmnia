package eclipsepde

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// Consumer is one bundle that depends on the analyzed bundle, directly or transitively.
// It answers "what breaks if I change this bundle?" with the requirement that would
// break, not just a name.
type Consumer struct {
	SymbolicName string `json:"symbolicName"`
	Version      string `json:"version"`
	Source       string `json:"source"`
	// Kind is Require-Bundle, Import-Package or Fragment-Host.
	Kind string `json:"kind"`
	// Requirement is the rendered clause (name + version range).
	Requirement string `json:"requirement"`
	// Optional marks resolution:=optional: it would degrade, not fail.
	Optional bool `json:"optional,omitempty"`
	// Package is the imported package, for Import-Package edges.
	Package string `json:"package,omitempty"`
	// Distance is 1 for a direct consumer, 2+ for transitive ones.
	Distance int `json:"distance"`
	// Services are the service interfaces of the analyzed bundle this consumer uses,
	// when its Declarative Services descriptor references one of them.
	Services []string `json:"services,omitempty"`
	// Test marks the consumer as a test bundle.
	Test bool `json:"test,omitempty"`
}

// TestImpact is a test project affected by a change.
type TestImpact struct {
	SymbolicName string `json:"symbolicName"`
	Version      string `json:"version"`
	Location     string `json:"location"`
	Reason       string `json:"reason"`
}

// Impact is the Dependency Impact Analyzer output of one bundle: §4.2 "What breaks if I
// change this bundle?". It is computed from the same index as the resolver, so it never
// invents a consumer the manifest does not declare.
type Impact struct {
	SymbolicName string `json:"symbolicName"`
	Version      string `json:"version"`
	Source       string `json:"source"`
	// MatchedClass is set when the analysis started from a class or interface.
	MatchedClass     string       `json:"matchedClass,omitempty"`
	ExportedPackages []string     `json:"exportedPackages,omitempty"`
	ImportedPackages []string     `json:"importedPackages,omitempty"`
	ProvidedServices []string     `json:"providedServices,omitempty"`
	ConsumedServices []string     `json:"consumedServices,omitempty"`
	DirectConsumers  []Consumer   `json:"directConsumers"`
	Transitive       []Consumer   `json:"transitiveConsumers"`
	Tests            []TestImpact `json:"tests"`
	Checks           []string     `json:"checks"`
	// Unresolved lists edges that currently do not match (distance 0): a consumer whose
	// version range is already incompatible, or a missing fragment host.
	Unresolved []string `json:"unresolved,omitempty"`
	// TotalConsumers is direct + transitive, so the UI states the size of the blast radius.
	TotalConsumers int `json:"totalConsumers"`
}

// maxImpactConsumers bounds the transitive closure: a shared bundle can reach hundreds of
// consumers, and the panel does not need to list them all to state the blast radius.
const maxImpactConsumers = 300

// AnalyzeImpact computes the consumers of a bundle by symbolic name. The name may also
// be a class name: AnalyzeImpactForClass resolves it first.
func (r *ExplorerReport) AnalyzeImpact(name string) (*Impact, error) {
	target, ok := r.findBundle(name)
	if !ok {
		return nil, fmt.Errorf("bundle %q is not in the workspace or in the active target platform", name)
	}
	impact := &Impact{
		SymbolicName:     target.Bundle.SymbolicName,
		Version:          target.Bundle.Version.String(),
		Source:           string(target.Source),
		DirectConsumers:  []Consumer{},
		Transitive:       []Consumer{},
		Tests:            []TestImpact{},
		Unresolved:       []string{},
		ExportedPackages: packageNames(target.Bundle.ExportPackage),
		ImportedPackages: packageNames(target.Bundle.ImportPackage),
	}
	components := ServiceComponents(target.Bundle)
	for _, component := range components {
		impact.ProvidedServices = append(impact.ProvidedServices, component.Services...)
		impact.ConsumedServices = append(impact.ConsumedServices, component.References...)
	}
	impact.ProvidedServices = sortedUnique(impact.ProvidedServices)
	impact.ConsumedServices = sortedUnique(impact.ConsumedServices)

	direct := map[string]Consumer{}
	for _, entry := range r.merged.All() {
		if entry.Bundle.SymbolicName == target.Bundle.SymbolicName && entry.Bundle.Version.Compare(target.Bundle.Version) == 0 {
			continue
		}
		for _, consumer := range consumersOf(entry, target, impact.ProvidedServices) {
			key := entry.Bundle.SymbolicName + " " + entry.Bundle.Version.String()
			if existing, seen := direct[key]; seen {
				// Keep the strongest edge: a mandatory requirement wins over an optional one.
				if existing.Optional && !consumer.Optional {
					direct[key] = consumer
				}
				continue
			}
			direct[key] = consumer
		}
	}
	for _, consumer := range direct {
		impact.DirectConsumers = append(impact.DirectConsumers, consumer)
	}
	sortConsumers(impact.DirectConsumers)

	// Transitive closure: who depends on the direct consumers.
	seen := map[string]bool{target.Bundle.SymbolicName: true}
	for _, consumer := range impact.DirectConsumers {
		seen[consumer.SymbolicName] = true
	}
	frontier := append([]Consumer{}, impact.DirectConsumers...)
	distance := 2
	for len(frontier) > 0 && distance <= 6 && len(impact.Transitive) < maxImpactConsumers {
		var next []Consumer
		for _, current := range frontier {
			entry, ok := r.findIndexed(current.SymbolicName, current.Version)
			if !ok {
				continue
			}
			for _, candidate := range r.merged.All() {
				if seen[candidate.Bundle.SymbolicName] {
					continue
				}
				edges := consumersOf(candidate, entry, nil)
				if len(edges) == 0 {
					continue
				}
				seen[candidate.Bundle.SymbolicName] = true
				for _, edge := range edges {
					edge.Distance = distance
					next = append(next, edge)
				}
			}
		}
		impact.Transitive = append(impact.Transitive, next...)
		frontier = next
		distance++
	}
	sortConsumers(impact.Transitive)
	impact.TotalConsumers = len(impact.DirectConsumers) + len(impact.Transitive)

	// Test bundles affected: PDE convention (a fragment named *.tests) or a bundle that
	// uses JUnit and depends on the analyzed bundle.
	for _, proj := range r.workspace.Bundles() {
		bundle := proj.Bundle
		if bundle == nil || bundle.SymbolicName == target.Bundle.SymbolicName {
			continue
		}
		isTest := looksLikeTestBundle(bundle)
		if !isTest {
			continue
		}
		reason := ""
		for _, consumer := range append(append([]Consumer{}, impact.DirectConsumers...), impact.Transitive...) {
			if consumer.SymbolicName == bundle.SymbolicName {
				reason = fmt.Sprintf("%s %s (%s)", consumer.Kind, consumer.Requirement, sourceLabel(target.Source))
				break
			}
		}
		if reason == "" && bundle.FragmentHost != nil && bundle.FragmentHost.Name == target.Bundle.SymbolicName {
			reason = "fragment of " + target.Bundle.SymbolicName
		}
		if reason == "" {
			continue
		}
		impact.Tests = append(impact.Tests, TestImpact{
			SymbolicName: bundle.SymbolicName, Version: bundle.Version.String(),
			Location: relativeOrAbsolute(r.Root, proj.Dir), Reason: reason,
		})
	}

	impact.Checks = impactChecks(impact, target)
	return impact, nil
}

// AnalyzeImpactForClass resolves a Java class or interface to its bundle and then runs
// the bundle impact. A class outside the workspace and the target cannot be correlated.
func (r *ExplorerReport) AnalyzeImpactForClass(class string) (*Impact, error) {
	bundle, ok := r.workspaceBundleOfClass(class)
	if !ok {
		return nil, fmt.Errorf("%s is not a class of a bundle in this workspace: open the bundle and analyze it instead", class)
	}
	impact, err := r.AnalyzeImpact(bundle.SymbolicName)
	if err != nil {
		return nil, err
	}
	impact.MatchedClass = class
	return impact, nil
}

// consumersOf returns the edges through which `consumer` depends on `provider`.
func consumersOf(consumer, provider *IndexedBundle, services []string) []Consumer {
	bundle := consumer.Bundle
	source := string(consumer.Source)
	var out []Consumer
	for _, clause := range bundle.RequireBundle {
		if clause.Name != provider.Bundle.SymbolicName {
			continue
		}
		requirement := requirementOf("Require-Bundle", clause)
		out = append(out, Consumer{
			SymbolicName: bundle.SymbolicName, Version: bundle.Version.String(), Source: source,
			Kind: "Require-Bundle", Requirement: requirement.String(), Optional: clause.IsOptional(),
			Distance: 1, Services: serviceOverlap(bundle, services), Test: looksLikeTestBundle(bundle),
		})
	}
	if host := bundle.FragmentHost; host != nil && host.Name == provider.Bundle.SymbolicName {
		out = append(out, Consumer{
			SymbolicName: bundle.SymbolicName, Version: bundle.Version.String(), Source: source,
			Kind: "Fragment-Host", Requirement: "Fragment-Host: " + host.Name,
			Distance: 1, Services: serviceOverlap(bundle, services), Test: looksLikeTestBundle(bundle),
		})
	}
	exports := map[string]Version{}
	for _, clause := range provider.Bundle.ExportPackage {
		version := Version{}
		if parsed, ok, err := clause.VersionRangeOf("version"); err == nil && ok {
			version = parsed.Floor
		}
		exports[clause.Name] = version
	}
	for _, clause := range bundle.ImportPackage {
		exportVersion, ok := exports[clause.Name]
		if !ok {
			continue
		}
		requirement := requirementOf("Import-Package", clause)
		compatible := !requirement.RangeOK || requirement.Range.Match(exportVersion)
		consumer := Consumer{
			SymbolicName: bundle.SymbolicName, Version: bundle.Version.String(), Source: source,
			Kind: "Import-Package", Package: clause.Name, Requirement: requirement.String(),
			Optional: clause.IsOptional(), Distance: 1, Services: serviceOverlap(bundle, services),
			Test: looksLikeTestBundle(bundle),
		}
		if !compatible {
			// The consumer names the package but not this version: it is an edge that
			// breaks today, not a future risk. It is kept, flagged by the requirement.
			consumer.Kind = "Import-Package (incompatible)"
		}
		out = append(out, consumer)
	}
	return out
}

// serviceOverlap lists the services of the analyzed bundle that the consumer references.
func serviceOverlap(consumer *Bundle, services []string) []string {
	if len(services) == 0 {
		return nil
	}
	referenced := map[string]bool{}
	for _, component := range ServiceComponents(consumer) {
		for _, reference := range component.References {
			referenced[reference] = true
		}
	}
	var out []string
	for _, service := range services {
		if referenced[service] {
			out = append(out, service)
		}
	}
	return out
}

// looksLikeTestBundle applies the PDE convention: a fragment or bundle named *.tests,
// *.test, test.* that requires or imports JUnit.
func looksLikeTestBundle(bundle *Bundle) bool {
	if bundle == nil {
		return false
	}
	lower := strings.ToLower(bundle.SymbolicName)
	marker := strings.Contains(lower, ".tests") || strings.Contains(lower, ".test") || strings.HasSuffix(lower, "tests") || strings.Contains(lower, ".testing")
	if !marker {
		return false
	}
	if bundle.FragmentHost != nil {
		return true
	}
	for _, clause := range bundle.RequireBundle {
		if clause.Name == "org.junit" || strings.HasPrefix(clause.Name, "org.junit.") {
			return true
		}
	}
	for _, clause := range bundle.ImportPackage {
		if strings.HasPrefix(clause.Name, "org.junit") || strings.HasPrefix(clause.Name, "org.hamcrest") {
			return true
		}
	}
	return false
}

// impactChecks is the "what to run before shipping" list.
func impactChecks(impact *Impact, target *IndexedBundle) []string {
	var checks []string
	checks = append(checks, fmt.Sprintf("build the %d impacted bundle(s)", impact.TotalConsumers))
	if len(impact.Tests) > 0 {
		names := make([]string, 0, len(impact.Tests))
		for _, test := range impact.Tests {
			names = append(names, test.SymbolicName)
		}
		checks = append(checks, "run the tests: "+strings.Join(names, ", "))
	} else {
		checks = append(checks, "no test bundle depends on it: add one before a shared API change")
	}
	if changed := packageList(impact.ExportedPackages); changed != "" {
		checks = append(checks, "re-export check: "+changed)
	}
	if len(impact.ProvidedServices) > 0 {
		checks = append(checks, "restart the framework: its DS components re-register "+strings.Join(impact.ProvidedServices, ", "))
	}
	checks = append(checks, "reindex the target platform after changing its version")
	if target.Source == SourceWorkspace {
		checks = append(checks, "compile and start the workspace bundles in Equinox")
	}
	return checks
}

func packageList(packages []string) string {
	if len(packages) == 0 {
		return ""
	}
	if len(packages) <= 3 {
		return strings.Join(packages, ", ")
	}
	return strings.Join(packages[:3], ", ") + fmt.Sprintf(" and %d more", len(packages)-3)
}

// findBundle prefers the workspace version of a symbolic name, then the target.
func (r *ExplorerReport) findBundle(name string) (*IndexedBundle, bool) {
	name = strings.TrimSpace(name)
	for _, proj := range r.workspace.Projects {
		if proj.Bundle != nil && proj.Bundle.SymbolicName == name {
			return &IndexedBundle{Bundle: proj.Bundle, Source: SourceWorkspace, Exploded: true}, true
		}
	}
	if !strings.Contains(name, " ") {
		if entries := r.index.ByName(name); len(entries) > 0 {
			return entries[len(entries)-1], true
		}
		return nil, false
	}
	for _, entry := range r.merged.All() {
		if labelOf(entry) == name {
			return entry, true
		}
	}
	return nil, false
}

func (r *ExplorerReport) findIndexed(name, version string) (*IndexedBundle, bool) {
	for _, entry := range r.merged.All() {
		if entry.Bundle.SymbolicName == name && entry.Bundle.Version.String() == version {
			return entry, true
		}
	}
	return nil, false
}

// workspaceBundleOfClass finds the workspace bundle whose source folder contains the
// class. Only a class of this workspace can be correlated to a file the user can edit.
func (r *ExplorerReport) workspaceBundleOfClass(class string) (*Bundle, bool) {
	name := strings.TrimSpace(class)
	name = strings.TrimPrefix(name, "class ")
	name = strings.TrimSuffix(name, ".java")
	name = strings.ReplaceAll(name, "/", ".")
	if !strings.Contains(name, ".") {
		// A simple name cannot be resolved to a package without guessing.
		for _, proj := range r.workspace.Bundles() {
			if proj.Bundle.Activator == name {
				return proj.Bundle, true
			}
		}
		return nil, false
	}
	relative := strings.ReplaceAll(name, ".", "/") + ".java"
	for _, proj := range r.workspace.Bundles() {
		for _, folder := range sourceRootsOf(proj) {
			if fileExists(filepath.Join(folder, filepath.FromSlash(relative))) {
				return proj.Bundle, true
			}
		}
	}
	return nil, false
}

func packageNames(clauses []Clause) []string {
	out := make([]string, 0, len(clauses))
	for _, clause := range clauses {
		out = append(out, clause.Name)
	}
	return out
}

func sortedUnique(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func sortConsumers(consumers []Consumer) {
	sort.SliceStable(consumers, func(i, j int) bool {
		if consumers[i].Distance != consumers[j].Distance {
			return consumers[i].Distance < consumers[j].Distance
		}
		if consumers[i].SymbolicName != consumers[j].SymbolicName {
			return consumers[i].SymbolicName < consumers[j].SymbolicName
		}
		return consumers[i].Requirement < consumers[j].Requirement
	})
}

func sourceLabel(source BundleSource) string {
	if source == SourceWorkspace {
		return "workspace"
	}
	return "target platform"
}
