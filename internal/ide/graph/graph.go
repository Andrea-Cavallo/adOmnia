// Package graph è il Semantic Workspace Graph: le relazioni del progetto (package, funzioni,
// tipi, test, endpoint, topic, tabelle, variabili d'ambiente…) in un grafo che sopravvive al
// riavvio. È indipendente dal linguaggio: ogni adapter lo riempie dal proprio analizzatore.
package graph

import (
	"sort"
	"time"
)

// Tipi di nodo. Un adapter può usarne altri: il core li tratta come opachi.
const (
	KindModule    = "module"
	KindPackage   = "package"
	KindFile      = "file"
	KindFunction  = "function"
	KindMethod    = "method"
	KindInterface = "interface"
	KindType      = "type"
	KindTest      = "test"
	KindEndpoint  = "endpoint" // route HTTP
	KindRPC       = "rpc"      // servizio gRPC
	KindTopic     = "topic"
	KindTable     = "table"
	KindEnvVar    = "envvar"
	KindEntry     = "entry" // main, init, job, cli
)

// Tipi di arco: From → To si legge "From <kind> To".
const (
	EdgeContains   = "contains"   // package → funzione/tipo, modulo → package
	EdgeImports    = "imports"    // package → package
	EdgeRequires   = "requires"   // modulo → modulo
	EdgeCalls      = "calls"      // funzione → funzione
	EdgeDispatches = "dispatches" // metodo d'interfaccia → implementazione (chiamata dinamica)
	EdgeImplements = "implements" // tipo → interfaccia
	EdgeHandles    = "handles"    // funzione → endpoint/rpc
	EdgeProduces   = "produces"   // funzione → topic
	EdgeConsumes   = "consumes"   // funzione → topic
	EdgeQueries    = "queries"    // funzione → tabella
	EdgeReads      = "reads"      // funzione → variabile d'ambiente
	EdgeStarts     = "starts"     // entry → funzione
)

// Node è un elemento del progetto, con la posizione da cui viene.
type Node struct {
	ID      string            `json:"id"`
	Kind    string            `json:"kind"`
	Label   string            `json:"label"`
	Package string            `json:"package,omitempty"`
	File    string            `json:"file,omitempty"` // relativo alla root, separatore /
	Line    int               `json:"line,omitempty"`
	Attrs   map[string]string `json:"attrs,omitempty"`
}

type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
	// Detail qualifica l'arco: operazione SQL, ruolo del topic…
	Detail string `json:"detail,omitempty"`
}

// Graph è il grafo di un progetto. Fingerprint identifica lo stato dei sorgenti da cui è nato.
type Graph struct {
	Root        string    `json:"root"`
	Language    string    `json:"language"`
	Fingerprint string    `json:"fingerprint"`
	BuiltAt     time.Time `json:"builtAt"`
	Nodes       []Node    `json:"nodes"`
	Edges       []Edge    `json:"edges"`
	Truncated   bool      `json:"truncated,omitempty"`
	Problems    []string  `json:"problems,omitempty"`
}

// Builder accumula nodi e archi senza duplicati.
type Builder struct {
	nodes map[string]Node
	edges map[Edge]bool
}

func NewBuilder() *Builder {
	return &Builder{nodes: map[string]Node{}, edges: map[Edge]bool{}}
}

// Node aggiunge un nodo; se esiste già vince il primo, ma i campi vuoti vengono completati.
func (b *Builder) Node(node Node) {
	current, ok := b.nodes[node.ID]
	if !ok {
		b.nodes[node.ID] = node
		return
	}
	if current.File == "" {
		current.File, current.Line = node.File, node.Line
	}
	if current.Package == "" {
		current.Package = node.Package
	}
	b.nodes[node.ID] = current
}

// Has dice se il nodo è già nel grafo.
func (b *Builder) Has(id string) bool { _, ok := b.nodes[id]; return ok }

// Edge aggiunge un arco fra nodi esistenti; gli archi verso nodi ignoti sono scartati.
func (b *Builder) Edge(from, to, kind, detail string) {
	if from == to || !b.Has(from) || !b.Has(to) {
		return
	}
	b.edges[Edge{From: from, To: to, Kind: kind, Detail: detail}] = true
}

// Graph restituisce il grafo ordinato (stabile, quindi confrontabile e salvabile).
func (b *Builder) Graph() Graph {
	graph := Graph{Nodes: make([]Node, 0, len(b.nodes)), Edges: make([]Edge, 0, len(b.edges))}
	for _, node := range b.nodes {
		graph.Nodes = append(graph.Nodes, node)
	}
	for edge := range b.edges {
		graph.Edges = append(graph.Edges, edge)
	}
	sort.Slice(graph.Nodes, func(i, j int) bool { return graph.Nodes[i].ID < graph.Nodes[j].ID })
	sort.Slice(graph.Edges, func(i, j int) bool {
		a, b := graph.Edges[i], graph.Edges[j]
		if a.From != b.From {
			return a.From < b.From
		}
		if a.To != b.To {
			return a.To < b.To
		}
		return a.Kind < b.Kind
	})
	return graph
}

// Stats conta i nodi per tipo (per la UI e per i test).
func (g Graph) Stats() map[string]int {
	stats := map[string]int{}
	for _, node := range g.Nodes {
		stats[node.Kind]++
	}
	return stats
}
