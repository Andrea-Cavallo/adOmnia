package flowintel

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

// Index answers the Flow Explorer queries over one discovered graph.
type Index struct {
	Discovery *Discovery
	nodes     map[string]graph.Node
	out       map[string][]graph.Edge
	in        map[string][]graph.Edge
	order     []string
}

// NewIndex builds the adjacency maps of a discovery.
func NewIndex(discovery *Discovery) *Index {
	index := &Index{
		Discovery: discovery, nodes: map[string]graph.Node{},
		out: map[string][]graph.Edge{}, in: map[string][]graph.Edge{},
	}
	for _, node := range discovery.Graph.Nodes {
		index.nodes[node.ID] = node
		index.order = append(index.order, node.ID)
	}
	sort.Strings(index.order)
	for _, edge := range discovery.Graph.Edges {
		index.out[edge.From] = append(index.out[edge.From], edge)
		index.in[edge.To] = append(index.in[edge.To], edge)
	}
	return index
}

// Node returns one node by id.
func (x *Index) Node(id string) (graph.Node, bool) {
	node, ok := x.nodes[id]
	return node, ok
}

// Flows lists every flow/subflow node.
func (x *Index) Flows() []graph.Node {
	var flows []graph.Node
	for _, id := range x.order {
		node := x.nodes[id]
		if node.Kind == graph.KindFlow || node.Kind == graph.KindSubflow {
			flows = append(flows, node)
		}
	}
	return flows
}

// Resolve maps a user query (id, label or a fragment) to a node: exact id first, then an
// exact label, then the best search hit.
func (x *Index) Resolve(query string) (graph.Node, error) {
	query = strings.TrimSpace(query)
	preferFlow := func(node graph.Node) graph.Node {
		if node.Kind != graph.KindMethod {
			return node
		}
		// A method reached by name is usually asked as "the flow that runs it": prefer the
		// declared/annotated flow node around it.
		for _, id := range x.order {
			candidate := x.nodes[id]
			if (candidate.Kind == graph.KindFlow || candidate.Kind == graph.KindSubflow) && candidate.Attrs["method"] == node.ID {
				return candidate
			}
		}
		return node
	}
	if node, ok := x.nodes[query]; ok {
		return preferFlow(node), nil
	}
	prefixed := []string{"flow:", "method:", "type:", "bundle:", "service:", "external:", "activator:"}
	for _, prefix := range prefixed {
		if node, ok := x.nodes[prefix+query]; ok {
			return preferFlow(node), nil
		}
	}
	// A label can be shared by a flow and its method: the flow is the meaningful entry point.
	for _, id := range x.order {
		node := x.nodes[id]
		if (node.Kind == graph.KindFlow || node.Kind == graph.KindSubflow) && strings.EqualFold(node.Label, query) {
			return node, nil
		}
	}
	for _, id := range x.order {
		if strings.EqualFold(x.nodes[id].Label, query) {
			return preferFlow(x.nodes[id]), nil
		}
	}
	hits := x.Search(query, 1)
	if len(hits) == 0 {
		return graph.Node{}, fmt.Errorf("%q is not in the flow graph: try flow_discover or a broader name", query)
	}
	return preferFlow(hits[0]), nil
}

// Search ranks nodes by id/label match: exact label, label prefix, label contains, id contains.
func (x *Index) Search(query string, limit int) []graph.Node {
	query = strings.TrimSpace(query)
	if query == "" || limit <= 0 {
		return nil
	}
	lower := strings.ToLower(query)
	type hit struct {
		node graph.Node
		rank int
	}
	var hits []hit
	for _, id := range x.order {
		node := x.nodes[id]
		label := strings.ToLower(node.Label)
		rank := -1
		switch {
		case label == lower:
			rank = 0
		case strings.HasPrefix(label, lower):
			rank = 1
		case strings.Contains(label, lower):
			rank = 2
		case strings.Contains(strings.ToLower(node.ID), lower):
			rank = 3
		}
		if rank >= 0 {
			hits = append(hits, hit{node, rank})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].rank != hits[j].rank {
			return hits[i].rank < hits[j].rank
		}
		return hits[i].node.ID < hits[j].node.ID
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]graph.Node, 0, len(hits))
	for _, item := range hits {
		out = append(out, item.node)
	}
	return out
}

// Step is one traversed edge with the node reached.
type Step struct {
	Edge  graph.Edge `json:"edge"`
	Node  graph.Node `json:"node"`
	Depth int        `json:"depth"`
}

// Trace is a bounded path tree in one direction.
type Trace struct {
	Root      graph.Node   `json:"root"`
	Direction string       `json:"direction"`
	MaxDepth  int          `json:"maxDepth"`
	Steps     []Step       `json:"steps"`
	Nodes     []graph.Node `json:"nodes"`
	Truncated bool         `json:"truncated,omitempty"`
}

const maxTraceNodes = 400

