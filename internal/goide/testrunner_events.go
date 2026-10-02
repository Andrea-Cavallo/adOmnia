package goide

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

const (
	maxTestNodes       = 5000
	maxTestOutputBytes = 64 * 1024
)

// Stati di un nodo dell'albero dei test, ricavati dagli eventi di `go test -json`.
const (
	TestRunning = "running"
	TestPassed  = "pass"
	TestFailed  = "fail"
	TestSkipped = "skip"
	// TestTimedOut marca i test ancora in corso quando il package termina per timeout.
	TestTimedOut = "timeout"
	// TestBenchmarked marca un benchmark che ha prodotto la riga dei risultati.
	TestBenchmarked = "bench"
)

// testEvent è una riga di `go test -json` (test2json), inclusi gli eventi di build di Go 1.24+.
type testEvent struct {
	Action      string  `json:"Action"`
	Package     string  `json:"Package"`
	ImportPath  string  `json:"ImportPath"`
	Test        string  `json:"Test"`
	Elapsed     float64 `json:"Elapsed"`
	Output      string  `json:"Output"`
	FailedBuild string  `json:"FailedBuild"`
}

// TestLocation è un file:riga citato nell'output di un fallimento, relativo al progetto quando risolvibile.
type TestLocation struct {
	File         string `json:"file"`
	RelativePath string `json:"relativePath,omitempty"`
	Line         int    `json:"line"`
}

// TestResult è un nodo dell'albero: un package (Name vuoto), un test o un sottotest (Name con "/").
type TestResult struct {
	ID            string        `json:"id"`
	ParentID      string        `json:"parentId,omitempty"`
	Package       string        `json:"package"`
	Name          string        `json:"name,omitempty"`
	Status        string        `json:"status"`
	ElapsedMillis int64         `json:"elapsedMillis"`
	Output        string        `json:"output,omitempty"`
	Truncated     bool          `json:"truncated,omitempty"`
	Failure       *TestLocation `json:"failure,omitempty"`
	Benchmark     string        `json:"benchmark,omitempty"`
	BuildFailed   bool          `json:"buildFailed,omitempty"`
	// Directory è la cartella del package relativa al progetto (solo sui nodi package).
	Directory string `json:"directory,omitempty"`
	// Runs e Failures contano gli esiti con -count=N; Min/MaxMillis danno la distribuzione delle durate.
	Runs      int   `json:"runs,omitempty"`
	Failures  int   `json:"failures,omitempty"`
	MinMillis int64 `json:"minMillis,omitempty"`
	MaxMillis int64 `json:"maxMillis,omitempty"`
	// TotalMillis somma le durate di tutte le ripetizioni (media = TotalMillis/Runs).
	TotalMillis int64 `json:"totalMillis,omitempty"`
	// ShuffleSeed è il seed di -shuffle stampato dal package, per riprodurre l'ordine.
	ShuffleSeed string `json:"shuffleSeed,omitempty"`
}

// TestSummary conta i risultati foglia (test senza sottotest e package senza test).
type TestSummary struct {
	Passed  int `json:"passed"`
	Failed  int `json:"failed"`
	Skipped int `json:"skipped"`
	Running int `json:"running"`
}

// testTree aggrega gli eventi correlandoli per Package e Test, mai dal solo testo.
type testTree struct {
	nodes      map[string]*TestResult
	order      []string
	hasChild   map[string]bool
	overflowed bool
}

var (
	failureLine   = regexp.MustCompile(`^\s+([\w.\-/\\]+\.go):(\d+):`)
	buildLine     = regexp.MustCompile(`^([\w.\-/\\]+\.go):(\d+):\d+:`)
	shuffleLine   = regexp.MustCompile(`^-test\.shuffle (-?\d+)$`)
	benchmarkLine = regexp.MustCompile(`^\s*(?:Benchmark\S*\s+)?(\d+\s+.*\bns/op\b.*)$`)
)

func newTestTree() *testTree {
	return &testTree{nodes: make(map[string]*TestResult), hasChild: make(map[string]bool)}
}

func testNodeID(pkg, name string) string {
	if name == "" {
		return pkg
	}
	return pkg + "\x00" + name
}

// node restituisce il nodo, creando package e genitori mancanti.
func (t *testTree) node(pkg, name string) *TestResult {
	id := testNodeID(pkg, name)
	if existing, ok := t.nodes[id]; ok {
		return existing
	}
	if len(t.nodes) >= maxTestNodes {
		t.overflowed = true
		return nil
	}
	parent := ""
	if name != "" {
		if slash := strings.LastIndex(name, "/"); slash >= 0 {
			parent = t.ensure(pkg, name[:slash])
		} else {
			parent = t.ensure(pkg, "")
		}
		t.hasChild[parent] = true
	}
	created := &TestResult{ID: id, ParentID: parent, Package: pkg, Name: name, Status: TestRunning}
	t.nodes[id] = created
	t.order = append(t.order, id)
	return created
}

func (t *testTree) ensure(pkg, name string) string {
	if parent := t.node(pkg, name); parent != nil {
		return parent.ID
	}
	return testNodeID(pkg, name)
}

