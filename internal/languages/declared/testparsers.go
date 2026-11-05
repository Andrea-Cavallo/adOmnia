package declared

import (
	"encoding/json"
	"encoding/xml"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

// Dart's JSON reporter is line-oriented: testStart names the test, error carries the failure and
// testDone closes it. Location comes from the test itself, so the tree can open the failing line.
type dartParser struct {
	tests  map[int]dartTest
	errors map[int]string
}

type dartTest struct {
	name, suite string
	line        int
}

func newDartParser() idetesting.EventParser { return &dartParser{} }

func rerunDart(name string, args []string) []string {
	return append(append([]string{}, args...), "-n", "^"+regexp.QuoteMeta(name)+"$")
}

func rerunRSpec(name string, args []string) []string {
	return append(append([]string{}, args...), "-e", name)
}

func rerunBusted(name string, args []string) []string {
	return append(append([]string{}, args...), "--filter", name)
}

// rerunMix takes `path:line` (ExUnit's location filter) or a file path when the test has no line.
func rerunMix(filter string, args []string) []string {
	return append(append([]string{}, args...), filter)
}

// rerunSBT replaces the `test` task with a ScalaTest `-z` substring filter on one suite.
func rerunSBT(name string, args []string) []string {
	return []string{"-batch", "testOnly * -- -z " + name}
}

// rerunTasty uses Tasty's pattern option; the pattern is a regular expression between slashes.
func rerunTasty(name string, args []string) []string {
	return append(append([]string{}, args...), "--ta=-p/"+regexp.QuoteMeta(name)+"/")
}

func (p *dartParser) Parse(line []byte) (idetesting.Event, bool) {
	var message struct {
		Type string `json:"type"`
		Test struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
			URL  string `json:"url"`
			Line int    `json:"line"`
		} `json:"test"`
		TestID     int    `json:"testID"`
		Result     string `json:"result"`
		Skipped    bool   `json:"skipped"`
		Time       int64  `json:"time"`
		Error      string `json:"error"`
		StackTrace string `json:"stackTrace"`
	}
	if json.Unmarshal(line, &message) != nil {
		return idetesting.Event{}, false
	}
	switch message.Type {
	case "testStart":
		if p.tests == nil {
			p.tests = map[int]dartTest{}
		}
		p.tests[message.Test.ID] = dartTest{name: message.Test.Name, suite: message.Test.URL, line: message.Test.Line}
	case "error":
		if p.errors == nil {
			p.errors = map[int]string{}
		}
		p.errors[message.TestID] = strings.TrimSpace(message.Error + "\n" + message.StackTrace)
	case "testDone":
		test := p.tests[message.TestID]
		if test.name == "" {
			return idetesting.Event{}, false
		}
		suite := test.suite
		if suite == "" {
			suite = "dart"
		}
		outcome := "pass"
		switch {
		case message.Skipped:
			outcome = "skip"
		case message.Result != "success":
			outcome = "fail"
		}
		// The tree nests on "/" and replaces it in package names; the failure keeps the real file.
		event := idetesting.Event{Action: outcome, Package: slashReplacer.Replace(suite), Test: slashReplacer.Replace(test.name), Elapsed: float64(message.Time) / 1000}
		if output := p.errors[message.TestID]; output != "" {
			event.Action, event.Output = "fail", output+"\n"
		}
		if event.Action == "fail" && test.line > 0 {
			event.Failure = &idetesting.TestLocation{File: suite, Line: test.line}
		}
		return event, true
	}
	return idetesting.Event{}, false
}

var (
	tapResult = regexp.MustCompile(`^(ok|not ok)\s+\d+\s*(?:-\s*)?(.*)$`)
	tapFile   = regexp.MustCompile(`^(\S+\.t)\s+\.\.`)
	tapAt     = regexp.MustCompile(`#\s+at\s+(.+?)\s+line\s+(\d+)`)
)

// tapParser reads TAP (`prove --verbose`): it must buffer, because the `# at file line N` that
// locates a failure arrives after its `not ok` line.
type tapParser struct{ lines []string }

func newTAPParser() idetesting.EventParser { return &tapParser{} }

func (p *tapParser) Parse(line []byte) (idetesting.Event, bool) {
	p.lines = append(p.lines, strings.TrimRight(string(line), "\r"))
	return idetesting.Event{}, false
}

