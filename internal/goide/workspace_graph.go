package goide

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
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
	fresh    graphFreshness
}

// graphFreshness evita di ripercorrere l'albero ad ogni richiesta: il watcher incrementa la generazione di una
// sessione quando cambia qualcosa che il grafo legge; il grafo è "pulito" se è stato verificato alla generazione corrente.
type graphFreshness struct {
	generation map[string]uint64
	verified   map[string]uint64
}

func (f *graphFreshness) bump(sessionID string) {
	if f.generation == nil {
		f.generation = map[string]uint64{}
	}
	f.generation[sessionID]++
}

func (f *graphFreshness) current(sessionID string) uint64 { return f.generation[sessionID] }

func (f *graphFreshness) markVerified(sessionID string, generation uint64) {
	if f.verified == nil {
		f.verified = map[string]uint64{}
	}
	f.verified[sessionID] = generation
}

func (f *graphFreshness) isClean(sessionID string) bool {
	verified, ok := f.verified[sessionID]
	return ok && verified == f.generation[sessionID]
}

func (f *graphFreshness) forget(sessionID string) {
	delete(f.generation, sessionID)
	delete(f.verified, sessionID)
}

// graphRelevant dice se il batch può cambiare il grafo: un file sorgente/compose modificato, o qualunque
// creazione, eliminazione o rinomina (anche di cartelle), o un overflow del watcher.
func graphRelevant(batch FilesChanged) bool {
	if batch.Overflow || batch.Limited {
		return true
	}
	for _, change := range batch.Changes {
		if change.Kind != FileChanged || isGoSource(change.RelativePath) {
			return true
		}
	}
	return false
}

// noteGraphChanges è chiamata dal watcher per ogni batch.
func (s *Service) noteGraphChanges(sessionID SessionID, batch FilesChanged) {
	if !graphRelevant(batch) {
		return
	}
	graphs := s.graphs()
	graphs.mu.Lock()
	graphs.fresh.bump(string(sessionID))
	graphs.mu.Unlock()
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

// graphBuilderVersion entra nell'impronta: un grafo salvato da un builder più vecchio
// (meno nodi o archi) si ricostruisce anche se i sorgenti non sono cambiati.
const graphBuilderVersion = "9"

func isGoSource(rel string) bool {
	return strings.HasSuffix(rel, ".go") || strings.HasSuffix(rel, "/go.mod") || rel == "go.mod" || rel == "go.work" || graph.IsComposeFile(rel)
}

// workspaceGraph restituisce il grafo aggiornato della sessione: memoria, poi disco, poi ricostruzione.
func (s *Service) workspaceGraph(sessionID string, force bool) (*cachedGraph, bool, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, false, err
	}
	root := session.Project.RealPath
	graphs := s.graphs()
	var lock *sync.Mutex
	var store *graph.Store
	if !s.workspace.whileOpen(SessionID(sessionID), func() {
		graphs.mu.Lock()
		defer graphs.mu.Unlock()
		lock = graphs.building[sessionID]
		if lock == nil {
			lock = &sync.Mutex{}
			graphs.building[sessionID] = lock
		}
		store = graphs.store
	}) {
		return nil, false, errors.New("Go Studio session not found")
	}
	lock.Lock()
	defer lock.Unlock()

	// Percorso veloce: con il watcher completo e nessuna modifica rilevante dall'ultima verifica il grafo
	// in memoria è ancora valido e l'albero non va ripercorso.
	graphs.mu.Lock()
	startGeneration := graphs.fresh.current(sessionID)
	fastEntry := graphs.cached[sessionID]
	clean := graphs.fresh.isClean(sessionID)
	graphs.mu.Unlock()
	status := s.watcher.Status(SessionID(sessionID))
	watchedFully := status.Watching && !status.Limited
	if !force && clean && fastEntry != nil && watchedFully {
		return fastEntry, true, nil
	}
	verified := func(entry *cachedGraph, cached bool) (*cachedGraph, bool, error) {
		if watchedFully {
			graphs.mu.Lock()
			graphs.fresh.markVerified(sessionID, startGeneration)
			graphs.mu.Unlock()
		}
		return entry, cached, nil
	}

	fingerprint, err := graph.Fingerprint(root, isGoSource)
	if err != nil {
		return nil, false, err
	}
	fingerprint = graphBuilderVersion + ":" + fingerprint
	if !force {
		graphs.mu.Lock()
		current := graphs.cached[sessionID]
		graphs.mu.Unlock()
		if current != nil && current.graph.Fingerprint == fingerprint {
			return verified(current, true)
		}
		if saved, ok := store.Load(root, "go"); ok && saved.Fingerprint == fingerprint {
			return verified(s.remember(sessionID, saved), true)
		}
	}
	result, err := s.AnalyzeArchitecture(sessionID)
	if err != nil {
		return nil, false, err
	}
	builder := golang.GraphFromArchitecture(result.Report)
	graph.AddComposeServices(builder, root, graph.FindComposeFiles(root))
	built := builder.Graph()
	built.Root, built.Language, built.Fingerprint, built.BuiltAt = root, "go", fingerprint, time.Now()
	built.Truncated, built.Problems = result.Report.Truncated, result.Problems
	_ = store.Save(built) // ponytail: un grafo non salvato si ricostruisce al prossimo avvio
	return verified(s.remember(sessionID, built), false)
}

