package graph

import (
	"sort"
	"strconv"
	"strings"
)

// Index precalcola le adiacenze per rispondere alle query senza ripercorrere il grafo intero.
type Index struct {
	graph *Graph
	byID  map[string]Node
	out   map[string][]Edge
	in    map[string][]Edge
}

func NewIndex(g *Graph) *Index {
	index := &Index{graph: g, byID: make(map[string]Node, len(g.Nodes)), out: map[string][]Edge{}, in: map[string][]Edge{}}
	for _, node := range g.Nodes {
		index.byID[node.ID] = node
	}
	for _, edge := range g.Edges {
		index.out[edge.From] = append(index.out[edge.From], edge)
		index.in[edge.To] = append(index.in[edge.To], edge)
	}
	return index
}

func (x *Index) Node(id string) (Node, bool) { node, ok := x.byID[id]; return node, ok }

// Out e In restituiscono gli archi uscenti/entranti di un tipo ("" = tutti).
func (x *Index) Out(id, kind string) []Edge { return filterEdges(x.out[id], kind) }
func (x *Index) In(id, kind string) []Edge  { return filterEdges(x.in[id], kind) }

func filterEdges(edges []Edge, kind string) []Edge {
	if kind == "" {
		return edges
	}
	var out []Edge
	for _, edge := range edges {
		if edge.Kind == kind {
			out = append(out, edge)
		}
	}
	return out
}

func isCode(kind string) bool {
	return kind == KindFunction || kind == KindMethod || kind == KindTest
}

// FunctionAt trova la funzione che contiene file:line (quella con l'inizio più vicino sopra la riga).
// ponytail: senza la riga di fine una funzione annidata dopo la fine della precedente è ambigua; basta per l'editor.
func (x *Index) FunctionAt(file string, line int) (Node, bool) {
	var best Node
	found := false
	for _, node := range x.graph.Nodes {
		if !isCode(node.Kind) || node.File != file || node.Line > line {
			continue
		}
		if !found || node.Line > best.Line {
			best, found = node, true
		}
	}
	return best, found
}

// Ref è un nodo raggiunto da un'analisi, con la distanza (1 = diretto) e il percorso più corto.
type Ref struct {
	Node  Node     `json:"node"`
	Depth int      `json:"depth"`
	Via   []string `json:"via,omitempty"` // etichette dei nodi intermedi, dal più vicino al target
}

// Impact è ciò che una modifica al target può rompere.
type Impact struct {
	Target     Node     `json:"target"`
	Callers    []Ref    `json:"callers"`    // chiamanti diretti e indiretti (anche via interfaccia)
	Interfaces []Ref    `json:"interfaces"` // contratti che il target implementa
	Tests      []Ref    `json:"tests"`      // test che raggiungono il target
	Endpoints  []Ref    `json:"endpoints"`  // route HTTP servite da codice che raggiunge il target
	RPCs       []Ref    `json:"rpcs"`
	Consumers  []Ref    `json:"consumers"` // topic consumati da codice che raggiunge il target
	Entries    []Ref    `json:"entries"`   // main/job/cli che arrivano al target
	Packages   []string `json:"packages"`
	Modules    []string `json:"modules"`
	// Ciò che il target stesso tocca: cambiarlo cambia questi accessi.
	Produces []Ref `json:"produces"`
	Queries  []Ref `json:"queries"`
	Reads    []Ref `json:"reads"`
	Callees  []Ref `json:"callees"`
	// Risk: low | medium | high, con i motivi leggibili.
	Risk        string   `json:"risk"`
	RiskReasons []string `json:"riskReasons"`
	Truncated   bool     `json:"truncated,omitempty"`
}

const maxImpactDepth = 12
const maxImpactNodes = 5000

