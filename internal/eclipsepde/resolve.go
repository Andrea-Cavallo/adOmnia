package eclipsepde

import (
	"fmt"
	"sort"
	"strings"
)

// ResolutionStatus is the state of one bundle in a resolution run, matching the
// OSGi Plug-in Manager states (spec section 8).
type ResolutionStatus string

const (
	StatusResolved   ResolutionStatus = "Resolved"
	StatusUnresolved ResolutionStatus = "Unresolved"
	StatusWarning    ResolutionStatus = "Warning"
	StatusExcluded   ResolutionStatus = "Excluded"
)

// Requirement is one dependency edge of a bundle, normalized for diagnostics.
type Requirement struct {
	// Kind is "Require-Bundle", "Import-Package" or "Fragment-Host".
	Kind string
	// Name is the bundle symbolic name or the package name.
	Name string
	// Range is the requested version range; RangeOK is false when unspecified.
	Range   VersionRange
	RangeOK bool
	// Optional marks resolution:=optional requirements.
	Optional bool
	// clause is the manifest clause, for attribute matching.
	clause Clause
}

// String renders the requirement as PDE shows it.
func (r Requirement) String() string {
	s := r.Kind + ": " + r.Name
	if r.RangeOK {
		s += ";version=" + r.Range.String()
	}
	if r.Optional {
		s += ";resolution:=optional"
	}
	return s
}

// BundleResolution is the outcome for a single bundle.
type BundleResolution struct {
	Bundle *IndexedBundle
	Status ResolutionStatus
	// Missing lists requirements that could not be satisfied.
	Missing []MissingRequirement
	// Notes are non-blocking findings (optional requirement missing, version
	// satisfied by an older bundle than the newest...).
	Notes []string
	// Wires are the providers chosen for the satisfied requirements, in the
	// format the PDE bridge reports them.
	Wires []Wire
}

func wireTo(req Requirement, provider *IndexedBundle) Wire {
	return Wire{Kind: req.Kind, Name: req.Name, Provider: provider.Bundle.SymbolicName, ProviderVersion: provider.Bundle.Version.String()}
}

// MissingRequirement explains exactly why a requirement failed and what is
// available — the "Explain Dependency" output of spec section 8.
type MissingRequirement struct {
	Requirement Requirement
	// Available lists the candidate versions found in the index.
	Available []string
	// Chain is the dependency path from the root bundle to the failing one.
	Chain []string
	// Actions are the suggested fixes shown to the user.
	Actions []string
}

// String renders one diagnostic block in the style of the spec example.
func (m MissingRequirement) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s: %s\n", m.Requirement.Kind, m.Requirement.Name)
	if m.Requirement.RangeOK {
		fmt.Fprintf(&b, "  ├─ Required: %s\n", m.Requirement.Range)
	}
	if len(m.Available) > 0 {
		fmt.Fprintf(&b, "  ├─ Available in target: %s\n", strings.Join(m.Available, ", "))
	} else {
		b.WriteString("  ├─ Available in target: none\n")
	}
	b.WriteString("  └─ Status: UNRESOLVED\n")
	if len(m.Chain) > 1 {
		fmt.Fprintf(&b, "  Chain: %s\n", strings.Join(m.Chain, " → "))
	}
	if len(m.Actions) > 0 {
		fmt.Fprintf(&b, "  Action: %s", strings.Join(m.Actions, " / "))
	}
	return b.String()
}

// Resolution is the outcome of resolving one root bundle against the index.
type Resolution struct {
	Root *BundleResolution
	// Transitive holds the resolution of every reachable bundle, keyed by
	// "symbolicName version".
	Transitive map[string]*BundleResolution
}