func (s *Service) remember(sessionID string, g graph.Graph) *cachedGraph {
	entry := &cachedGraph{graph: g, index: graph.NewIndex(&g)}
	graphs := s.graphs()
	s.workspace.whileOpen(SessionID(sessionID), func() {
		graphs.mu.Lock()
		graphs.cached[sessionID] = entry
		graphs.mu.Unlock()
	})
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
	file := strings.ReplaceAll(relPath, "\\", "/")
	if path.Base(file) == "go.mod" {
		if dependency, ok := s.requiredModuleAt(sessionID, file, line); ok {
			if impact, ok := entry.index.Impact("dep:" + dependency); ok {
				return impact, nil
			}
			if impact, ok := entry.index.ModuleImpact("mod:" + dependency); ok { // replace locale / go.work
				return impact, nil
			}
			return graph.Impact{}, fmt.Errorf("%s is not imported by the analysed packages", dependency)
		}
		return graph.Impact{}, errors.New("place the cursor on a require line of go.mod")
	}
	if typ, ok := entry.index.TypeAt(file, line); ok {
		impact, _ := entry.index.Impact(typ.ID)
		return impact, nil
	}
	function, ok := entry.index.FunctionAt(file, line)
	if !ok {
		return graph.Impact{}, errors.New("no function at this position: place the cursor inside a function, a method or a request/response type")
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

// requiredModuleAt legge il modulo citato alla riga line di go.mod ("require x v1" o "x v1" nel blocco).
func (s *Service) requiredModuleAt(sessionID, relPath string, line int) (string, bool) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", false
	}
	data, err := os.ReadFile(filepath.Join(session.Project.RealPath, filepath.FromSlash(relPath)))
	if err != nil {
		return "", false
	}
	lines := strings.Split(string(data), "\n")
	if line < 1 || line > len(lines) {
		return "", false
	}
	fields := strings.Fields(strings.TrimPrefix(strings.TrimSpace(lines[line-1]), "require"))
	if len(fields) < 2 || fields[0] == "(" || strings.HasPrefix(fields[0], "//") {
		return "", false
	}
	return fields[0], true
}

// GraphSearchReady cerca solo in un grafo già costruito (in memoria o salvato), senza
// ricostruirlo: Search Everywhere non deve attendere l'analisi del progetto.
func (s *Service) GraphSearchReady(sessionID, query string, kinds []string, limit int) ([]graph.Node, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	graphs := s.graphs()
	graphs.mu.Lock()
	entry := graphs.cached[sessionID]
	store := graphs.store
	graphs.mu.Unlock()
	if entry == nil {
		saved, ok := store.Load(session.Project.RealPath, "go")
		if !ok {
			return []graph.Node{}, nil
		}
		entry = s.remember(sessionID, saved)
	}
	if limit <= 0 || limit > 50 {
		limit = 8
	}
	nodes := entry.index.Search(query, kinds, limit)
	if nodes == nil {
		nodes = []graph.Node{}
	}
	return nodes, nil
}