func (p *tapParser) Finish() []idetesting.Event {
	suite := "prove"
	var results []*testResult
	var current *testResult
	for _, line := range p.lines {
		if match := tapFile.FindStringSubmatch(line); match != nil {
			suite = match[1]
			continue
		}
		if match := tapResult.FindStringSubmatch(line); match != nil {
			name := strings.TrimSpace(match[2])
			outcome := "pass"
			if match[1] == "not ok" {
				outcome = "fail"
			}
			upper := strings.ToUpper(name)
			if strings.Contains(upper, "# SKIP") || strings.Contains(upper, "# TODO") {
				outcome = "skip"
			}
			current = &testResult{suite: suite, name: name, outcome: outcome}
			results = append(results, current)
			continue
		}
		if current == nil || !strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if match := tapAt.FindStringSubmatch(line); match != nil {
			line, _ := strconv.Atoi(match[2])
			current.failure = &idetesting.TestLocation{File: match[1], Line: line}
		}
		current.output += strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "#")) + "\n"
	}
	plain := make([]testResult, 0, len(results))
	for _, result := range results {
		plain = append(plain, *result)
	}
	return resultEvents(plain)
}

var (
	exUnitSuite   = regexp.MustCompile(`^(\S.*?) \[([^\]]+)\]$`)
	exUnitTest    = regexp.MustCompile(`^\s+\* test (.+?)(?: \[L#(\d+)\])?(?: \(\d+(?:\.\d+)?ms\))?\s*$`)
	exUnitFailure = regexp.MustCompile(`^\s+\d+\) test (.+?) \(([^)]+)\)\s*$`)
	exUnitAt      = regexp.MustCompile(`^\s+([^\s:]+:\d+)\s*$`)
	ansiEscape    = regexp.MustCompile(`\x1b\[[0-9;]*m`)
)

// exUnitParser reads `mix test --trace`: the trace lists every test, the numbered failure blocks
// that follow carry the message and the source line.
type exUnitParser struct{ lines []string }

func newExUnitParser() idetesting.EventParser { return &exUnitParser{} }

func (p *exUnitParser) Parse(line []byte) (idetesting.Event, bool) {
	p.lines = append(p.lines, ansiEscape.ReplaceAllString(strings.TrimRight(string(line), "\r"), ""))
	return idetesting.Event{}, false
}

func (p *exUnitParser) Finish() []idetesting.Event {
	suite := ""
	var results []*testResult
	byName := map[string]*testResult{}
	var failing *testResult
	for _, line := range p.lines {
		if match := exUnitSuite.FindStringSubmatch(line); match != nil {
			suite = match[2]
			continue
		}
		if match := exUnitTest.FindStringSubmatch(line); match != nil {
			name := strings.TrimSpace(match[1])
			result := &testResult{suite: suite, name: name, outcome: "pass"}
			if line, err := strconv.Atoi(match[2]); err == nil && line > 0 {
				result.failure = &idetesting.TestLocation{File: suite, Line: line}
			}
			results = append(results, result)
			byName[name] = result
			failing = nil
			continue
		}
		if match := exUnitFailure.FindStringSubmatch(line); match != nil {
			name := strings.TrimSpace(match[1])
			result := byName[name]
			if result == nil {
				result = &testResult{suite: match[2], name: name, outcome: "fail"}
				results = append(results, result)
				byName[name] = result
			}
			result.outcome = "fail"
			failing = result
			continue
		}
		if failing == nil {
			continue
		}
		if match := exUnitAt.FindStringSubmatch(line); match != nil {
			file, number, _ := strings.Cut(match[1], ":")
			line, _ := strconv.Atoi(number)
			failing.failure = &idetesting.TestLocation{File: file, Line: line}
			continue
		}
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "Finished in") || strings.HasPrefix(strings.TrimSpace(line), "Randomized with seed") {
			if strings.TrimSpace(line) == "" {
				failing = nil
			}
			continue
		}
		failing.output += strings.TrimRight(line, " ") + "\n"
	}
	plain := make([]testResult, 0, len(results))
	for _, result := range results {
		plain = append(plain, *result)
	}
	return resultEvents(plain)
}

// bufferedXMLParser reads a JUnit XML document printed on stdout (busted's junit output).
type bufferedXMLParser struct{ data []byte }

func newBufferedXMLParser() idetesting.EventParser { return &bufferedXMLParser{} }

func (p *bufferedXMLParser) Parse(line []byte) (idetesting.Event, bool) {
	p.data = append(p.data, line...)
	p.data = append(p.data, '\n')
	return idetesting.Event{}, false
}

func (p *bufferedXMLParser) Finish() []idetesting.Event { return junitEvents(p.data) }