// Resolver diagnoses OSGi dependency resolution of workspace bundles against
// the target-platform index. Per spec section 8 this is a *diagnostic* resolver
// (why does it not resolve, what is available, which chain requires it): the
// authoritative PDE/Equinox state is computed by the isolated legacy bridge.
type Resolver struct {
	Index *BundleIndex
	// ExecutionEnvironment is the environment of the target JRE (e.g. JavaSE-1.6):
	// a bundle requiring a newer one does not resolve. Empty skips the check.
	ExecutionEnvironment string
}

// NewResolver builds a resolver over an index.
func NewResolver(index *BundleIndex) *Resolver {
	return &Resolver{Index: index}
}

// Resolve diagnoses the root bundle and everything it reaches. The traversal
// visits Require-Bundle and Fragment-Host edges (fragments attach to their
// host) and Import-Package edges (matched against exporters in the index).
func (r *Resolver) Resolve(root *IndexedBundle) *Resolution {
	res := &Resolution{Root: &BundleResolution{Bundle: root}, Transitive: map[string]*BundleResolution{}}
	visited := map[string]bool{}
	r.resolveEntry(root, []string{labelOf(root)}, visited, res.Transitive)
	// The root's own outcome is the first visited entry.
	if own, ok := res.Transitive[labelOf(root)]; ok {
		res.Root = own
	}
	return res
}

func labelOf(e *IndexedBundle) string {
	return e.Bundle.SymbolicName + " " + e.Bundle.Version.String()
}

func (r *Resolver) resolveEntry(entry *IndexedBundle, chain []string, visited map[string]bool, out map[string]*BundleResolution) *BundleResolution {
	key := labelOf(entry)
	if visited[key] {
		return out[key]
	}
	visited[key] = true
	result := &BundleResolution{Bundle: entry}
	out[key] = result

	if required := entry.Bundle.ExecutionEnvironment; !executionEnvironmentSatisfied(r.ExecutionEnvironment, required) {
		result.Missing = append(result.Missing, MissingRequirement{
			Requirement: Requirement{Kind: "Bundle-RequiredExecutionEnvironment", Name: required},
			Chain:       chain,
			Actions:     []string{"run the target on " + required + " or newer", "lower Bundle-RequiredExecutionEnvironment if the code allows it"},
		})
	}

	// Fragment-Host: the host must exist and resolve.
	if host := entry.Bundle.FragmentHost; host != nil {
		req := requirementOf("Fragment-Host", *host)
		req.Optional = false
		r.checkBundleRequirement(req, entry, chain, result, out, visited, false)
	}

	for _, clause := range entry.Bundle.RequireBundle {
		req := requirementOf("Require-Bundle", clause)
		r.checkBundleRequirement(req, entry, chain, result, out, visited, clause.IsOptional())
	}

	for _, clause := range entry.Bundle.ImportPackage {
		req := requirementOf("Import-Package", clause)
		r.checkPackageRequirement(req, chain, result, out, visited, clause.IsOptional())
	}

	switch {
	case hasRequired(result.Missing):
		result.Status = StatusUnresolved
	case len(result.Missing) > 0 || len(result.Notes) > 0:
		result.Status = StatusWarning
	default:
		result.Status = StatusResolved
	}
	return result
}

// hasRequired reports whether any missing requirement is non-optional.
func hasRequired(missing []MissingRequirement) bool {
	for _, m := range missing {
		if !m.Requirement.Optional {
			return true
		}
	}
	return false
}

func requirementOf(kind string, clause Clause) Requirement {
	attr := "version"
	if kind != "Import-Package" {
		attr = "bundle-version"
	}
	req := Requirement{Kind: kind, Name: clause.Name, Optional: clause.IsOptional(), clause: clause}
	rng, ok, err := clause.VersionRangeOf(attr)
	if err == nil && ok {
		req.Range, req.RangeOK = rng, true
	}
	return req
}

