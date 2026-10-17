package eclipsepde

import "sort"

// DependencyGraph is the navigable graph behind the OSGi Plug-in Manager view
// (spec section 8: "Dependency Graph navigabile", "Explain Dependency").
type DependencyGraph struct {
	Nodes []GraphNode
	Edges []GraphEdge
}

// GraphNode is one bundle (workspace or target) participating in the graph.
type GraphNode struct {
	// ID is "symbolicName version", stable across rebuilds.
	ID       string
	Name     string
	Version  string
	Source   BundleSource
	Status   ResolutionStatus
	Fragment bool
}

// GraphEdge is one requirement between two bundles.
type GraphEdge struct {
	From string
	To   string
	// Kind is "Require-Bundle", "Import-Package" or "Fragment-Host".
	Kind string
	// Optional marks resolution:=optional edges.
	Optional bool
	// Satisfied is false when the edge points at nothing in the index.
	Satisfied bool
	// Requirement is the rendered clause for tooltips and diagnostics.
	Requirement string
}

// BuildDependencyGraph renders the resolution of a root bundle as a graph.
// Unresolved edges keep their target name as the To ID even when no node
// provides it, so the UI can draw a dangling edge and explain it.
func BuildDependencyGraph(res *Resolution) *DependencyGraph {
	g := &DependencyGraph{}
	nodeSeen := map[string]bool{}

	addNode := func(entry *IndexedBundle, status ResolutionStatus) {
		id := labelOf(entry)
		if nodeSeen[id] {
			return
		}
		nodeSeen[id] = true
		g.Nodes = append(g.Nodes, GraphNode{
			ID:       id,
			Name:     entry.Bundle.SymbolicName,
			Version:  entry.Bundle.Version.String(),
			Source:   entry.Source,
			Status:   status,
			Fragment: entry.Bundle.FragmentHost != nil,
		})
	}

	// Nodes from the transitive resolution.
	for _, key := range sortedKeys(res.Transitive) {
		addNode(res.Transitive[key].Bundle, res.Transitive[key].Status)
	}

	// Edges from every visited bundle's requirements.
	for _, key := range sortedKeys(res.Transitive) {
		bundle := res.Transitive[key].Bundle.Bundle
		for _, clause := range bundle.RequireBundle {
			g.addEdge(bundle, "Require-Bundle", clause, res)
		}
		for _, clause := range bundle.ImportPackage {
			g.addEdge(bundle, "Import-Package", clause, res)
		}
		if host := bundle.FragmentHost; host != nil {
			g.addEdge(bundle, "Fragment-Host", *host, res)
		}
	}
	return g
}

func (g *DependencyGraph) addEdge(from *Bundle, kind string, clause Clause, res *Resolution) {
	attr := "version"
	if kind != "Import-Package" {
		attr = "bundle-version"
	}
	req := requirementOf(kind, clause)
	target, satisfied := res.findProvider(kind, clause, attr)
	edge := GraphEdge{
		From:        labelOf(&IndexedBundle{Bundle: from}),
		To:          target,
		Kind:        kind,
		Optional:    clause.IsOptional(),
		Satisfied:   satisfied,
		Requirement: req.String(),
	}
	g.Edges = append(g.Edges, edge)
}

// findProvider locates the resolution node satisfying a clause. It returns the
// target label and whether anything in the resolution matched.
func (r *Resolution) findProvider(kind string, clause Clause, attr string) (string, bool) {
	rng, hasRange, _ := clause.VersionRangeOf(attr)
	for _, key := range sortedKeys(r.Transitive) {
		entry := r.Transitive[key].Bundle.Bundle
		switch kind {
		case "Import-Package":
			for _, export := range entry.ExportPackage {
				if export.Name != clause.Name {
					continue
				}
				exportVersion := Version{}
				if v, ok, err := export.VersionRangeOf("version"); err == nil && ok {
					exportVersion = v.Floor
				}
				if !hasRange || rng.Match(exportVersion) {
					return labelOf(r.Transitive[key].Bundle), true
				}
			}
		default:
			if entry.SymbolicName == clause.Name && (!hasRange || rng.Match(entry.Version)) {
				return key, true
			}
		}
	}
	// Nothing matched: keep the requested name so the edge dangles visibly.
	return clause.Name + " (missing)", false
}

// Explain returns the dependency chains from the root to every missing
// requirement — the "why does it not resolve" answer of spec section 8.
func (r *Resolution) Explain() []MissingRequirement {
	var out []MissingRequirement
	for _, key := range sortedKeys(r.Transitive) {
		out = append(out, r.Transitive[key].Missing...)
	}
	return out
}

func sortedKeys(m map[string]*BundleResolution) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
