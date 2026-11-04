package eclipsepde

import (
	"fmt"
	"sort"
)

// FocusNode is one bundle of the focused dependency graph. Direction says how it
// relates to the selected bundle: its dependencies (what it needs) or its consumers
// (what breaks when it changes).
type FocusNode struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Version   string `json:"version"`
	Source    string `json:"source"`
	Status    string `json:"status"`
	Fragment  bool   `json:"fragment,omitempty"`
	Distance  int    `json:"distance"`
	Direction string `json:"direction"`
}

// FocusEdge is one requirement between two nodes of the focused graph.
type FocusEdge struct {
	From        string `json:"from"`
	To          string `json:"to"`
	Kind        string `json:"kind"`
	Requirement string `json:"requirement"`
	Optional    bool   `json:"optional,omitempty"`
	Satisfied   bool   `json:"satisfied"`
	Direction   string `json:"direction"`
}

// FocusGraph is the subgraph of §3: never the whole workspace, only what surrounds the
// selected bundle, expandable one level at a time. depth is 1 or 2.
type FocusGraph struct {
	Root         string      `json:"root"`
	Depth        int         `json:"depth"`
	Nodes        []FocusNode `json:"nodes"`
	Edges        []FocusEdge `json:"edges"`
	Dependencies int         `json:"dependencies"`
	Consumers    int         `json:"consumers"`
	Missing      int         `json:"missing"`
	// Truncated is true when the graph hit maxFocusNodes: the panel says so instead of
	// freezing on a workspace with thousands of bundles.
	Truncated bool `json:"truncated,omitempty"`
}

// maxFocusNodes bounds the focused graph.
const maxFocusNodes = 240

// FocusGraph builds the subgraph around one bundle: its transitive dependencies and its
// transitive consumers, both limited to depth. Every edge carries the requirement text
// and whether the index satisfies it, so a dangling arrow is a real missing dependency.
func (r *ExplorerReport) FocusGraph(name string, depth int) (*FocusGraph, error) {
	root, ok := r.findBundle(name)
	if !ok {
		return nil, fmt.Errorf("bundle %q is not in the workspace or in the active target platform", name)
	}
	if depth < 1 {
		depth = 1
	}
	if depth > 2 {
		depth = 2
	}
	graph := &FocusGraph{Root: labelOf(root), Depth: depth}
	nodes := map[string]FocusNode{}
	edges := map[string]FocusEdge{}

	addNode := func(entry *IndexedBundle, distance int, direction string) bool {
		id := labelOf(entry)
		if _, exists := nodes[id]; exists {
			return true
		}
		if len(nodes) >= maxFocusNodes {
			graph.Truncated = true
			return false
		}
		nodes[id] = FocusNode{
			ID: id, Name: entry.Bundle.SymbolicName, Version: entry.Bundle.Version.String(),
			Source: string(entry.Source), Status: string(r.statusOf(entry)),
			Fragment: entry.Bundle.FragmentHost != nil, Distance: distance, Direction: direction,
		}
		return true
	}
	addEdge := func(edge FocusEdge) {
		key := edge.Direction + "|" + edge.From + "|" + edge.To + "|" + edge.Kind + "|" + edge.Requirement
		edges[key] = edge
	}

	addNode(root, 0, "root")
	frontier := []*IndexedBundle{root}
	for distance := 1; distance <= depth; distance++ {
		var next []*IndexedBundle
		for _, current := range frontier {
			for _, edge := range r.forwardEdges(current) {
				addEdge(FocusEdge{From: labelOf(current), To: edge.target, Kind: edge.kind, Requirement: edge.requirement, Optional: edge.optional, Satisfied: edge.satisfied, Direction: "dependency"})
				if !edge.satisfied || edge.entry == nil {
					continue
				}
				if addNode(edge.entry, distance, "dependency") {
					next = append(next, edge.entry)
				}
			}
		}
		frontier = next
	}

	consumers := []*IndexedBundle{root}
	for distance := 1; distance <= depth; distance++ {
		var next []*IndexedBundle
		for _, current := range consumers {
			for _, consumer := range r.reverseEdges(current) {
				addEdge(FocusEdge{From: labelOf(consumer.entry), To: labelOf(current), Kind: consumer.kind, Requirement: consumer.requirement, Optional: consumer.optional, Satisfied: true, Direction: "consumer"})
				if addNode(consumer.entry, distance, "consumer") {
					next = append(next, consumer.entry)
				}
			}
		}
		consumers = next
	}

	for _, node := range nodes {
		if node.Direction == "consumer" {
			graph.Consumers++
		}
		if node.Distance == 1 && node.Direction == "dependency" {
			graph.Dependencies++
		}
	}
	for _, edge := range edges {
		if !edge.Satisfied {
			graph.Missing++
		}
	}
	for _, node := range nodes {
		graph.Nodes = append(graph.Nodes, node)
	}
	sort.SliceStable(graph.Nodes, func(i, j int) bool {
		if graph.Nodes[i].Distance != graph.Nodes[j].Distance {
			return graph.Nodes[i].Distance < graph.Nodes[j].Distance
		}
		if graph.Nodes[i].Direction != graph.Nodes[j].Direction {
			return graph.Nodes[i].Direction < graph.Nodes[j].Direction
		}
		return graph.Nodes[i].Name < graph.Nodes[j].Name
	})
	for _, edge := range edges {
		graph.Edges = append(graph.Edges, edge)
	}
	sort.SliceStable(graph.Edges, func(i, j int) bool {
		if graph.Edges[i].Direction != graph.Edges[j].Direction {
			return graph.Edges[i].Direction < graph.Edges[j].Direction
		}
		if graph.Edges[i].From != graph.Edges[j].From {
			return graph.Edges[i].From < graph.Edges[j].From
		}
		return graph.Edges[i].To < graph.Edges[j].To
	})
	return graph, nil
}

