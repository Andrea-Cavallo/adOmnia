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
	req := Requirement{Kind: kind, Name: clause.Name, Optional: clause.IsOptional()}
	rng, ok, err := clause.VersionRangeOf(attr)
	if err == nil && ok {
		req.Range, req.RangeOK = rng, true
	}
	return req
}

func (r *Resolver) checkBundleRequirement(req Requirement, from *IndexedBundle, chain []string, result *BundleResolution, out map[string]*BundleResolution, visited map[string]bool, optional bool) {
	match, candidates, ok := r.Index.BestMatch(req.Name, req.Range, req.RangeOK)
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
	sub := r.resolveEntry(match, append(chain, labelOf(match)), visited, out)
	// Surface transitive failures with the local chain so the user sees who
	// actually pulls the broken dependency in.
	for _, m := range sub.Missing {
		result.Notes = append(result.Notes, "via "+labelOf(match)+": "+m.Requirement.String()+" is unresolved")
	}
}

func (r *Resolver) checkPackageRequirement(req Requirement, chain []string, result *BundleResolution, out map[string]*BundleResolution, visited map[string]bool, optional bool) {
	providers := r.Index.ProvidersOf(req.Name)
	var candidates []string
	var chosen *Provider
	for i := len(providers) - 1; i >= 0; i-- {
		p := providers[i]
		candidates = append(candidates, p.ExportVersion.String()+" ("+p.Entry.Bundle.SymbolicName+")")
		if chosen == nil && (!req.RangeOK || req.Range.Match(p.ExportVersion)) {
			chosen = &providers[i]
		}
	}
	if chosen == nil {
		missing := MissingRequirement{Requirement: req, Available: candidates, Chain: chain, Actions: suggestActions(req, candidates, r.Index)}
		result.Missing = append(result.Missing, missing)
		if optional {
			result.Notes = append(result.Notes, "optional requirement not satisfied: "+req.String())
		}
		return
	}
	sub := r.resolveEntry(chosen.Entry, append(chain, labelOf(chosen.Entry)), visited, out)
	for _, m := range sub.Missing {
		result.Notes = append(result.Notes, "via "+labelOf(chosen.Entry)+": "+m.Requirement.String()+" is unresolved")
	}
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