// Trace walks from one node. direction is downstream (what it calls), upstream (who calls
// it) or both. depth defaults to 4.
func (x *Index) Trace(id, direction string, depth int) (*Trace, error) {
	root, err := x.Resolve(id)
	if err != nil {
		return nil, err
	}
	if direction != "upstream" && direction != "both" {
		direction = "downstream"
	}
	if depth <= 0 {
		depth = 4
	}
	if depth > 12 {
		depth = 12
	}
	trace := &Trace{Root: root, Direction: direction, MaxDepth: depth}
	seen := map[string]bool{root.ID: true}
	trace.Nodes = append(trace.Nodes, root)
	frontier := []string{root.ID}
	for level := 1; level <= depth && len(frontier) > 0; level++ {
		var next []string
		for _, current := range frontier {
			var edges []graph.Edge
			if direction != "upstream" {
				edges = append(edges, x.out[current]...)
			}
			if direction != "downstream" {
				edges = append(edges, x.in[current]...)
			}
			for _, edge := range edges {
				other := edge.To
				if edge.From != current {
					other = edge.From
				}
				node, ok := x.nodes[other]
				if !ok || seen[node.ID] {
					continue
				}
				seen[node.ID] = true
				trace.Steps = append(trace.Steps, Step{Edge: edge, Node: node, Depth: level})
				trace.Nodes = append(trace.Nodes, node)
				next = append(next, node.ID)
				if len(trace.Nodes) >= maxTraceNodes {
					trace.Truncated = true
					return trace, nil
				}
			}
		}
		frontier = next
	}
	return trace, nil
}

func containsEdge(edges []graph.Edge, edge graph.Edge) bool {
	for _, candidate := range edges {
		if candidate == edge {
			return true
		}
	}
	return false
}

// Path is one route between two nodes.
type Path struct {
	Nodes      []graph.Node `json:"nodes"`
	Edges      []graph.Edge `json:"edges"`
	Confidence string       `json:"confidence"`
}

// FindPaths returns up to limit shortest downstream paths from one node to another.
func (x *Index) FindPaths(from, to string, maxDepth, limit int) ([]Path, error) {
	start, err := x.Resolve(from)
	if err != nil {
		return nil, err
	}
	end, err := x.Resolve(to)
	if err != nil {
		return nil, err
	}
	if start.ID == end.ID {
		return []Path{{Nodes: []graph.Node{start}, Confidence: graph.ConfidenceDerived}}, nil
	}
	if maxDepth <= 0 {
		maxDepth = 8
	}
	if maxDepth > 16 {
		maxDepth = 16
	}
	if limit <= 0 || limit > 10 {
		limit = 3
	}
	var paths []Path
	// BFS with parent edges; collect the first distinct routes.
	parents := map[string]graph.Edge{}
	depth := map[string]int{start.ID: 0}
	queue := []string{start.ID}
	for len(queue) > 0 && len(paths) < limit {
		current := queue[0]
		queue = queue[1:]
		if depth[current] >= maxDepth {
			continue
		}
		for _, edge := range x.out[current] {
			if _, seen := depth[edge.To]; seen {
				continue
			}
			depth[edge.To] = depth[current] + 1
			parents[edge.To] = edge
			if edge.To == end.ID {
				paths = append(paths, buildPath(x, parents, start, end))
				continue
			}
			queue = append(queue, edge.To)
		}
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("no path from %s to %s within %d steps", start.ID, end.ID, maxDepth)
	}
	return paths, nil
}

func buildPath(x *Index, parents map[string]graph.Edge, start, end graph.Node) Path {
	path := Path{Confidence: graph.ConfidenceObserved}
	var reversedEdges []graph.Edge
	current := end.ID
	for current != start.ID {
		edge, ok := parents[current]
		if !ok {
			break
		}
		reversedEdges = append(reversedEdges, edge)
		current = edge.From
	}
	for index := len(reversedEdges) - 1; index >= 0; index-- {
		edge := reversedEdges[index]
		path.Edges = append(path.Edges, edge)
		path.Confidence = weakerConfidence(path.Confidence, edge.Confidence)
	}
	path.Nodes = append(path.Nodes, start)
	for _, edge := range path.Edges {
		if node, ok := x.nodes[edge.To]; ok {
			path.Nodes = append(path.Nodes, node)
		}
	}
	if len(path.Edges) == 0 {
		path.Confidence = graph.ConfidenceDerived
	}
	return path
}

func weakerConfidence(current, candidate string) string {
	rankOf := func(confidence string) int {
		switch confidence {
		case graph.ConfidenceObserved:
			return 3
		case graph.ConfidenceDeclared:
			return 2
		case graph.ConfidenceInferred:
			return 0
		default: // "" is a derived edge
			return 1
		}
	}
	if candidate == "" {
		candidate = graph.ConfidenceDerived
	}
	if rankOf(candidate) < rankOf(current) {
		return candidate
	}
	return current
}

// Impact is what a change to one node can break.
type Impact struct {
	Root       graph.Node   `json:"root"`
	Direct     []Step       `json:"direct"`
	Transitive []Step       `json:"transitive"`
	Flows      []graph.Node `json:"flows"`
	Bundles    []string     `json:"bundles"`
	Services   []string     `json:"services"`
	Externals  []graph.Node `json:"externals"`
	Truncated  bool         `json:"truncated,omitempty"`
}