// apply interpreta una riga JSON; le righe non JSON vengono ignorate (restano nell'output grezzo).
func (t *testTree) apply(line []byte) {
	var event testEvent
	if json.Unmarshal(line, &event) != nil {
		return
	}
	switch event.Action {
	case "build-output":
		t.buildOutput(event)
		return
	case "build-fail":
		if node := t.node(buildPackage(event.ImportPath), ""); node != nil {
			node.BuildFailed = true
		}
		return
	}
	if event.Package == "" {
		return
	}
	node := t.node(event.Package, event.Test)
	if node == nil {
		return
	}
	switch event.Action {
	case "run", "cont", "start":
		node.Status = TestRunning
	case "pause":
	case "output":
		t.output(node, event.Output)
	case "pass", "fail", "skip":
		elapsed := int64(event.Elapsed * 1000)
		node.ElapsedMillis = elapsed
		node.Status = event.Action
		if event.Test != "" && event.Action != "skip" {
			recordRepetition(node, event.Action == "fail", elapsed)
		}
		if event.FailedBuild != "" {
			node.BuildFailed = true
		}
		if event.Test == "" {
			t.finishPackage(node)
		}
	case "bench":
		node.Status = TestBenchmarked
	}
}

// recordRepetition accumula un esito: con -count=N un fallimento resta visibile anche se l'ultima ripetizione passa.
func recordRepetition(node *TestResult, failed bool, elapsed int64) {
	node.Runs++
	if failed {
		node.Failures++
	} else if node.Failures > 0 {
		node.Status = TestFailed
	}
	if node.Runs == 1 || elapsed < node.MinMillis {
		node.MinMillis = elapsed
	}
	node.MaxMillis = max(node.MaxMillis, elapsed)
	node.TotalMillis += elapsed
}

func (t *testTree) output(node *TestResult, text string) {
	appendOutput(node, text)
	trimmed := strings.TrimRight(text, "\n")
	if node.Name == "" && node.ShuffleSeed == "" {
		if match := shuffleLine.FindStringSubmatch(trimmed); match != nil {
			node.ShuffleSeed = match[1]
		}
	}
	if node.Failure == nil {
		if match := failureLine.FindStringSubmatch(trimmed); match != nil {
			node.Failure = &TestLocation{File: match[1], Line: atoiOrZero(match[2])}
		}
	}
	// L'output di un benchmark può arrivare spezzato: il nome e i numeri in eventi diversi.
	if strings.HasPrefix(node.Name, "Benchmark") {
		if match := benchmarkLine.FindStringSubmatch(trimmed); match != nil {
			node.Benchmark = strings.Join(strings.Fields(match[1]), " ")
			node.Status = TestBenchmarked
		}
	}
}

func (t *testTree) buildOutput(event testEvent) {
	node := t.node(buildPackage(event.ImportPath), "")
	if node == nil {
		return
	}
	appendOutput(node, event.Output)
	if node.Failure == nil {
		if match := buildLine.FindStringSubmatch(strings.TrimSpace(event.Output)); match != nil {
			node.Failure = &TestLocation{File: match[1], Line: atoiOrZero(match[2])}
		}
	}
}

// finishPackage chiude i test rimasti aperti: un package fallito con test in corso è un timeout o un crash.
func (t *testTree) finishPackage(pkg *TestResult) {
	timedOut := strings.Contains(pkg.Output, "test timed out after")
	for _, id := range t.order {
		node := t.nodes[id]
		if node.Package != pkg.Package || node.Name == "" || node.Status != TestRunning {
			continue
		}
		switch {
		case timedOut:
			node.Status = TestTimedOut
		case pkg.Status == TestFailed:
			node.Status = TestFailed
		default:
			node.Status = TestPassed
		}
	}
}

func appendOutput(node *TestResult, text string) {
	if node.Truncated {
		return
	}
	if len(node.Output)+len(text) > maxTestOutputBytes {
		node.Output += text[:max(0, maxTestOutputBytes-len(node.Output))]
		node.Truncated = true
		return
	}
	node.Output += text
}

// buildPackage toglie la variante di test ("pkg [pkg.test]") dal percorso di import.
func buildPackage(importPath string) string {
	if space := strings.Index(importPath, " "); space >= 0 {
		return importPath[:space]
	}
	return importPath
}

func atoiOrZero(value string) int {
	number := 0
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0
		}
		number = number*10 + int(digit-'0')
	}
	return number
}

// snapshot restituisce i nodi in ordine di apparizione, con i package ordinati per nome.
func (t *testTree) snapshot() ([]TestResult, TestSummary) {
	results := make([]TestResult, 0, len(t.order))
	summary := TestSummary{}
	for _, id := range t.order {
		node := *t.nodes[id]
		results = append(results, node)
		if t.hasChild[id] {
			continue
		}
		switch node.Status {
		case TestPassed, TestBenchmarked:
			summary.Passed++
		case TestFailed, TestTimedOut:
			summary.Failed++
		case TestSkipped:
			summary.Skipped++
		default:
			summary.Running++
		}
	}
	sort.SliceStable(results, func(left, right int) bool {
		if results[left].Package != results[right].Package {
			return results[left].Package < results[right].Package
		}
		return false
	})
	return results, summary
}
