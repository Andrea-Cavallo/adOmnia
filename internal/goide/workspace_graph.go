package goide

import (
	"errors"
	"strings"
	"sync"
	"time"

	"adomnia/internal/ide/graph"
	"adomnia/internal/languages/golang"
)

// Semantic Workspace Graph: costruito dal report dell'Architecture Explorer, salvato su disco
// e riusato finché i sorgenti Go non cambiano. Impact e contesto AI lo interrogano.

type workspaceGraphs struct {
	mu       sync.Mutex
	building map[string]*sync.Mutex // una costruzione per sessione
	cached   map[string]*cachedGraph
	store    *graph.Store
}

type cachedGraph struct {
	graph graph.Graph
	index *graph.Index
}

// GraphSummary è ciò che serve alla UI per sapere com'è il grafo, senza spedirlo tutto.
type GraphSummary struct {
	Root      string         `json:"root"`
	BuiltAt   time.Time      `json:"builtAt"`
	Stats     map[string]int `json:"stats"`
	Edges     int            `json:"edges"`
	Truncated bool           `json:"truncated,omitempty"`
	Problems  []string       `json:"problems"`
	Cached    bool           `json:"cached"`
}

func (s *Service) graphs() *workspaceGraphs {
	s.graphOnce.Do(func() {
		s.graphState = &workspaceGraphs{building: map[string]*sync.Mutex{}, cached: map[string]*cachedGraph{}}
	})
	return s.graphState
}

// ConfigureGraphStore indica dove salvare i grafi (cartella dati di adOmnia).
func (s *Service) ConfigureGraphStore(dir string) {
	graphs := s.graphs()
	graphs.mu.Lock()
	graphs.store = graph.NewStore(dir)
	graphs.mu.Unlock()
}

func isGoSource(rel string) bool {
	return strings.HasSuffix(rel, ".go") || strings.HasSuffix(rel, "/go.mod") || rel == "go.mod" || rel == "go.work"
}

// workspaceGraph restituisce il grafo aggiornato della sessione: memoria, poi disco, poi ricostruzione.
func (s *Service) workspaceGraph(sessionID string, force bool) (*cachedGraph, bool, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, false, err
	}
	root := session.Project.RealPath
	graphs := s.graphs()
	graphs.mu.Lock()
	lock, ok := graphs.building[sessionID]
	if !ok {
		lock = &sync.Mutex{}
		graphs.building[sessionID] = lock
	}
	store := graphs.store
	graphs.mu.Unlock()
	lock.Lock()
	defer lock.Unlock()

	fingerprint, err := graph.Fingerprint(root, isGoSource)
	if err != nil {
		return nil, false, err
	}
	if !force {
		graphs.mu.Lock()
		current := graphs.cached[sessionID]
		graphs.mu.Unlock()
		if current != nil && current.graph.Fingerprint == fingerprint {
			return current, true, nil
		}
		if saved, ok := store.Load(root, "go"); ok && saved.Fingerprint == fingerprint {
			return s.remember(sessionID, saved), true, nil
		}
	}
	result, err := s.AnalyzeArchitecture(sessionID)
	if err != nil {
		return nil, false, err
	}
	built := golang.GraphFromArchitecture(result.Report).Graph()
	built.Root, built.Language, built.Fingerprint, built.BuiltAt = root, "go", fingerprint, time.Now()
	built.Truncated, built.Problems = result.Report.Truncated, result.Problems
	_ = store.Save(built) // ponytail: un grafo non salvato si ricostruisce al prossimo avvio
	return s.remember(sessionID, built), false, nil
}

func (s *Service) remember(sessionID string, g graph.Graph) *cachedGraph {
	entry := &cachedGraph{graph: g, index: graph.NewIndex(&g)}
	graphs := s.graphs()
	graphs.mu.Lock()
	graphs.cached[sessionID] = entry
	graphs.mu.Unlock()
	return entry
}

func summary(entry *cachedGraph, cached bool) GraphSummary {
	problems := entry.graph.Problems
	if problems == nil {
		problems = []string{}
	}
	return GraphSummary{Root: entry.graph.Root, BuiltAt: entry.graph.BuiltAt, Stats: entry.graph.Stats(), Edges: len(entry.graph.Edges), Truncated: entry.graph.Truncated, Problems: problems, Cached: cached}
}

// WorkspaceGraphSummary costruisce (se serve) il grafo e ne restituisce il riassunto.
func (s *Service) WorkspaceGraphSummary(sessionID string, rebuild bool) (GraphSummary, error) {
	entry, cached, err := s.workspaceGraph(sessionID, rebuild)
	if err != nil {
		return GraphSummary{}, err
	}
	return summary(entry, cached), nil
}

// WorkspaceGraph restituisce il grafo intero (visualizzazione, export).
func (s *Service) WorkspaceGraph(sessionID string) (graph.Graph, error) {
	entry, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return graph.Graph{}, err
	}
	return entry.graph, nil
}

// GraphImpact calcola l'impatto di una modifica alla funzione che contiene relPath:line.
func (s *Service) GraphImpact(sessionID, relPath string, line int) (graph.Impact, error) {
	entry, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return graph.Impact{}, err
	}
	function, ok := entry.index.FunctionAt(strings.ReplaceAll(relPath, "\\", "/"), line)
	if !ok {
		return graph.Impact{}, errors.New("no function at this position: place the cursor inside a function or method")
	}
	impact, _ := entry.index.Impact(function.ID)
	return impact, nil
}

// GraphImpactOf calcola l'impatto di un nodo già noto (dalla ricerca o da un altro impatto).
func (s *Service) GraphImpactOf(sessionID, nodeID string) (graph.Impact, error) {
	entry, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return graph.Impact{}, err
	}
	impact, ok := entry.index.Impact(nodeID)
	if !ok {
		return graph.Impact{}, errors.New("this element is no longer in the workspace graph")
	}
	return impact, nil
}

// GraphSearch cerca nodi per nome (navigazione veloce, contesto AI).
func (s *Service) GraphSearch(sessionID, query string, kinds []string, limit int) ([]graph.Node, error) {
	entry, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	nodes := entry.index.Search(query, kinds, limit)
	if nodes == nil {
		nodes = []graph.Node{}
	}
	return nodes, nil
}
