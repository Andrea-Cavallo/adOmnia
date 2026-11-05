package declared

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

// reportDirectory in a tester's arguments is replaced by a fresh temporary folder: the runner writes
// its JUnit XML or TRX files there and the parser reads every one of them when the process exits.
const reportDirectory = "{reports}"

// tester runs all the tests of a unit with the ecosystem's own runner. The project-local runner
// (vendor/bin/phpunit) wins over the one on PATH, like the project wrappers of Java.
type tester struct {
	local   string
	command string
	args    []string
	// prepare adapts the arguments to the project (e.g. CTest reads the actual CMake build
	// directory instead of assuming `build/`). A nil prepare leaves the arguments untouched.
	prepare func(workingDirectory string, args []string) ([]string, error)
	// parser reads a runner that does not write JUnit/TRX reports (Dart JSON, TAP, ExUnit trace,
	// JUnit on stdout, Zig's test runner). A nil parser reads the reports written under
	// reportDirectory.
	parser func() idetesting.EventParser
	// reportDir names a report folder owned by the project (sbt writes target/test-reports): it is
	// read after the run and never deleted, unlike the temporary reportDirectory.
	reportDir func(workingDirectory string) string
	// rerun narrows the command to one test (the `run` field of TestRunRequest). It receives the
	// already-substituted arguments and returns the full list; nil means the ecosystem has no
	// reliable single-test filter and the host answers with an explicit error.
	rerun func(name string, args []string) []string
}

const maxReportBytes = 16 << 20

func (a adapter) TestCommand(request idetesting.Request) (run.CommandSpec, idetesting.EventParser, error) {
	if a.test == nil {
		return run.CommandSpec{}, nil, fmt.Errorf("tests unavailable for %s", a.name)
	}
	binary, err := a.test.locate(request.WorkingDirectory)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	reports := ""
	if strings.Contains(strings.Join(a.test.args, " "), reportDirectory) {
		reports, err = os.MkdirTemp("", "adomnia-tests-*")
		if err != nil {
			return run.CommandSpec{}, nil, fmt.Errorf("could not create the test report folder: %w", err)
		}
	}
	arguments := make([]string, len(a.test.args))
	for i, argument := range a.test.args {
		arguments[i] = strings.ReplaceAll(argument, reportDirectory, reports)
	}
	if a.test.prepare != nil {
		arguments, err = a.test.prepare(request.WorkingDirectory, arguments)
		if err != nil {
			if reports != "" {
				_ = os.RemoveAll(reports) // best effort: the folder is empty
			}
			return run.CommandSpec{}, nil, err
		}
	}
	var options struct {
		Run string `json:"run"`
	}
	if len(request.LanguageOptions) > 0 {
		_ = json.Unmarshal(request.LanguageOptions, &options) // the host always sends its own options
	}
	if strings.TrimSpace(options.Run) != "" {
		if a.test.rerun == nil {
			if reports != "" {
				_ = os.RemoveAll(reports)
			}
			return run.CommandSpec{}, nil, fmt.Errorf("rerunning a single test is not supported for %s yet", a.name)
		}
		arguments = a.test.rerun(options.Run, arguments)
	}
	if err := run.CheckBatchSafe(binary, arguments); err != nil {
		if reports != "" {
			_ = os.RemoveAll(reports) // best effort: the folder is empty
		}
		return run.CommandSpec{}, nil, err
	}
	spec := run.CommandSpec{Executable: binary, Arguments: arguments, WorkingDirectory: request.WorkingDirectory,
		Environment: append([]string(nil), request.Environment...), DisplayCommand: a.test.command + " " + strings.ReplaceAll(strings.Join(a.test.args, " "), reportDirectory, "<report folder>")}
	var parser idetesting.EventParser
	switch {
	case a.test.parser != nil:
		parser = a.test.parser()
	case a.test.reportDir != nil:
		parser = &reportParser{directory: a.test.reportDir(request.WorkingDirectory), keep: true}
	default:
		parser = &reportParser{directory: reports}
	}
	// Coverage tools of declared ecosystems do not share a flag or a report path: scan the standard
	// files they may have written after the run, without changing the runner command.
	return spec, &coverageParser{inner: parser, root: request.WorkingDirectory}, nil
}