// Impact calcola l'impatto di una modifica al nodo id (funzione, metodo o test).
func (x *Index) Impact(id string) (Impact, bool) {
	target, ok := x.byID[id]
	if !ok {
		return Impact{}, false
	}
	result := Impact{Target: target}
	// Risalita: chi chiama il target, anche attraverso il metodo d'interfaccia che lo smista.
	upstream := x.walk(id, func(node string) []string {
		var next []string
		for _, edge := range x.in[node] {
			if edge.Kind == EdgeCalls || edge.Kind == EdgeDispatches {
				next = append(next, edge.From)
			}
		}
		return next
	}, &result.Truncated)
	reached := map[string]int{id: 0}
	for _, ref := range upstream {
		reached[ref.Node.ID] = ref.Depth
		switch ref.Node.Kind {
		case KindTest:
			result.Tests = append(result.Tests, ref)
		case KindInterface:
		default:
			if ref.Node.Attrs["abstract"] == "true" {
				result.Interfaces = append(result.Interfaces, ref)
				continue
			}
			result.Callers = append(result.Callers, ref)
		}
	}
	if target.Kind == KindTest {
		result.Tests = append([]Ref{{Node: target}}, result.Tests...)
	}
	packages, modules := map[string]bool{}, map[string]bool{}
	for nodeID, depth := range reached {
		node := x.byID[nodeID]
		if node.Package != "" {
			packages[node.Package] = true
			if module := node.Attrs["module"]; module != "" {
				modules[module] = true
			}
		}
		for _, edge := range x.out[nodeID] {
			to := x.byID[edge.To]
			ref := Ref{Node: to, Depth: depth}
			switch edge.Kind {
			case EdgeHandles:
				if to.Kind == KindRPC {
					result.RPCs = append(result.RPCs, ref)
				} else {
					result.Endpoints = append(result.Endpoints, ref)
				}
			case EdgeConsumes:
				result.Consumers = append(result.Consumers, ref)
			}
		}
		for _, edge := range x.in[nodeID] {
			if edge.Kind == EdgeStarts {
				result.Entries = append(result.Entries, Ref{Node: x.byID[edge.From], Depth: depth + 1})
			}
		}
	}
	for _, edge := range x.out[id] {
		to := x.byID[edge.To]
		ref := Ref{Node: to, Depth: 1}
		if edge.Detail != "" {
			ref.Via = []string{edge.Detail}
		}
		switch edge.Kind {
		case EdgeProduces:
			result.Produces = append(result.Produces, ref)
		case EdgeQueries:
			result.Queries = append(result.Queries, ref)
		case EdgeReads:
			result.Reads = append(result.Reads, ref)
		case EdgeCalls:
			result.Callees = append(result.Callees, ref)
		}
	}
	result.Packages = sortedKeys(packages)
	result.Modules = sortedKeys(modules)
	for _, list := range []*[]Ref{&result.Callers, &result.Interfaces, &result.Tests, &result.Endpoints, &result.RPCs, &result.Consumers, &result.Entries, &result.Produces, &result.Queries, &result.Reads, &result.Callees} {
		*list = dedupeRefs(*list)
	}
	result.Risk, result.RiskReasons = risk(result)
	return result, true
}

// walk è una BFS dal nodo start lungo next; restituisce i nodi raggiunti con distanza e percorso.
func (x *Index) walk(start string, next func(string) []string, truncated *bool) []Ref {
	type step struct {
		id    string
		depth int
		via   []string
	}
	seen := map[string]bool{start: true}
	queue := []step{{id: start}}
	var out []Ref
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current.depth >= maxImpactDepth {
			*truncated = true
			continue
		}
		for _, id := range next(current.id) {
			if seen[id] {
				continue
			}
			if len(seen) >= maxImpactNodes {
				*truncated = true
				return out
			}
			seen[id] = true
			node := x.byID[id]
			via := current.via
			if current.id != start {
				via = append(append([]string(nil), current.via...), x.byID[current.id].Label)
			}
			out = append(out, Ref{Node: node, Depth: current.depth + 1, Via: via})
			queue = append(queue, step{id: id, depth: current.depth + 1, via: via})
		}
	}
	return out
}

func dedupeRefs(refs []Ref) []Ref {
	best := map[string]Ref{}
	for _, ref := range refs {
		if current, ok := best[ref.Node.ID]; !ok || ref.Depth < current.Depth {
			best[ref.Node.ID] = ref
		}
	}
	out := make([]Ref, 0, len(best))
	for _, ref := range best {
		out = append(out, ref)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Depth != out[j].Depth {
			return out[i].Depth < out[j].Depth
		}
		return out[i].Node.Label < out[j].Node.Label
	})
	return out
}

func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// risk è un'euristica spiegata: più superficie pubblica e meno test = più rischio.
func risk(impact Impact) (string, []string) {
	score := 0
	var reasons []string
	add := func(points int, reason string) {
		score += points
		reasons = append(reasons, reason)
	}
	if len(impact.Tests) == 0 {
		add(3, "no test reaches this code")
	}
	if n := len(impact.Endpoints) + len(impact.RPCs); n > 0 {
		add(2, plural(n, "public API depends", "public APIs depend")+" on it")
	}
	if n := len(impact.Consumers); n > 0 {
		add(2, plural(n, "message consumer depends", "message consumers depend")+" on it")
	}
	if n := len(impact.Callers); n >= 20 {
		add(2, plural(n, "caller", "callers")+" up the call graph")
	} else if n >= 5 {
		add(1, plural(n, "caller", "callers")+" up the call graph")
	}
	if len(impact.Interfaces) > 0 {
		add(1, "implements an interface: every caller of the contract is affected")
	}
	if len(impact.Produces)+len(impact.Queries) > 0 {
		add(1, "writes to shared resources (topics or tables)")
	}
	if len(impact.Modules) > 1 {
		add(1, "crosses module boundaries")
	}
	switch {
	case score >= 5:
		return "high", reasons
	case score >= 2:
		return "medium", reasons
	}
	if len(reasons) == 0 {
		reasons = []string{"covered by tests and not reachable from public entry points"}
	}
	return "low", reasons
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}

// Search trova nodi per etichetta (case-insensitive), i nomi esatti prima.
func (x *Index) Search(query string, kinds []string, limit int) []Node {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return nil
	}
	allowed := map[string]bool{}
	for _, kind := range kinds {
		allowed[kind] = true
	}
	var exact, partial []Node
	for _, node := range x.graph.Nodes {
		if len(allowed) > 0 && !allowed[node.Kind] {
			continue
		}
		label := strings.ToLower(node.Label)
		switch {
		case label == query || strings.HasSuffix(label, "."+query):
			exact = append(exact, node)
		case strings.Contains(label, query):
			partial = append(partial, node)
		}
	}
	out := append(exact, partial...)
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