func (r *Resolver) checkBundleRequirement(req Requirement, from *IndexedBundle, chain []string, result *BundleResolution, out map[string]*BundleResolution, visited map[string]bool, optional bool) {
	lookup := req.Name
	if lookup == systemBundleAlias {
		lookup = equinoxFramework
	}
	match, candidates, ok := r.Index.BestMatch(lookup, req.Range, req.RangeOK)
	if !ok {
		missing := MissingRequirement{
			Requirement: req,
			Available:   candidates,
			Chain:       chain,
			Actions:     suggestActions(req, candidates, r.Index),
		}
		result.Missing = append(result.Missing, missing)
		if optional {
			result.Notes = append(result.Notes, "optional requirement not satisfied: "+req.String())
		}
		return
	}
	result.Wires = append(result.Wires, wireTo(req, match))
	r.noteSingleton(result, match)
	sub := r.resolveEntry(match, append(chain, labelOf(match)), visited, out)
	noteTransitiveFailures(result, match, sub)
}

// noteTransitiveFailures surfaces failures of a dependency so the user sees who
// actually pulls the broken requirement in. Its optional imports are not failures:
// in a real target nearly every platform bundle has some that are not installed.
func noteTransitiveFailures(result *BundleResolution, dependency *IndexedBundle, sub *BundleResolution) {
	for _, m := range sub.Missing {
		if !m.Requirement.Optional {
			result.Notes = append(result.Notes, "via "+labelOf(dependency)+": "+m.Requirement.String()+" is unresolved")
		}
	}
}

// Names of the OSGi framework as a bundle. ponytail: Equinox only (Kepler), add
// other framework names when a target based on them appears.
const (
	systemBundleAlias = "system.bundle"
	equinoxFramework  = "org.eclipse.osgi"
)

// jrePackagePrefixes are the non-java.* packages of the JavaSE-1.6 profile, which
// the framework exports on behalf of the JRE. javax is listed by subpackage because
// javax.servlet, javax.inject, javax.persistence... must come from a real bundle.
// ponytail: one list for every execution environment, per-EE profiles when a
// bundle needs J2SE-1.5 to report javax.script as missing.
var jrePackagePrefixes = []string{
	"java.", "javax.accessibility", "javax.activation", "javax.activity", "javax.annotation", "javax.crypto",
	"javax.imageio", "javax.jws", "javax.lang.model", "javax.management", "javax.naming", "javax.net",
	"javax.print", "javax.rmi", "javax.script", "javax.security.auth", "javax.security.cert", "javax.security.sasl",
	"javax.smartcardio", "javax.sound", "javax.sql", "javax.swing", "javax.tools", "javax.transaction", "javax.xml",
	"org.ietf.jgss", "org.omg.", "org.w3c.dom", "org.xml.sax",
}

func providedByJRE(pkg string) bool {
	for _, prefix := range jrePackagePrefixes {
		if pkg == strings.TrimSuffix(prefix, ".") || strings.HasPrefix(pkg, strings.TrimSuffix(prefix, ".")+".") {
			return true
		}
	}
	return false
}

func (r *Resolver) checkPackageRequirement(req Requirement, chain []string, result *BundleResolution, out map[string]*BundleResolution, visited map[string]bool, optional bool) {
	if r.wireToJRE(req, result) {
		return
	}
	providers := r.Index.ProvidersOf(req.Name)
	var candidates []string
	var chosen *Provider
	for i := len(providers) - 1; i >= 0; i-- {
		p := providers[i]
		candidates = append(candidates, p.ExportVersion.String()+" ("+p.Entry.Bundle.SymbolicName+")")
		if chosen == nil && (!req.RangeOK || req.Range.Match(p.ExportVersion)) && exportMatchesImport(req.clause, p.Clause, r.exporterOf(p.Entry)) {
			chosen = &providers[i]
		}
	}
	if chosen == nil {
		if len(providers) == 0 && providedByJRE(req.Name) {
			return
		}
		missing := MissingRequirement{Requirement: req, Available: candidates, Chain: chain, Actions: suggestActions(req, candidates, r.Index)}
		result.Missing = append(result.Missing, missing)
		if optional {
			result.Notes = append(result.Notes, "optional requirement not satisfied: "+req.String())
		}
		return
	}
	result.Wires = append(result.Wires, wireTo(req, r.exporterOf(chosen.Entry)))
	r.noteSingleton(result, r.exporterOf(chosen.Entry))
	sub := r.resolveEntry(chosen.Entry, append(chain, labelOf(chosen.Entry)), visited, out)
	noteTransitiveFailures(result, chosen.Entry, sub)
}