// prepareCTest points ctest at the directory CMake actually configured. `build/` is only the
// convention: presets and IDEs use cmake-build-*/build-*/out/build/<preset>.
func prepareCTest(workingDirectory string, args []string) ([]string, error) {
	build, err := ctestBuildDirectory(workingDirectory)
	if err != nil {
		return nil, err
	}
	adapted := append([]string(nil), args...)
	for index := 0; index+1 < len(adapted); index++ {
		if adapted[index] == "--test-dir" {
			adapted[index+1] = build
			return adapted, nil
		}
	}
	return adapted, nil
}

// ctestBuildDirectory returns the first configured CMake build directory, relative to the project.
func ctestBuildDirectory(workingDirectory string) (string, error) {
	candidates := []string{"build"}
	for _, pattern := range []string{"cmake-build-*", "build-*", filepath.Join("out", "build", "*")} {
		matches, _ := filepath.Glob(filepath.Join(workingDirectory, pattern))
		for _, match := range matches {
			if info, err := os.Stat(match); err == nil && info.IsDir() {
				relative, relErr := filepath.Rel(workingDirectory, match)
				if relErr == nil {
					candidates = append(candidates, relative)
				}
			}
		}
	}
	for _, candidate := range candidates {
		marker := filepath.Join(workingDirectory, candidate, "CTestTestfile.cmake")
		if info, err := os.Stat(marker); err == nil && info.Mode().IsRegular() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("no configured CMake build directory: run `cmake -B build` first (ctest needs CTestTestfile.cmake)")
}

func (t tester) locate(workingDirectory string) (string, error) {
	if t.local != "" {
		local := filepath.Join(workingDirectory, filepath.FromSlash(t.local))
		candidates := []string{local}
		if runtime.GOOS == "windows" {
			candidates = []string{local + ".bat", local + ".cmd", local}
		}
		for _, candidate := range candidates {
			if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
				return candidate, nil
			}
		}
	}
	binary, err := lookPath(t.command)
	if err != nil {
		return "", fmt.Errorf("%s is not on PATH: install it to run the tests", t.command)
	}
	return binary, nil
}

// reportParser reads the reports once, when the runner exits: their output streams are free text.
type reportParser struct {
	directory string
	// keep leaves a project-owned report folder (sbt target/test-reports) in place.
	keep bool
	done bool
}

func (*reportParser) Parse([]byte) (idetesting.Event, bool) { return idetesting.Event{}, false }

func (p *reportParser) Finish() []idetesting.Event {
	if p.done {
		return nil
	}
	p.done = true
	if !p.keep {
		defer func() { _ = os.RemoveAll(p.directory) }() // best effort: a temporary folder
	}
	var events []idetesting.Event
	_ = filepath.WalkDir(p.directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil || info.Size() > maxReportBytes {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		switch {
		case strings.EqualFold(filepath.Ext(path), ".trx"):
			events = append(events, trxEvents(data)...)
		case strings.EqualFold(filepath.Ext(path), ".json"):
			events = append(events, rspecEvents(data)...)
		case bytes.Contains(data, []byte("<test-suite")):
			events = append(events, tastyEvents(data)...)
		default:
			events = append(events, junitEvents(data)...)
		}
		return nil
	})
	return events
}

// junitNode is <testsuites> or <testsuite>: PHPUnit nests suites, CTest and Swift write one level.
type junitNode struct {
	Name   string      `xml:"name,attr"`
	Time   string      `xml:"time,attr"`
	Suites []junitNode `xml:"testsuite"`
	Cases  []junitCase `xml:"testcase"`
}

type junitCase struct {
	ClassName string       `xml:"classname,attr"`
	Name      string       `xml:"name,attr"`
	Time      string       `xml:"time,attr"`
	Failure   *junitDetail `xml:"failure"`
	Error     *junitDetail `xml:"error"`
	Skipped   *junitDetail `xml:"skipped"`
}

type junitDetail struct {
	Message string `xml:"message,attr"`
	Text    string `xml:",chardata"`
}

func (d *junitDetail) output() string {
	if text := strings.TrimSpace(d.Text); text != "" {
		return text + "\n"
	}
	return strings.TrimSpace(d.Message) + "\n"
}

func junitEvents(data []byte) []idetesting.Event {
	var root junitNode
	if xml.Unmarshal(data, &root) != nil {
		return nil
	}
	return junitSuiteEvents(root, root.Name)
}

