package python

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"

	idetesting "adomnia/internal/ide/testing"
)

// pytestEvent è una riga del file di eventi scritto dal plugin adomnia_pytest_events.
type pytestEvent struct {
	Event      string  `json:"event"`
	NodeID     string  `json:"nodeid"`
	File       string  `json:"file"`
	When       string  `json:"when"`
	Outcome    string  `json:"outcome"`
	Duration   float64 `json:"duration"`
	Line       int     `json:"line"`
	Longrepr   string  `json:"longrepr"`
	CapStdout  string  `json:"capstdout"`
	CapStderr  string  `json:"capstderr"`
	SkipReason string  `json:"skipreason"`
	XFail      string  `json:"xfail"`
}

const (
	maxPytestEventBytes = 8 << 20
	maxPytestOutput     = 64 * 1024
)

// nodeSlash sostituisce "/" dentro un segmento del node ID: l'albero dei test usa "/" per i
// sottotest e il frontend lo riconverte quando ricostruisce il node ID.
var nodeSlash = strings.NewReplacer("/", "\u2215")

// pytestTest aggrega i report delle tre fasi (setup, call, teardown) di un node ID.
type pytestTest struct {
	pkg, name string
	file      string
	line      int
	duration  float64
	failed    bool
	skipped   bool
	xpass     bool
	reason    string
	output    strings.Builder
	stdout    strings.Builder
	stderr    strings.Builder
	failure   *idetesting.TestLocation
	finished  bool
}

// pytestParser traduce gli eventi del plugin nell'albero dei test: identità dai node ID veri,
// mai ricostruiti da etichette o output colorato (PY-5.2).
type pytestParser struct {
	root, eventsPath string
	offset           int64
	pending          []byte
	files            map[string]string
	tests            map[string]*pytestTest
	testOrder        []string
	packages         []string
	packageFailed    map[string]bool
	done             bool
}

func newPytestParser(root, eventsPath string) *pytestParser {
	return &pytestParser{
		root: root, eventsPath: eventsPath,
		files: map[string]string{}, tests: map[string]*pytestTest{},
		packageFailed: map[string]bool{},
	}
}

func (*pytestParser) Parse([]byte) (idetesting.Event, bool) { return idetesting.Event{}, false }

// Finish chiude l'albero quando pytest termina senza il marcatore finale (run annullato o
// processo morto): i test rimasti aperti diventano skip con il motivo, non restano "running".
func (p *pytestParser) Finish() []idetesting.Event { return p.finish() }

// ParseAll legge gli eventi nuovi del plugin a ogni riga di output: l'albero si aggiorna durante
// l'esecuzione e l'ultima riga (il marcatore del plugin) garantisce la lettura finale.
func (p *pytestParser) ParseAll(_ []byte) []idetesting.Event {
	file, err := os.Open(p.eventsPath)
	if err != nil {
		return nil
	}
	defer file.Close()
	if _, err := file.Seek(p.offset, io.SeekStart); err != nil {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(file, maxPytestEventBytes))
	if err != nil {
		return nil
	}
	p.offset += int64(len(data))
	if len(data) == 0 {
		return nil
	}
	p.pending = append(p.pending, data...)
	var events []idetesting.Event
	for {
		index := bytes.IndexByte(p.pending, '\n')
		if index < 0 {
			break
		}
		events = append(events, p.line(p.pending[:index])...)
		p.pending = p.pending[index+1:]
	}
	if len(p.pending) > 1<<20 {
		p.pending = nil
	}
	return events
}

func (p *pytestParser) line(line []byte) []idetesting.Event {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return nil
	}
	var payload pytestEvent
	if err := json.Unmarshal(line, &payload); err != nil {
		return nil
	}
	switch payload.Event {
	case "collect":
		if payload.File != "" {
			p.files[payload.NodeID] = payload.File
		}
		return nil
	case "collecterror":
		return p.collectError(payload)
	case "report":
		return p.report(payload)
	case "end":
		return p.finish()
	}
	return nil
}

// node ricava package (il sorgente relativo al progetto) e nome (classe/test annidati con "/").
func (p *pytestParser) node(nodeID, file string) (string, string) {
	absolute := p.files[nodeID]
	if absolute == "" {
		absolute = file
	}
	pkg := ""
	if absolute != "" {
		pkg = relativeSlash(p.root, absolute)
	}
	head, rest, found := strings.Cut(nodeID, "::")
	if pkg == "" {
		pkg = filepath.ToSlash(head)
	}
	if !found {
		return p.trackPackage(pkg), ""
	}
	segments := strings.Split(rest, "::")
	for index := range segments {
		segments[index] = nodeSlash.Replace(segments[index])
	}
	return p.trackPackage(pkg), strings.Join(segments, "/")
}

// trackPackage registra il package nell'ordine di comparsa per il riepilogo finale.
func (p *pytestParser) trackPackage(pkg string) string {
	if pkg != "" && p.packageIndex(pkg) < 0 {
		p.packages = append(p.packages, pkg)
	}
	return pkg
}

func (p *pytestParser) packageIndex(pkg string) int {
	for index, name := range p.packages {
		if name == pkg {
			return index
		}
	}
	return -1
}