// Impact walks upstream: who reaches this node and through which relation. depth defaults
// to 6.
func (x *Index) Impact(id string, depth int) (*Impact, error) {
	root, err := x.Resolve(id)
	if err != nil {
		return nil, err
	}
	if depth <= 0 {
		depth = 6
	}
	if depth > 10 {
		depth = 10
	}
	impact := &Impact{Root: root}
	seen := map[string]bool{root.ID: true}
	frontier := []string{root.ID}
	flows := map[string]graph.Node{}
	bundles := map[string]bool{}
	services := map[string]bool{}
	externals := map[string]graph.Node{}
	for level := 1; level <= depth && len(frontier) > 0; level++ {
		var next []string
		for _, current := range frontier {
			for _, edge := range x.in[current] {
				node, ok := x.nodes[edge.From]
				if !ok || seen[node.ID] {
					continue
				}
				seen[node.ID] = true
				step := Step{Edge: edge, Node: node, Depth: level}
				if level == 1 {
					impact.Direct = append(impact.Direct, step)
				} else {
					impact.Transitive = append(impact.Transitive, step)
				}
				switch node.Kind {
				case graph.KindFlow, graph.KindSubflow:
					flows[node.ID] = node
				case graph.KindBundle:
					bundles[node.Label] = true
				case graph.KindService:
					services[node.Label] = true
				case graph.KindExternal:
					externals[node.ID] = node
				}
				next = append(next, node.ID)
				if len(seen) >= maxTraceNodes {
					impact.Truncated = true
					break
				}
			}
		}
		frontier = next
	}
	for _, node := range flows {
		impact.Flows = append(impact.Flows, node)
	}
	for bundle := range bundles {
		impact.Bundles = append(impact.Bundles, bundle)
	}
	for service := range services {
		impact.Services = append(impact.Services, service)
	}
	for _, node := range externals {
		impact.Externals = append(impact.Externals, node)
	}
	sort.Slice(impact.Flows, func(i, j int) bool { return impact.Flows[i].ID < impact.Flows[j].ID })
	sort.Strings(impact.Bundles)
	sort.Strings(impact.Services)
	sort.Slice(impact.Externals, func(i, j int) bool { return impact.Externals[i].ID < impact.Externals[j].ID })
	return impact, nil
}

// ExplainedEdge is an edge plus why it exists (declaration, annotation, name, source).
type ExplainedEdge struct {
	Edge  graph.Edge `json:"edge"`
	Other graph.Node `json:"other"`
	Why   string     `json:"why"`
}

// SourceSnippet is the code around a node.
type SourceSnippet struct {
	File  string   `json:"file"`
	Line  int      `json:"line"`
	Lines []string `json:"lines"`
}

// Explanation answers "why is this node here and what surrounds it".
type Explanation struct {
	Node     graph.Node      `json:"node"`
	Incoming []ExplainedEdge `json:"incoming"`
	Outgoing []ExplainedEdge `json:"outgoing"`
	Source   *SourceSnippet  `json:"source,omitempty"`
	Notes    []string        `json:"notes"`
}

// Explain returns the node, its incoming/outgoing relations with a human reason and the
// source snippet.
func (x *Index) Explain(id string) (*Explanation, error) {
	node, err := x.Resolve(id)
	if err != nil {
		return nil, err
	}
	explanation := &Explanation{Node: node}
	for _, edge := range x.in[node.ID] {
		if other, ok := x.nodes[edge.From]; ok {
			explanation.Incoming = append(explanation.Incoming, ExplainedEdge{Edge: edge, Other: other, Why: whyEdge(edge, other, node)})
		}
	}
	for _, edge := range x.out[node.ID] {
		if other, ok := x.nodes[edge.To]; ok {
			explanation.Outgoing = append(explanation.Outgoing, ExplainedEdge{Edge: edge, Other: other, Why: whyEdge(edge, other, node)})
		}
	}
	if node.File != "" && node.Line > 0 {
		explanation.Source = sourceSnippet(x.Discovery.Root, node.File, node.Line)
	}
	if len(explanation.Incoming) == 0 && len(explanation.Outgoing) == 0 {
		explanation.Notes = append(explanation.Notes, "isolated node: no incoming or outgoing relation was found in the indexed sources")
	}
	return explanation, nil
}

func whyEdge(edge graph.Edge, other, node graph.Node) string {
	confidence := edge.Confidence
	if confidence == "" {
		confidence = graph.ConfidenceDerived
	}
	detail := edge.Detail
	if detail == "" {
		detail = "no extra detail"
	}
	return fmt.Sprintf("%s %s %s (%s; %s)", other.Label, edge.Kind, node.Label, detail, confidence)
}

func sourceSnippet(root, rel string, line int) *SourceSnippet {
	path := filepath.Join(root, filepath.FromSlash(rel))
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	start := max(0, line-3)
	end := min(len(lines), line+5)
	snippet := &SourceSnippet{File: rel, Line: line}
	for index := start; index < end; index++ {
		snippet.Lines = append(snippet.Lines, fmt.Sprintf("%d: %s", index+1, lines[index]))
	}
	return snippet
}