// FindingLocation è dove sta un finding di sicurezza (o qualunque segnalazione su file:riga).
type FindingLocation struct {
	Fingerprint string `json:"fingerprint"`
	File        string `json:"file"`
	Line        int    `json:"line"`
}

// SecurityExposure dice da quali ingressi pubblici (route HTTP, metodi gRPC, topic consumati,
// entry point) si arriva alla funzione che contiene il finding: un finding raggiungibile da
// una route è più urgente di uno in codice morto o solo interno.
type SecurityExposure struct {
	Fingerprint string      `json:"fingerprint"`
	Function    string      `json:"function,omitempty"`
	Public      []graph.Ref `json:"public"`
	Entries     []graph.Ref `json:"entries"`
}

// SecurityExposures incrocia i finding con il workspace graph.
func (s *Service) SecurityExposures(sessionID string, locations []FindingLocation) ([]SecurityExposure, error) {
	entry, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return nil, err
	}
	out := make([]SecurityExposure, 0, len(locations))
	for _, location := range locations {
		exposure := SecurityExposure{Fingerprint: location.Fingerprint, Public: []graph.Ref{}, Entries: []graph.Ref{}}
		if function, ok := entry.index.FunctionAt(strings.ReplaceAll(location.File, "\\", "/"), location.Line); ok {
			exposure.Function = function.Label
			if impact, ok := entry.index.Impact(function.ID); ok {
				exposure.Public = append(append(append(exposure.Public, impact.Endpoints...), impact.RPCs...), impact.Consumers...)
				exposure.Entries = append(exposure.Entries, impact.Entries...)
			}
		}
		out = append(out, exposure)
	}
	return out, nil
}

// GraphRiskMap è il rischio di modifica per package (Risk map dell'Impact).
type GraphRiskMap struct {
	Packages  []graph.PackageRisk `json:"packages"`
	Truncated bool                `json:"truncated,omitempty"`
}

// RiskMap calcola il rischio di ogni funzione del progetto, raggruppato per package.
func (s *Service) RiskMap(sessionID string) (GraphRiskMap, error) {
	entry, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return GraphRiskMap{}, err
	}
	packages, truncated := entry.index.RiskMap()
	return GraphRiskMap{Packages: packages, Truncated: truncated}, nil
}

// ArchitectureDrift confronta il workspace graph con .adomnia/architecture.json (se c'è).
func (s *Service) ArchitectureDrift(sessionID string) (graph.DriftReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return graph.DriftReport{}, err
	}
	rules, found, err := graph.LoadRules(session.Project.RealPath)
	if err != nil {
		return graph.DriftReport{}, err
	}
	entry, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return graph.DriftReport{}, err
	}
	return entry.index.CheckDrift(rules, found), nil
}

// CreateArchitectureRules scrive il modello di regole se il progetto non ne ha; restituisce il percorso.
func (s *Service) CreateArchitectureRules(sessionID string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	path := filepath.Join(session.Project.RealPath, filepath.FromSlash(graph.RulesFile))
	if _, err := os.Stat(path); err == nil {
		return graph.RulesFile, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(graph.RulesTemplate), 0o644); err != nil {
		return "", err
	}
	return graph.RulesFile, nil
}

// PackageHeatmap: metriche statiche dei package e import del progetto, per la heatmap delle dipendenze.
type PackageHeatmap struct {
	Packages []graph.PackageMetric `json:"packages"`
	Imports  [][2]string           `json:"imports"`
}

func (s *Service) PackageHeatmap(sessionID string) (PackageHeatmap, error) {
	entry, _, err := s.workspaceGraph(sessionID, false)
	if err != nil {
		return PackageHeatmap{}, err
	}
	packages, imports := entry.index.PackageMetrics()
	if imports == nil {
		imports = [][2]string{}
	}
	return PackageHeatmap{Packages: packages, Imports: imports}, nil
}