// wireToJRE satisfies a JRE package from the framework, as Equinox does: the
// system bundle resolves first and an already resolved exporter wins, even
// over a bundle exporting a newer version (javax.xml 1.3.4 in Kepler). It
// applies when the import accepts the unversioned system export and names no
// exporter attributes.
func (r *Resolver) wireToJRE(req Requirement, result *BundleResolution) bool {
	if !providedByJRE(req.Name) || (req.RangeOK && !req.Range.Match(Version{})) || hasSelectionAttributes(req.clause) {
		return false
	}
	if framework, _, ok := r.Index.BestMatch(equinoxFramework, VersionRange{}, false); ok {
		result.Wires = append(result.Wires, wireTo(req, framework))
	}
	return true
}

func hasSelectionAttributes(clause Clause) bool {
	for name := range clause.Attributes {
		if !versionAttributes[name] {
			return true
		}
	}
	return false
}

// noteSingleton warns when the chosen provider is a singleton with a newer
// version in the index: PDE compiles against it, but at runtime Equinox keeps
// only the newest singleton, so this wiring fails when the product launches.
func (r *Resolver) noteSingleton(result *BundleResolution, provider *IndexedBundle) {
	if !provider.Bundle.Singleton {
		return
	}
	for _, other := range r.Index.ByName(provider.Bundle.SymbolicName) {
		if other.Bundle.Singleton && other.Bundle.Version.Compare(provider.Bundle.Version) > 0 {
			result.Notes = append(result.Notes, fmt.Sprintf("via %s: singleton, at runtime Equinox selects %s instead", labelOf(provider), labelOf(other)))
			return
		}
	}
}

// exporterOf is the bundle that exports a package at runtime: a fragment's
// exports belong to its host, as Equinox wires them.
func (r *Resolver) exporterOf(entry *IndexedBundle) *IndexedBundle {
	host := entry.Bundle.FragmentHost
	if host == nil {
		return entry
	}
	rng, ok, err := host.VersionRangeOf("bundle-version")
	if match, _, found := r.Index.BestMatch(host.Name, rng, ok && err == nil); found {
		return match
	}
	return entry
}

// suggestActions turns a missing requirement into the actionable hints of the
// spec example: inspect target / locate compatible bundle / review manifest.
func suggestActions(req Requirement, candidates []string, index *BundleIndex) []string {
	var actions []string
	if len(candidates) == 0 {
		actions = append(actions, "locate the bundle in the target platform or in the workspace")
		if len(index.ByName(req.Name)) == 0 {
			actions = append(actions, "the bundle name is unknown to the index: check Bundle-SymbolicName spelling")
		}
	} else {
		actions = append(actions, "inspect target: a compatible version is not indexed")
		actions = append(actions, "review the version range of "+req.String())
	}
	sort.Strings(actions)
	return actions
}

// StatusOf is a helper for UIs listing a workspace: it resolves every bundle
// project and returns entries sorted by name.
func (r *Resolver) StatusOf(projects []*EclipseProject) []*BundleResolution {
	var out []*BundleResolution
	for _, p := range projects {
		if p.Bundle == nil {
			continue
		}
		entry := &IndexedBundle{Bundle: p.Bundle, Source: SourceWorkspace, Exploded: true}
		res := r.Resolve(entry)
		out = append(out, res.Root)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Bundle.Bundle.SymbolicName < out[j].Bundle.Bundle.SymbolicName
	})
	return out
}