func junitSuiteEvents(node junitNode, name string) []idetesting.Event {
	var events []idetesting.Event
	for _, child := range node.Suites {
		events = append(events, junitSuiteEvents(child, child.Name)...)
	}
	results := make([]testResult, 0, len(node.Cases))
	for _, test := range node.Cases {
		result := testResult{suite: test.ClassName, name: test.Name, seconds: seconds(test.Time), outcome: "pass"}
		if result.suite == "" {
			result.suite = name
		}
		switch problem := firstProblem(test); {
		case problem != nil:
			result.outcome, result.output = "fail", problem.output()
		case test.Skipped != nil:
			result.outcome = "skip"
			if reason := strings.TrimSpace(test.Skipped.Message); reason != "" {
				result.output = "Skipped: " + reason + "\n"
			}
		}
		results = append(results, result)
	}
	return append(events, resultEvents(results)...)
}

func firstProblem(test junitCase) *junitDetail {
	if test.Failure != nil {
		return test.Failure
	}
	return test.Error
}

// TRX is the report of `dotnet test --logger trx`.
type trxRun struct {
	Results []struct {
		TestID   string `xml:"testId,attr"`
		Name     string `xml:"testName,attr"`
		Outcome  string `xml:"outcome,attr"`
		Duration string `xml:"duration,attr"`
		Message  string `xml:"Output>ErrorInfo>Message"`
		Stack    string `xml:"Output>ErrorInfo>StackTrace"`
	} `xml:"Results>UnitTestResult"`
	Definitions []struct {
		ID     string `xml:"id,attr"`
		Method struct {
			ClassName string `xml:"className,attr"`
		} `xml:"TestMethod"`
	} `xml:"TestDefinitions>UnitTest"`
}

func trxEvents(data []byte) []idetesting.Event {
	var report trxRun
	if xml.Unmarshal(data, &report) != nil {
		return nil
	}
	classes := make(map[string]string, len(report.Definitions))
	for _, definition := range report.Definitions {
		classes[definition.ID] = definition.Method.ClassName
	}
	results := make([]testResult, 0, len(report.Results))
	for _, test := range report.Results {
		class := classes[test.TestID]
		name := strings.TrimPrefix(test.Name, class+".")
		result := testResult{suite: class, name: name, seconds: trxDuration(test.Duration), outcome: "pass"}
		switch strings.ToLower(test.Outcome) {
		case "passed":
		case "notexecuted", "inconclusive", "skipped":
			result.outcome = "skip"
		default:
			result.outcome = "fail"
			result.output = strings.TrimSpace(test.Message+"\n"+test.Stack) + "\n"
		}
		if result.suite == "" {
			result.suite = "tests"
		}
		results = append(results, result)
	}
	return resultEvents(results)
}

type testResult struct {
	suite, name, outcome, output string
	seconds                      float64
	// failure is the source location of a failed test when the runner reports it (TAP, ExUnit,
	// Dart, RSpec): the UI can open the failing line instead of only the test name.
	failure *idetesting.TestLocation
}

// slashReplacer: the tree nests on "/", which test names may contain (data sets, display names).
var slashReplacer = strings.NewReplacer("/", "∕")

// resultEvents emits the tests of each suite, then the suite itself (failed when one test failed).
func resultEvents(results []testResult) []idetesting.Event {
	var events []idetesting.Event
	failed := map[string]bool{}
	var suites []string
	for _, result := range results {
		suite, name := slashReplacer.Replace(result.suite), slashReplacer.Replace(result.name)
		if _, seen := failed[suite]; !seen {
			failed[suite] = false
			suites = append(suites, suite)
		}
		events = append(events, idetesting.Event{Action: "run", Package: suite, Test: name})
		if result.output != "" {
			events = append(events, idetesting.Event{Action: "output", Package: suite, Test: name, Output: result.output})
		}
		if result.outcome == "fail" {
			failed[suite] = true
		}
		events = append(events, idetesting.Event{Action: result.outcome, Package: suite, Test: name, Elapsed: result.seconds, Failure: result.failure})
	}
	for _, suite := range suites {
		action := "pass"
		if failed[suite] {
			action = "fail"
		}
		events = append(events, idetesting.Event{Action: action, Package: suite})
	}
	return events
}

func seconds(value string) float64 {
	parsed, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(value), ",", ""), 64)
	return parsed
}

// trxDuration reads hh:mm:ss.fffffff.
func trxDuration(value string) float64 {
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return 0
	}
	hours, _ := strconv.ParseFloat(parts[0], 64)
	minutes, _ := strconv.ParseFloat(parts[1], 64)
	return hours*3600 + minutes*60 + seconds(parts[2])
}
