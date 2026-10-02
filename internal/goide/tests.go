package goide

import (
	"bytes"
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	testUpdateInterval = 250 * time.Millisecond
	maxTestRunHistory  = 20
	maxTestPatterns    = 64
	maxTestRepeat      = 1000
)

var shuffleSeed = regexp.MustCompile(`^(on|-?\d{1,19})$`)

// TestRunRequest descrive un'esecuzione di `go test -json`: package, filtro -run, benchmark e coverage.
type TestRunRequest struct {
	SessionID SessionID `json:"sessionId"`
	// WorkingDirectory è la cartella del modulo, relativa al progetto ('' per la radice).
	WorkingDirectory string `json:"workingDirectory"`
	// Packages sono pattern relativi al modulo, es. "./..." o "./internal/api".
	Packages []string `json:"packages"`
	// Run è l'espressione regolare di -run; vuota esegue tutti i test.
	Run string `json:"run,omitempty"`
	// Bench abilita i benchmark con l'espressione indicata (i test vengono esclusi con -run ^$ se Run è vuoto).
	Bench    string `json:"bench,omitempty"`
	Coverage bool   `json:"coverage,omitempty"`
	// Race attiva il race detector (-race): i report finiscono in TestRunSnapshot.RaceReports.
	Race        bool              `json:"race,omitempty"`
	BuildTags   []string          `json:"buildTags,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	// Repeat esegue ogni test N volte (-count=N) per misurarne la flakiness; 0 o 1 = una volta.
	Repeat int `json:"repeat,omitempty"`
	// Shuffle è "on" per un ordine casuale o un seed numerico per riprodurlo (-shuffle).
	Shuffle string `json:"shuffle,omitempty"`
}

// TestRunSnapshot è lo stato di un'esecuzione di test; Results non include l'output dei singoli nodi.
type TestRunSnapshot struct {
	RunID     RunID          `json:"runId"`
	SessionID SessionID      `json:"sessionId"`
	Request   TestRunRequest `json:"request"`
	Command   string         `json:"command"`
	Status    string         `json:"status"`
	Summary   TestSummary    `json:"summary"`
	Results   []TestResult   `json:"results"`
	Overflow  bool           `json:"overflow,omitempty"`
	StartedAt time.Time      `json:"startedAt"`
	// FinishedAt è presente solo quando il processo di test è terminato; permette
	// di distinguere la durata reale della run dalla metrica ns/op del benchmark.
	FinishedAt *time.Time      `json:"finishedAt,omitempty"`
	Coverage   *CoverageReport `json:"coverage,omitempty"`
	// RaceReports sono i blocchi "WARNING: DATA RACE" completi, nell'ordine in cui go test li ha scritti.
	RaceReports []string `json:"raceReports,omitempty"`
}

type testRun struct {
	mu            sync.Mutex
	snapshot      TestRunSnapshot
	tree          *testTree
	pending       []byte
	dirty         bool
	moduleDir     string
	modulePath    string
	coverageFile  string
	finished      bool
	lastPublished time.Time
	races         raceCollector
}

// TestManager tiene gli alberi delle esecuzioni di test per sessione, con uno storico limitato.
type TestManager struct {
	mu   sync.Mutex
	runs map[RunID]*testRun
}

func NewTestManager() *TestManager {
	return &TestManager{runs: make(map[RunID]*testRun)}
}

// testArguments costruisce gli argomenti di go test senza shell, rifiutando espressioni non valide.
func testArguments(request TestRunRequest, coverageFile string) ([]string, error) {
	packages := request.Packages
	if len(packages) == 0 {
		packages = []string{"./..."}
	}
	if len(packages) > maxTestPatterns {
		return nil, fmt.Errorf("troppi package: massimo %d", maxTestPatterns)
	}
	for _, expression := range []string{request.Run, request.Bench} {
		if _, err := regexp.Compile(strings.ReplaceAll(expression, "/", "|")); err != nil {
			return nil, fmt.Errorf("espressione di filtro non valida %q: %w", expression, err)
		}
	}
	if request.Repeat < 0 || request.Repeat > maxTestRepeat {
		return nil, fmt.Errorf("ripetizioni non valide: da 1 a %d", maxTestRepeat)
	}
	if request.Shuffle != "" && !shuffleSeed.MatchString(request.Shuffle) {
		return nil, fmt.Errorf("shuffle non valido %q: usa \"on\" o un seed numerico", request.Shuffle)
	}
	arguments := []string{"test", "-json", fmt.Sprintf("-count=%d", max(1, request.Repeat))}
	if request.Shuffle != "" {
		arguments = append(arguments, "-shuffle="+request.Shuffle)
	}
	if len(request.BuildTags) > 0 {
		arguments = append(arguments, "-tags", strings.Join(request.BuildTags, ","))
	}
	if request.Race {
		arguments = append(arguments, "-race")
	}
	switch {
	case request.Run != "":
		arguments = append(arguments, "-run", request.Run)
	case request.Bench != "":
		arguments = append(arguments, "-run", "^$")
	}
	if request.Bench != "" {
		arguments = append(arguments, "-bench", request.Bench, "-benchmem")
	}
	if coverageFile != "" {
		arguments = append(arguments, "-coverprofile", coverageFile)
	}
	return append(arguments, packages...), nil
}

func (m *TestManager) register(run *testRun) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runs[run.snapshot.RunID] = run
	if len(m.runs) <= maxTestRunHistory {
		return
	}
	var oldest *testRun
	for _, candidate := range m.runs {
		candidate.mu.Lock()
		finished := candidate.finished
		candidate.mu.Unlock()
		if finished && (oldest == nil || candidate.snapshot.StartedAt.Before(oldest.snapshot.StartedAt)) {
			oldest = candidate
		}
	}
	if oldest != nil {
		delete(m.runs, oldest.snapshot.RunID)
	}
}

func (m *TestManager) run(runID RunID) (*testRun, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	run, ok := m.runs[runID]
	return run, ok
}

// consume divide lo stdout di go test in righe JSON complete e le applica all'albero.
func (run *testRun) consume(data []byte) {
	run.mu.Lock()
	defer run.mu.Unlock()
	run.pending = append(run.pending, data...)
	for {
		newline := bytes.IndexByte(run.pending, '\n')
		if newline < 0 {
			break
		}
		run.tree.apply(run.pending[:newline])
		run.races.consumeJSON(run.pending[:newline])
		run.pending = run.pending[newline+1:]
		run.dirty = true
	}
}

// publishable restituisce lo snapshot da inviare se è cambiato e l'intervallo minimo è trascorso.
func (run *testRun) publishable(force bool) (TestRunSnapshot, bool) {
	run.mu.Lock()
	defer run.mu.Unlock()
	if !force && (!run.dirty || time.Since(run.lastPublished) < testUpdateInterval) {
		return TestRunSnapshot{}, false
	}
	run.dirty = false
	run.lastPublished = time.Now()
	return run.snapshotLocked(false), true
}

func (run *testRun) snapshotLocked(withOutput bool) TestRunSnapshot {
	results, summary := run.tree.snapshot()
	for index := range results {
		if !withOutput {
			results[index].Output = ""
		}
		if results[index].Name == "" {
			results[index].Directory = run.packageDirectory(results[index].Package)
		}
		if failure := results[index].Failure; failure != nil {
			resolved := *failure
			resolved.RelativePath = run.resolveFailure(results[index], failure.File)
			results[index].Failure = &resolved
		}
	}
	snapshot := run.snapshot
	snapshot.Results = results
	snapshot.Summary = summary
	snapshot.Overflow = run.tree.overflowed
	snapshot.RaceReports = run.races.reports()
	return snapshot
}

// resolveFailure porta il file citato nel fallimento a un percorso relativo al progetto:
// gli errori di build sono relativi al modulo, le righe dei test alla cartella del package.
func (run *testRun) resolveFailure(result TestResult, file string) string {
	file = filepath.ToSlash(file)
	if result.BuildFailed || strings.Contains(file, "/") {
		return path.Clean(path.Join(run.moduleDir, file))
	}
	return path.Clean(path.Join(run.packageDirectory(result.Package), file))
}

func (run *testRun) packageDirectory(importPath string) string {
	if run.modulePath == "" || !strings.HasPrefix(importPath, run.modulePath) {
		return run.moduleDir
	}
	return path.Join(run.moduleDir, strings.TrimPrefix(strings.TrimPrefix(importPath, run.modulePath), "/"))
}

// Snapshot restituisce l'esecuzione completa, con l'output di ogni nodo.
func (m *TestManager) Snapshot(runID RunID) (TestRunSnapshot, error) {
	run, ok := m.run(runID)
	if !ok {
		return TestRunSnapshot{}, fmt.Errorf("esecuzione di test non trovata")
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	return run.snapshotLocked(true), nil
}

// Output restituisce l'output di un solo nodo dell'albero.
func (m *TestManager) Output(runID RunID, nodeID string) (string, error) {
	run, ok := m.run(runID)
	if !ok {
		return "", fmt.Errorf("esecuzione di test non trovata")
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	node, ok := run.tree.nodes[nodeID]
	if !ok {
		return "", fmt.Errorf("test non trovato")
	}
	return node.Output, nil
}

// List restituisce le esecuzioni di test della sessione, dalla più recente, senza output.
func (m *TestManager) List(sessionID SessionID) []TestRunSnapshot {
	m.mu.Lock()
	runs := make([]*testRun, 0, len(m.runs))
	for _, run := range m.runs {
		if run.snapshot.SessionID == sessionID {
			runs = append(runs, run)
		}
	}
	m.mu.Unlock()
	snapshots := make([]TestRunSnapshot, 0, len(runs))
	for _, run := range runs {
		run.mu.Lock()
		snapshots = append(snapshots, run.snapshotLocked(false))
		run.mu.Unlock()
	}
	sort.Slice(snapshots, func(left, right int) bool { return snapshots[left].StartedAt.After(snapshots[right].StartedAt) })
	return snapshots
}

// CloseSession dimentica le esecuzioni di test della sessione chiusa.
func (m *TestManager) CloseSession(sessionID SessionID) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, run := range m.runs {
		if run.snapshot.SessionID == sessionID {
			delete(m.runs, id)
		}
	}
}
