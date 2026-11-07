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
	KindModule     = "module"
	KindPackage    = "package"
	KindFile       = "file"
	KindFunction   = "function"
	KindMethod     = "method"
	KindInterface  = "interface"
	KindType       = "type"
	KindTest       = "test"
	KindEndpoint   = "endpoint" // route HTTP
	KindRPC        = "rpc"      // servizio gRPC
	KindTopic      = "topic"
	KindSocket     = "websocket" // URL a cui il codice si collega in WebSocket
	KindTable      = "table"
	KindEnvVar     = "envvar"
	KindConfig     = "config"     // chiave di configurazione (viper, koanf)
	KindDependency = "dependency" // modulo esterno richiesto da go.mod
	KindStdlib     = "stdlib"     // package della libreria standard importato dal progetto
	KindEntry      = "entry"      // main, init, job, cli
	// Flow Intelligence: il percorso di esecuzione, non solo la dipendenza.
	KindFlow           = "flow"            // flow dichiarato (config, XML, annotazione)
	KindSubflow        = "subflow"         // subflow richiamato da un flow
	KindBundle         = "bundle"          // bundle OSGi/PDE
	KindActivator      = "activator"       // Bundle-Activator
	KindExtensionPoint = "extension-point" // extension point di plugin.xml (registro Eclipse)
	KindExternal       = "external"        // SOAP, REST, database, coda: fuori dal workspace
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
	EdgeUses       = "uses"       // endpoint/tipo → tipo (DTO di richiesta/risposta, campo)
	// Flow Intelligence.
	EdgeFlowsTo  = "flows-to"   // flow → flow/subflow (chiamata dichiarata)
	EdgeInvokes  = "invokes"    // flow/metodo → metodo
	EdgeProvides = "provides"   // bundle → servizio
	EdgeRefers   = "references" // bundle/classe → servizio consumato
	EdgeCallsExt = "calls-ext"  // metodo → sistema esterno (SOAP/REST/DB/coda)
)

// Affidabilità di un collegamento: quanto è dimostrabile.
const (
	// ConfidenceDeclared: la relazione è scritta (config, XML, annotazione).
	ConfidenceDeclared = "declared"
	// ConfidenceDerived: il target è risolto nei sorgenti del workspace.
	ConfidenceDerived = "derived"
	// ConfidenceInferred: euristica (nome, import, unicità parziale).
	ConfidenceInferred = "inferred"
	// ConfidenceObserved: visto a runtime (trace).
	ConfidenceObserved = "observed"
)

// Node è un elemento del progetto, con la posizione da cui viene.
type Node struct {
	ID      string            `json:"id"`
	Kind    string            `json:"kind"`
	Label   string            `json:"label"`
	Package string            `json:"package,omitempty"`
	File    string            `json:"file,omitempty"` // relativo alla root, separatore /
	Line    int               `json:"line,omitzero"`
	Attrs   map[string]string `json:"attrs,omitempty"`
}

type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
	// Detail qualifica l'arco: operazione SQL, ruolo del topic…
	Detail string `json:"detail,omitempty"`
	// Confidence dice quanto è dimostrabile il collegamento (declared, derived, inferred, observed).
	// Gli archi senza valore sono intesi "derived" per i grafi esistenti.
	Confidence string `json:"confidence,omitempty"`
}

// Graph è il grafo di un progetto. Fingerprint identifica lo stato dei sorgenti da cui è nato.
type Graph struct {
	Root        string    `json:"root"`
	Language    string    `json:"language"`
	Fingerprint string    `json:"fingerprint"`
	BuiltAt     time.Time `json:"builtAt"`
	Nodes       []Node    `json:"nodes"`
	Edges       []Edge    `json:"edges"`
	Truncated   bool      `json:"truncated,omitzero"`
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

// EdgeWithConfidence aggiunge un arco con la sua affidabilità (Flow Intelligence).
func (b *Builder) EdgeWithConfidence(from, to, kind, detail, confidence string) {
	if from == to || !b.Has(from) || !b.Has(to) {
		return
	}
	b.edges[Edge{From: from, To: to, Kind: kind, Detail: detail, Confidence: confidence}] = true
}

// Annotate aggiunge un attributo a un nodo esistente (es. il bundle che contiene una classe),
// senza sostituire gli attributi già presenti.
func (b *Builder) Annotate(id, key, value string) {
	node, ok := b.nodes[id]
	if !ok || key == "" || value == "" {
		return
	}
	if node.Attrs == nil {
		node.Attrs = map[string]string{}
	}
	node.Attrs[key] = value
	b.nodes[id] = node
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