// zigParser reads the lines `zig test` prints for every test:
//
//	1/3 test.add... OK
//	2/3 test.sub... FAIL (TestExpectedEqual)
//
// `zig build test` forwards that same runner output, so the build step does not need its own format.
type zigParser struct{ lines []string }

func newZigParser() idetesting.EventParser { return &zigParser{} }

var (
	zigResult = regexp.MustCompile(`^\d+/\d+ (.+?)\.\.\. (OK|FAIL|SKIP)`)
	zigAt     = regexp.MustCompile(`([^\s:]+\.zig):(\d+):`)
)

func (p *zigParser) Parse(line []byte) (idetesting.Event, bool) {
	p.lines = append(p.lines, strings.TrimRight(string(line), "\r"))
	return idetesting.Event{}, false
}

func (p *zigParser) Finish() []idetesting.Event {
	results := make([]testResult, 0, len(p.lines))
	var failing *testResult
	for _, line := range p.lines {
		if match := zigResult.FindStringSubmatch(line); match != nil {
			outcome := map[string]string{"OK": "pass", "FAIL": "fail", "SKIP": "skip"}[match[2]]
			result := &testResult{suite: "zig", name: strings.TrimSpace(match[1]), outcome: outcome}
			results = append(results, *result)
			if outcome == "fail" {
				failing = &results[len(results)-1]
			} else {
				failing = nil
			}
			continue
		}
		if failing == nil {
			continue
		}
		failing.output += strings.TrimSpace(line) + "\n"
		if match := zigAt.FindStringSubmatch(line); match != nil && failing.failure == nil {
			line, _ := strconv.Atoi(match[2])
			failing.failure = &idetesting.TestLocation{File: match[1], Line: line}
		}
	}
	return resultEvents(results)
}

func scalaReportDirectory(workingDirectory string) string {
	return filepath.Join(workingDirectory, "target", "test-reports")
}

// tastyNode is the Tasty XML report (`stack test --ta=--xml=...` / `cabal test --test-options=--xml=...`).
type tastyNode struct {
	Name    string      `xml:"name,attr"`
	Result  string      `xml:"result,attr"`
	Time    string      `xml:"time,attr"`
	Message string      `xml:"failure>message"`
	Cases   []tastyNode `xml:"test-case"`
}

func tastyEvents(data []byte) []idetesting.Event {
	var root tastyNode
	if xml.Unmarshal(data, &root) != nil {
		return nil
	}
	var results []testResult
	var walk func(node tastyNode)
	walk = func(node tastyNode) {
		if node.Name != "" && node.Result != "" {
			outcome := "pass"
			switch node.Result {
			case "failure":
				outcome = "fail"
			case "skipped":
				outcome = "skip"
			}
			result := testResult{suite: "tasty", name: node.Name, outcome: outcome, output: strings.TrimSpace(node.Message), seconds: seconds(node.Time)}
			results = append(results, result)
		}
		for _, child := range node.Cases {
			walk(child)
		}
	}
	walk(root)
	return resultEvents(results)
}

// rspecEvents reads `rspec --format json`, one document for the whole run.
type rspecDocument struct {
	Examples []struct {
		Description     string  `json:"description"`
		FullDescription string  `json:"full_description"`
		Status          string  `json:"status"`
		FilePath        string  `json:"file_path"`
		LineNumber      int     `json:"line_number"`
		RunTime         float64 `json:"run_time"`
		Exception       *struct {
			Message   string   `json:"message"`
			Backtrace []string `json:"backtrace"`
		} `json:"exception"`
	} `json:"examples"`
}

func rspecEvents(data []byte) []idetesting.Event {
	var report rspecDocument
	if json.Unmarshal(data, &report) != nil {
		return nil
	}
	results := make([]testResult, 0, len(report.Examples))
	for _, example := range report.Examples {
		name := example.FullDescription
		if name == "" {
			name = example.Description
		}
		result := testResult{suite: example.FilePath, name: name, seconds: example.RunTime, outcome: "pass"}
		switch example.Status {
		case "failed":
			result.outcome = "fail"
			if example.Exception != nil {
				result.output = strings.TrimSpace(example.Exception.Message+"\n"+strings.Join(example.Exception.Backtrace, "\n")) + "\n"
			}
		case "pending":
			result.outcome = "skip"
		}
		if result.outcome == "fail" && example.LineNumber > 0 {
			result.failure = &idetesting.TestLocation{File: example.FilePath, Line: example.LineNumber}
		}
		results = append(results, result)
	}
	return resultEvents(results)
}