// edgeTarget is one resolved requirement of a bundle.
type edgeTarget struct {
	kind        string
	requirement string
	optional    bool
	satisfied   bool
	target      string
	entry       *IndexedBundle
}

// forwardEdges resolves the requirements of one bundle against the merged index.
func (r *ExplorerReport) forwardEdges(entry *IndexedBundle) []edgeTarget {
	bundle := entry.Bundle
	var out []edgeTarget
	for _, clause := range bundle.RequireBundle {
		requirement := requirementOf("Require-Bundle", clause)
		match, _, ok := r.merged.BestMatch(clause.Name, requirement.Range, requirement.RangeOK)
		target := clause.Name + " (missing)"
		if ok {
			target = labelOf(match)
		}
		out = append(out, edgeTarget{kind: "Require-Bundle", requirement: requirement.String(), optional: clause.IsOptional(), satisfied: ok, target: target, entry: match})
	}
	for _, clause := range bundle.ImportPackage {
		requirement := requirementOf("Import-Package", clause)
		target, provider := r.packageProvider(requirement, clause)
		out = append(out, edgeTarget{kind: "Import-Package", requirement: requirement.String(), optional: clause.IsOptional(), satisfied: provider != nil, target: target, entry: provider})
	}
	if host := bundle.FragmentHost; host != nil {
		requirement := requirementOf("Fragment-Host", *host)
		match, _, ok := r.merged.BestMatch(host.Name, requirement.Range, requirement.RangeOK)
		target := host.Name + " (missing)"
		if ok {
			target = labelOf(match)
		}
		out = append(out, edgeTarget{kind: "Fragment-Host", requirement: requirement.String(), satisfied: ok, target: target, entry: match})
	}
	return out
}

// packageProvider picks the exporter the resolver would pick: newest version whose
// clause matches the import attributes.
func (r *ExplorerReport) packageProvider(requirement Requirement, clause Clause) (string, *IndexedBundle) {
	providers := r.merged.ProvidersOf(requirement.Name)
	for index := len(providers) - 1; index >= 0; index-- {
		provider := providers[index]
		if requirement.RangeOK && !requirement.Range.Match(provider.ExportVersion) {
			continue
		}
		if !exportMatchesImport(clause, provider.Clause, provider.Entry) {
			continue
		}
		return labelOf(provider.Entry), provider.Entry
	}
	return requirement.Name + " (missing)", nil
}

// reverseEdge is one consumer of a bundle.
type reverseEdge struct {
	entry       *IndexedBundle
	kind        string
	requirement string
	optional    bool
}

// reverseEdges returns the bundles that depend on entry.
func (r *ExplorerReport) reverseEdges(entry *IndexedBundle) []reverseEdge {
	var out []reverseEdge
	for _, candidate := range r.merged.All() {
		if candidate.Bundle.SymbolicName == entry.Bundle.SymbolicName && candidate.Bundle.Version.Compare(entry.Bundle.Version) == 0 {
			continue
		}
		for _, consumer := range consumersOf(candidate, entry, nil) {
			out = append(out, reverseEdge{entry: candidate, kind: consumer.Kind, requirement: consumer.Requirement, optional: consumer.Optional})
		}
	}
	return out
}

// statusOf is the resolution status of a workspace bundle; a target bundle is only
// available there.
func (r *ExplorerReport) statusOf(entry *IndexedBundle) ResolutionStatus {
	if entry.Source != SourceWorkspace {
		return StatusResolved
	}
	for _, row := range r.Bundles {
		if row.Source == string(SourceWorkspace) && row.SymbolicName == entry.Bundle.SymbolicName {
			return row.Status
		}
	}
	return StatusResolved
}
