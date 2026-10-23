package web

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json/v2"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
)

// TestNode è il valore di Info.TestFramework per il test runner integrato in Node (`node --test`).
const TestNode = "node"

// nodeReporterSource è il reporter che traduce gli eventi di `node --test` in righe JSON con il file di ogni test.
//
//go:embed node_test_reporter.mjs
var nodeReporterSource []byte

const nodeRecordPrefix = "ADOMNIA-NODE-TEST "

// nodeTestScript riconosce uno script `test` che usa il runner integrato (`node --test`, anche con altri flag).
var nodeTestScript = regexp.MustCompile(`(^|[\s;&|])node(\.exe)?\s+(\S+\s+)*--test(\s|$)`)

// nodeReporterURL scrive (una sola volta) il reporter nella cache dell'utente e ne restituisce l'URL file://:
// Node su Windows rifiuta i percorsi assoluti nudi. Il file non sta mai nel progetto aperto.
func nodeReporterURL() (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("no cache folder for the Node test reporter: %w", err)
	}
	sum := sha256.Sum256(nodeReporterSource)
	dir := filepath.Join(cache, "adomnia", "node-test")
	file := filepath.Join(dir, "reporter-"+hex.EncodeToString(sum[:6])+".mjs")
	if existing, err := os.ReadFile(file); err != nil || !bytes.Equal(existing, nodeReporterSource) {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", fmt.Errorf("could not prepare the Node test reporter: %w", err)
		}
		if err := os.WriteFile(file, nodeReporterSource, 0o600); err != nil {
			return "", fmt.Errorf("could not write the Node test reporter: %w", err)
		}
	}
	path := filepath.ToSlash(file)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return (&url.URL{Scheme: "file", Path: path}).String(), nil
}

// nodeTestArguments lancia Node direttamente: il runner è integrato, non c'è nulla da cercare in node_modules.
func nodeTestArguments(options TestOptions, reporter string) []string {
	arguments := []string{"--test", "--test-reporter=" + reporter}
	if options.Run != "" {
		arguments = append(arguments, "--test-name-pattern="+options.Run)
	}
	return append(arguments, options.Packages...)
}

// nodeTestCommand è TestCommand per `node --test`: stesso contratto, ma senza package manager né report su file.
func nodeTestCommand(request idetesting.Request, options TestOptions) (run.CommandSpec, idetesting.EventParser, error) {
	binary, err := exec.LookPath("node")
	if err != nil {
		return run.CommandSpec{}, nil, fmt.Errorf("node was not found on this machine")
	}
	reporter, err := nodeReporterURL()
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	arguments := nodeTestArguments(options, reporter)
	spec := run.CommandSpec{
		Executable: binary, Arguments: arguments, WorkingDirectory: request.WorkingDirectory,
		Environment:    append(append([]string(nil), request.Environment...), "CI=1"),
		DisplayCommand: "node --test " + strings.Join(options.Packages, " "), QuietStdout: true,
	}
	return spec, &nodeReportParser{root: request.Root}, nil
}

type nodeRecord struct {
	File    string   `json:"file"`
	Path    []string `json:"path"`
	Status  string   `json:"status"`
	Ms      float64  `json:"ms"`
	Line    int      `json:"line"`
	Message string   `json:"message"`
	Stack   string   `json:"stack"`
}

// nodeReportParser legge le righe del reporter man mano che arrivano; a fine processo chiude i file.
type nodeReportParser struct {
	root   string
	files  []string
	failed map[string]bool
	done   bool
}

func (p *nodeReportParser) Parse([]byte) (idetesting.Event, bool) { return idetesting.Event{}, false }

func (p *nodeReportParser) ParseAll(line []byte) []idetesting.Event {
	text := strings.TrimRight(string(line), "\r\n")
	rest, ok := strings.CutPrefix(text, nodeRecordPrefix)
	if !ok {
		return nil
	}
	var record nodeRecord
	if json.Unmarshal([]byte(rest), &record) != nil || record.File == "" {
		return nil
	}
	pkg := relativeSlash(p.root, record.File)
	p.remember(pkg, record.Status == "fail")
	failure := record.Message
	if record.Stack != "" {
		failure += "\n" + record.Stack
	}
	// Un file che non parte (import mancante, sintassi) non ha test: il messaggio è l'unica spiegazione.
	if len(record.Path) == 0 {
		if record.Status != "fail" {
			return nil
		}
		return []idetesting.Event{{Action: "output", Package: pkg, Output: failure + "\n"}}
	}
	parts := make([]string, 0, len(record.Path))
	for _, title := range record.Path {
		parts = append(parts, titleSlash.Replace(title))
	}
	name := strings.Join(parts, "/")
	events := []idetesting.Event{{Action: "run", Package: pkg, Test: name}}
	if record.Status == "fail" {
		event := idetesting.Event{Action: "output", Package: pkg, Test: name, Output: failure + "\n"}
		if location, ok := failureLocation(p.root, record.Stack); ok {
			event.Failure = &location
		} else {
			event.Failure = &idetesting.TestLocation{File: record.File, RelativePath: pkg, Line: record.Line}
		}
		events = append(events, event)
	}
	return append(events, idetesting.Event{Action: record.Status, Package: pkg, Test: name, Elapsed: record.Ms / 1000})
}

func (p *nodeReportParser) remember(pkg string, failed bool) {
	if p.failed == nil {
		p.failed = map[string]bool{}
	}
	if _, seen := p.failed[pkg]; !seen {
		p.files = append(p.files, pkg)
	}
	p.failed[pkg] = p.failed[pkg] || failed
}

// Finish assegna l'esito a ogni file visto: fallito se lo è un test o il file stesso.
func (p *nodeReportParser) Finish() []idetesting.Event {
	if p.done {
		return nil
	}
	p.done = true
	events := make([]idetesting.Event, 0, len(p.files))
	for _, pkg := range p.files {
		action := "pass"
		if p.failed[pkg] {
			action = "fail"
		}
		events = append(events, idetesting.Event{Action: action, Package: pkg})
	}
	return events
}