// report aggrega una fase di test; la fase di teardown chiude il test e produce gli eventi.
func (p *pytestParser) report(payload pytestEvent) []idetesting.Event {
	pkg, name := p.node(payload.NodeID, payload.File)
	test := p.tests[payload.NodeID]
	if test == nil {
		test = &pytestTest{pkg: pkg, name: name, file: p.files[payload.NodeID]}
		p.tests[payload.NodeID] = test
		p.testOrder = append(p.testOrder, payload.NodeID)
	}
	test.duration += payload.Duration
	if test.file == "" {
		test.file = payload.File
	}
	switch payload.Outcome {
	case "failed":
		test.failed = true
		p.packageFailed[pkg] = true
		if payload.Longrepr != "" && test.output.Len() < maxPytestOutput {
			if test.output.Len() > 0 {
				test.output.WriteString("\n")
			}
			test.output.WriteString(payload.Longrepr)
		}
		if test.failure == nil && payload.Line > 0 {
			test.line = payload.Line
			test.failure = &idetesting.TestLocation{
				File: test.file, RelativePath: relativeSlash(p.root, test.file), Line: payload.Line,
			}
		}
	case "skipped":
		test.skipped = true
		if payload.XFail != "" {
			test.reason = "expected failure: " + payload.XFail
		} else {
			test.reason = payload.SkipReason
		}
	}
	if payload.XFail != "" && payload.Outcome == "passed" {
		test.xpass = true
		test.reason = payload.XFail
	}
	p.capture(test, payload)
	if payload.When == "teardown" {
		return p.finishTest(test)
	}
	return nil
}

// capture conserva lo stdout/stderr catturato da pytest per la fase (PY-5.4): resta nell'output
// del singolo test, mai buttato via. Il limite è lo stesso dell'output del traceback.
func (p *pytestParser) capture(test *pytestTest, payload pytestEvent) {
	for builder, text := range map[*strings.Builder]string{&test.stdout: payload.CapStdout, &test.stderr: payload.CapStderr} {
		if text == "" {
			continue
		}
		remaining := maxPytestOutput - builder.Len()
		if remaining <= 0 {
			continue
		}
		if len(text) > remaining {
			text = text[:remaining]
		}
		builder.WriteString(text)
	}
}

// collectError è un errore di collection: quel file non porta test eseguibili e resta marcato
// come fallito, con il traceback nell'output.
func (p *pytestParser) collectError(payload pytestEvent) []idetesting.Event {
	pkg, _ := p.node(payload.NodeID, payload.File)
	if pkg == "" {
		return nil
	}
	p.packageFailed[pkg] = true
	events := []idetesting.Event{{Action: "run", Package: pkg}}
	if output := strings.TrimSpace(payload.Longrepr); output != "" {
		events = append(events, idetesting.Event{Action: "build-output", Package: pkg, Output: output + "\n"})
	}
	return append(events, idetesting.Event{Action: "build-fail", Package: pkg})
}

// finishTest chiude un test con il suo esito complessivo delle tre fasi.
func (p *pytestParser) finishTest(test *pytestTest) []idetesting.Event {
	if test.finished {
		return nil
	}
	test.finished = true
	var events []idetesting.Event
	output := test.reportedOutput()
	switch {
	case test.failed:
		if output != "" {
			event := idetesting.Event{Action: "output", Package: test.pkg, Test: test.name, Output: output + "\n", Failure: test.failure}
			events = append(events, event)
		}
		events = append(events, idetesting.Event{Action: "fail", Package: test.pkg, Test: test.name, Elapsed: test.duration})
	case test.skipped:
		reason := strings.TrimSpace(test.reason)
		if reason == "" {
			reason = "skipped"
		}
		skipped := "Skipped: " + reason + "\n"
		if output != "" {
			skipped += output + "\n"
		}
		events = append(events,
			idetesting.Event{Action: "output", Package: test.pkg, Test: test.name, Output: skipped},
			idetesting.Event{Action: "skip", Package: test.pkg, Test: test.name, Elapsed: test.duration})
	default:
		if test.xpass {
			output = strings.TrimSpace("XPASS: " + strings.TrimSpace(test.reason) + "\n" + output)
		}
		if output != "" {
			events = append(events, idetesting.Event{Action: "output", Package: test.pkg, Test: test.name, Output: output + "\n"})
		}
		events = append(events, idetesting.Event{Action: "pass", Package: test.pkg, Test: test.name, Elapsed: test.duration})
	}
	return events
}

// reportedOutput mette insieme traceback del fallimento e stdout/stderr catturati da pytest; i
// blocchi vuoti non compaiono, così l'output di un test pulito resta vuoto.
func (test *pytestTest) reportedOutput() string {
	blocks := make([]string, 0, 3)
	if traceback := strings.TrimSpace(test.output.String()); traceback != "" {
		blocks = append(blocks, traceback)
	}
	if captured := strings.TrimRight(test.stdout.String(), "\r\n"); captured != "" {
		blocks = append(blocks, "--- stdout ---\n"+captured)
	}
	if captured := strings.TrimRight(test.stderr.String(), "\r\n"); captured != "" {
		blocks = append(blocks, "--- stderr ---\n"+captured)
	}
	return strings.Join(blocks, "\n\n")
}

// finish chiude i test interrotti e stampa l'esito di ogni file di test, come fa il report Java
// per ogni suite. Dopo "end" il plugin non scrive più.
func (p *pytestParser) finish() []idetesting.Event {
	if p.done {
		return nil
	}
	p.done = true
	var events []idetesting.Event
	for _, nodeID := range p.testOrder {
		test := p.tests[nodeID]
		if test.finished {
			continue
		}
		if !test.failed {
			test.skipped, test.reason = true, "the run ended before this test finished"
		}
		events = append(events, p.finishTest(test)...)
	}
	for _, pkg := range p.packages {
		action := "pass"
		if p.packageFailed[pkg] {
			action = "fail"
		}
		events = append(events, idetesting.Event{Action: action, Package: pkg})
	}
	return events
}
