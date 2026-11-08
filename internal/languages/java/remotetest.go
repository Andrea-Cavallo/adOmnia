package java

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

// PluginTestJVM is set by the host when the test runs inside the OSGi framework (a PDE workspace with a
// target): the project JVM that runs Equinox.
type PluginTestJVM struct {
	Java  string `json:"java"`
	Major int    `json:"major"`
	Arch  string `json:"arch,omitempty"`
}

// RemoteTestRunner message prefixes (org.eclipse.jdt.internal.junit.runner.MessageIds): eight characters.
const (
	msgTestStart  = "%TESTS  "
	msgTestEnd    = "%TESTE  "
	msgFailed     = "%FAILED "
	msgError      = "%ERROR  "
	msgTraceStart = "%TRACES "
	msgTraceEnd   = "%TRACEE "
	msgRunEnd     = "%RUNTIME"
	ignoredPrefix = "@Ignore: "
	// remoteDrain is how long Finish waits for the last messages after the framework exits.
	remoteDrain = 2 * time.Second
)

// remoteTestListener receives the RemoteTestRunner reports of one run and turns them into the same suites
// the JUnit XML reader builds, so the shared test tree gets the same events as Maven or Gradle runs.
type remoteTestListener struct {
	root, module string
	listener     net.Listener
	done         chan struct{}

	mu      sync.Mutex
	order   []string
	suites  map[string]*junitSuite
	started map[string]time.Time
	current *junitCase
	trace   *strings.Builder
}

func newRemoteTestListener(root, module string) (*remoteTestListener, int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, 0, fmt.Errorf("no local port for the test reports: %w", err)
	}
	l := &remoteTestListener{
		root: root, module: module, listener: listener, done: make(chan struct{}),
		suites: map[string]*junitSuite{}, started: map[string]time.Time{},
	}
	go l.serve()
	return l, listener.Addr().(*net.TCPAddr).Port, nil
}

// serve accepts the runner's single connection and reads it to the end.
func (l *remoteTestListener) serve() {
	defer close(l.done)
	conn, err := l.listener.Accept()
	if err != nil {
		return // closed before the runner connected: the framework did not start the tests
	}
	defer conn.Close()
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	for scanner.Scan() {
		if l.handle(scanner.Text()) {
			return
		}
	}
}

// handle applies one protocol line; true at the end of the run.
func (l *remoteTestListener) handle(line string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.trace != nil {
		if strings.HasPrefix(line, msgTraceEnd) {
			if l.current != nil {
				l.current.Failure.Text = strings.TrimRight(l.trace.String(), "\n")
			}
			l.trace = nil
			return false
		}
		l.trace.WriteString(line + "\n")
		return false
	}
	switch {
	case strings.HasPrefix(line, msgTestStart):
		id, name := splitRemoteTest(line[len(msgTestStart):])
		l.started[id] = time.Now()
		l.caseOf(name)
	case strings.HasPrefix(line, msgTestEnd):
		id, name := splitRemoteTest(line[len(msgTestEnd):])
		if test := l.caseOf(name); test != nil {
			if started, ok := l.started[id]; ok {
				test.Time = time.Since(started).Seconds()
			}
		}
	case strings.HasPrefix(line, msgFailed), strings.HasPrefix(line, msgError):
		_, name := splitRemoteTest(line[len(msgFailed):])
		if l.current = l.caseOf(name); l.current != nil {
			l.current.Failure = &junitProblem{Message: "failed"}
		}
	case strings.HasPrefix(line, msgTraceStart):
		l.trace = &strings.Builder{}
	case strings.HasPrefix(line, msgRunEnd):
		return true
	}
	return false
}

// caseOf finds or adds the test case of "method(class)"; an ignored test (@Ignore) is skipped.
func (l *remoteTestListener) caseOf(name string) *junitCase {
	ignored := strings.HasPrefix(name, ignoredPrefix)
	name = strings.TrimPrefix(name, ignoredPrefix)
	open := strings.LastIndex(name, "(")
	if open <= 0 || !strings.HasSuffix(name, ")") {
		return nil // a suite line, not a test
	}
	method, class := name[:open], name[open+1:len(name)-1]
	suite, ok := l.suites[class]
	if !ok {
		suite = &junitSuite{Name: class}
		l.suites[class] = suite
		l.order = append(l.order, class)
	}
	for index := range suite.TestCases {
		if suite.TestCases[index].Name == method {
			return &suite.TestCases[index]
		}
	}
	suite.TestCases = append(suite.TestCases, junitCase{ClassName: class, Name: method})
	test := &suite.TestCases[len(suite.TestCases)-1]
	if ignored {
		test.Skipped = &junitSkip{Message: "@Ignore"}
	}
	return test
}

