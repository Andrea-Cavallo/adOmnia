package java

import (
	"bytes"
	"encoding/xml"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	idetesting "adomnia/internal/ide/testing"
)

// Report JUnit XML: Surefire (Maven) e Gradle usano lo stesso formato, in cartelle diverse.
const (
	maxReportFiles = 2_000
	maxReportBytes = 8 << 20
	maxReportDepth = 8
)

type junitSuite struct {
	Name      string      `xml:"name,attr"`
	Time      float64     `xml:"time,attr"`
	TestCases []junitCase `xml:"testcase"`
}

type junitCase struct {
	ClassName string        `xml:"classname,attr"`
	Name      string        `xml:"name,attr"`
	Time      float64       `xml:"time,attr"`
	Failure   *junitProblem `xml:"failure"`
	Error     *junitProblem `xml:"error"`
	Skipped   *struct{}     `xml:"skipped"`
}

type junitProblem struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Text    string `xml:",chardata"`
}

func (p *junitProblem) output() string {
	text := strings.TrimSpace(p.Text)
	if text == "" {
		text = strings.TrimSpace(p.Type + ": " + p.Message)
	}
	return text + "\n"
}

// buildEnd è l'ultima riga di Maven (BUILD SUCCESS/FAILURE) e di Gradle (BUILD SUCCESSFUL/FAILED): i report
// sono completi solo allora, per questo sono letti una volta sola, a fine build.
var buildEnd = regexp.MustCompile(`^(?:\[(?:INFO|ERROR)\]\s*)?BUILD (?:SUCCESS|FAILURE|SUCCESSFUL|FAILED)\b`)

// reportParser legge i report JUnit XML scritti dal build e li converte negli eventi dell'albero dei test.
type reportParser struct {
	root, unitRoot string
	// since scarta i report di esecuzioni precedenti rimasti in target/ o build/.
	since time.Time
	done  bool
}

func newReportParser(root, unitRoot string) *reportParser {
	return &reportParser{root: root, unitRoot: unitRoot, since: time.Now().Add(-2 * time.Second)}
}

func (p *reportParser) Parse([]byte) (idetesting.Event, bool) { return idetesting.Event{}, false }

func (p *reportParser) ParseAll(line []byte) []idetesting.Event {
	if p.done || !buildEnd.Match(bytes.TrimSpace(line)) {
		return nil
	}
	p.done = true
	return p.events(findReports(p.unitRoot, p.since))
}

// findReports cerca TEST-*.xml dei build di Maven (target/surefire-reports) e Gradle (build/test-results)
// sotto root, anche nei moduli, modificati dopo since. La ricerca ha dei limiti: un monorepo enorme non la blocca.
func findReports(root string, since time.Time) []string {
	var files []string
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			name := entry.Name()
			if path != root && (name == "src" || name == "node_modules" || strings.HasPrefix(name, ".")) || depthOf(root, path) > maxReportDepth {
				return filepath.SkipDir
			}
			return nil
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "TEST-") || !strings.HasSuffix(name, ".xml") || !isReportDirectory(filepath.ToSlash(filepath.Dir(path))) {
			return nil
		}
		if info, err := entry.Info(); err != nil || info.ModTime().Before(since) {
			return nil
		}
		if files = append(files, path); len(files) >= maxReportFiles {
			return filepath.SkipAll
		}
		return nil
	})
	sort.Strings(files)
	return files
}

func isReportDirectory(directory string) bool {
	return strings.HasSuffix(directory, "/target/surefire-reports") || strings.Contains(directory, "/build/test-results/")
}

func depthOf(root, path string) int {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." {
		return 0
	}
	return strings.Count(filepath.ToSlash(relative), "/") + 1
}

// slashReplacer: l'albero annida con "/", che non può comparire nei nomi (il DisplayName di JUnit 5 lo ammette).
var slashReplacer = strings.NewReplacer("/", "∕")

func (p *reportParser) events(files []string) []idetesting.Event {
	var events []idetesting.Event
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil || len(data) > maxReportBytes {
			continue
		}
		var suite junitSuite
		if xml.Unmarshal(data, &suite) != nil || suite.Name == "" {
			continue
		}
		source := testSource(moduleOfReport(file), suite.Name)
		pkg := suite.Name
		if source != "" {
			pkg = relativeSlash(p.root, source)
		}
		events = append(events, suiteEvents(p.root, pkg, source, suite)...)
	}
	return events
}

func suiteEvents(root, pkg, source string, suite junitSuite) []idetesting.Event {
	var events []idetesting.Event
	failed := false
	for _, test := range suite.TestCases {
		name := slashReplacer.Replace(test.Name)
		events = append(events, idetesting.Event{Action: "run", Package: pkg, Test: name})
		action := "pass"
		if problem := firstProblem(test); problem != nil {
			action, failed = "fail", true
			event := idetesting.Event{Action: "output", Package: pkg, Test: name, Output: problem.output()}
			if location, ok := failureLocation(root, source, problem.Text); ok {
				event.Failure = &location
			}
			events = append(events, event)
		} else if test.Skipped != nil {
			action = "skip"
		}
		events = append(events, idetesting.Event{Action: action, Package: pkg, Test: name, Elapsed: test.Time})
	}
	action := "pass"
	if failed {
		action = "fail"
	}
	return append(events, idetesting.Event{Action: action, Package: pkg, Elapsed: suite.Time})
}

func firstProblem(test junitCase) *junitProblem {
	if test.Failure != nil {
		return test.Failure
	}
	return test.Error
}

// moduleOfReport è la cartella del modulo che ha prodotto il report: quella che contiene target/ o build/.
func moduleOfReport(report string) string {
	directory := filepath.ToSlash(filepath.Dir(report))
	for _, marker := range []string{"/target/surefire-reports", "/build/test-results"} {
		if index := strings.LastIndex(directory, marker); index >= 0 {
			return filepath.FromSlash(directory[:index])
		}
	}
	return filepath.Dir(report)
}

// testSource trova il sorgente della classe di test nel modulo; una classe annidata (Outer$Inner) vive in Outer.
func testSource(module, className string) string {
	outer, _, _ := strings.Cut(className, "$")
	relative := filepath.FromSlash(strings.ReplaceAll(outer, ".", "/"))
	for _, root := range []string{"java", "kotlin", "groovy", "scala"} {
		for _, extension := range []string{".java", ".kt", ".groovy", ".scala"} {
			if path := filepath.Join(module, "src", "test", root, relative+extension); isFile(path) {
				return path
			}
		}
	}
	return ""
}

// stackFrame è `(FooTest.java:42)`: il primo frame nel sorgente del test è dove fallisce l'asserzione.
var stackFrame = regexp.MustCompile(`\(([\w$]+\.(?:java|kt|groovy|scala)):(\d+)\)`)

func failureLocation(root, source, stack string) (idetesting.TestLocation, bool) {
	if source == "" {
		return idetesting.TestLocation{}, false
	}
	for _, match := range stackFrame.FindAllStringSubmatch(stack, -1) {
		if match[1] != filepath.Base(source) {
			continue
		}
		line := 0
		for _, digit := range match[2] {
			line = line*10 + int(digit-'0')
		}
		return idetesting.TestLocation{File: source, RelativePath: relativeSlash(root, source), Line: line}, true
	}
	return idetesting.TestLocation{}, false
}

func relativeSlash(root, path string) string {
	if relative, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(relative, "..") {
		return filepath.ToSlash(relative)
	}
	return filepath.ToSlash(path)
}