// splitRemoteTest splits "id,name": a comma or backslash inside the name is escaped with a backslash.
func splitRemoteTest(payload string) (id, name string) {
	id, rest, _ := strings.Cut(payload, ",")
	return id, strings.NewReplacer(`\,`, ",", `\\`, `\`).Replace(rest)
}

// Finish implements idetesting.Finisher: the framework has exited, the reports are complete.
func (l *remoteTestListener) Finish() []idetesting.Event {
	select {
	case <-l.done:
	case <-time.After(remoteDrain):
	}
	_ = l.listener.Close() // stops a pending Accept when the runner never connected
	<-l.done
	l.mu.Lock()
	defer l.mu.Unlock()
	var events []idetesting.Event
	for _, class := range l.order {
		suite := *l.suites[class]
		source := testSource(l.module, class)
		pkg := class
		if source != "" {
			pkg = relativeSlash(l.root, source)
		}
		events = append(events, suiteEvents(l.root, pkg, source, suite)...)
	}
	return events
}

func (*remoteTestListener) Parse([]byte) (idetesting.Event, bool) { return idetesting.Event{}, false }

// pluginTestCommand runs JUnit Plug-in Tests in Equinox, as PDE does, and listens for their reports.
func pluginTestCommand(request idetesting.Request, options TestOptions) (run.CommandSpec, idetesting.EventParser, error) {
	if len(options.Packages) == 0 {
		return run.CommandSpec{}, nil, errors.New("JUnit Plug-in Tests run per test class: choose a test file of a bundle")
	}
	if _, err := testClasses(request, options); err != nil { // the same limits and filters as the other runs
		return run.CommandSpec{}, nil, err
	}
	test, err := pluginTestOf(request, options)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	listener, port, err := newRemoteTestListener(request.Root, filepath.Clean(test.dir))
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	test.spec.Port = port
	jvm := options.PluginTest
	launch, err := eclipsepde.PreparePluginTest(request.Root, eclipsepde.LaunchJVM{Major: jvm.Major, Arch: jvm.Arch}, test.spec)
	if err != nil {
		_ = listener.listener.Close() // nothing will connect
		return run.CommandSpec{}, nil, err
	}
	return run.CommandSpec{
		Executable: jvm.Java, Arguments: launch.Arguments, WorkingDirectory: launch.Directory, Environment: request.Environment,
		DisplayCommand: "junit plug-in test · " + test.spec.Bundle + " · " + strings.Join(test.spec.Classes, " "),
	}, listener, nil
}

type pluginTestTarget struct {
	spec eclipsepde.PluginTest
	dir  string
}

// pluginTestOf resolves the selected files to one bundle and its classes.
func pluginTestOf(request idetesting.Request, options TestOptions) (pluginTestTarget, error) {
	var target pluginTestTarget
	for _, file := range options.Packages {
		class, err := eclipsepde.PluginTestClassOf(request.Root, filepath.Join(request.WorkingDirectory, filepath.FromSlash(file)))
		if err != nil {
			return target, err
		}
		if target.spec.Bundle != "" && class.Bundle != target.spec.Bundle {
			return target, errors.New("JUnit Plug-in Tests run one bundle at a time: choose test files of the same bundle")
		}
		target.spec.Bundle, target.spec.TestPlugin, target.dir = class.Bundle, class.TestPlugin, class.Dir
		target.spec.Classes = append(target.spec.Classes, class.Class)
	}
	if methods := methodsOf(options.Run); len(methods) == 1 {
		target.spec.Method = methods[0]
	} else if len(methods) > 1 {
		return target, errors.New("JUnit Plug-in Tests rerun one method at a time")
	}
	return target, nil
}
