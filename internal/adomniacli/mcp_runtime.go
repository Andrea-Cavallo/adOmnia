package adomniacli

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	ideprocess "github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// Runtime for agents: start the workspace in Equinox with the console on a local port, read
// the real state (ACTIVE, services, activation order, Equinox diag) and stop it. The
// process belongs to this MCP process and is killed when the server exits.

const (
	mcpRuntimeStartBudget = 60 * time.Second
	mcpRuntimeSettle      = 20 * time.Second
	mcpRuntimePoll        = 250 * time.Millisecond
	mcpRuntimeCommandTTL  = 10 * time.Second
	mcpRuntimeLogLimit    = 8 * 1024
)

type osgiRuntimeProcess struct {
	root      string
	command   *exec.Cmd
	address   string
	port      int
	startedAt time.Time
	log       *tailBuffer

	mu         sync.Mutex
	console    *eclipsepde.Console
	activeAt   map[int]int64
	firstState time.Time
}

// tailBuffer keeps the last bytes of the framework output for error messages.
type tailBuffer struct {
	mu    sync.Mutex
	data  []byte
	limit int
}

func newTailBuffer(limit int) *tailBuffer { return &tailBuffer{limit: limit} }

func (b *tailBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data = append(b.data, p...)
	if len(b.data) > b.limit {
		b.data = append([]byte{}, b.data[len(b.data)-b.limit:]...)
	}
	return len(p), nil
}

func (b *tailBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return strings.TrimSpace(string(b.data))
}

// callRuntimeTool dispatches the runtime tools.
func (s *mcpServer) callRuntimeTool(name string, raw jsonv1.RawMessage) (string, error) {
	var args mcpWorkspaceArgs
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
	}
	switch name {
	case "osgi_runtime":
		return s.osgiRuntimeStatus(args)
	case "osgi_runtime_start":
		return s.osgiRuntimeStart(args)
	case "osgi_runtime_snapshot":
		return s.osgiRuntimeSnapshot(args)
	case "osgi_runtime_stop":
		return s.osgiRuntimeStop(args)
	}
	return "", fmt.Errorf("unknown runtime tool %q", name)
}

// runtimeFor returns the running runtime of a workspace.
func (s *mcpServer) runtimeFor(root string) (*osgiRuntimeProcess, error) {
	runtime := s.runtimeLocked(root)
	if runtime == nil {
		return nil, fmt.Errorf("the OSGi runtime is not running for %s: call osgi_runtime_start", root)
	}
	return runtime, nil
}

func (s *mcpServer) osgiRuntimeStatus(args mcpWorkspaceArgs) (string, error) {
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	s.runtimeMu.Lock()
	runtime := s.runtimes[root]
	s.runtimeMu.Unlock()
	if runtime == nil {
		return jsonText(map[string]any{"running": false, "workspace": root})
	}
	return jsonText(map[string]any{"running": true, "workspace": root, "address": runtime.address, "port": runtime.port, "startedAt": runtime.startedAt})
}

func (s *mcpServer) osgiRuntimeStart(args mcpWorkspaceArgs) (string, error) {
	if err := s.requireWrite(); err != nil {
		return "", fmt.Errorf("%w (starting a JVM is a local action, so it needs the same opt-in)", err)
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	if existing := s.runtimeLocked(root); existing != nil {
		snapshot, err := s.captureRuntime(existing)
		if err == nil {
			return jsonText(snapshot)
		}
		s.stopRuntime(root)
	}
	jdk, err := mcpRuntimeJDK(root)
	if err != nil {
		return "", err
	}
	port, err := mcpFreePort()
	if err != nil {
		return "", err
	}
	launch, err := eclipsepde.PrepareRuntime(root, eclipsepde.LaunchJVM{Major: jdk.Major, Arch: jdk.Arch}, port)
	if err != nil {
		return "", err
	}
	command := procutil.Command(jdk.Binary, launch.Arguments...)
	command.Dir = launch.Directory
	command.Env = append(os.Environ(), java.JavaEnvironment(jdk.Home)...)
	ideprocess.Configure(command, false)
	log := newTailBuffer(mcpRuntimeLogLimit)
	command.Stdout = log
	command.Stderr = log
	if err := command.Start(); err != nil {
		return "", fmt.Errorf("could not start Equinox with %s: %w", jdk.Binary, err)
	}
	runtime := &osgiRuntimeProcess{
		root: root, command: command, address: net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), port: port,
		startedAt: time.Now(), log: log, activeAt: map[int]int64{},
	}
	s.runtimeMu.Lock()
	if s.runtimes == nil {
		s.runtimes = map[string]*osgiRuntimeProcess{}
	}
	s.runtimes[root] = runtime
	s.runtimeMu.Unlock()
	go func() {
		_ = command.Wait()
		s.runtimeMu.Lock()
		if s.runtimes[root] == runtime {
			delete(s.runtimes, root)
		}
		s.runtimeMu.Unlock()
		runtime.closeConsole()
		s.clearRuntimeOverlay(root)
	}()
	snapshot, err := s.captureRuntime(runtime)
	if err != nil {
		logTailText := logTail(log, 6)
		s.stopRuntime(root)
		if logTailText != "" {
			return "", fmt.Errorf("%w: %s", err, logTailText)
		}
		return "", err
	}
	for _, problem := range launch.Problems {
		snapshot.Problems = append(snapshot.Problems, problem.String())
	}
	return jsonText(snapshot)
}

func (s *mcpServer) osgiRuntimeSnapshot(args mcpWorkspaceArgs) (string, error) {
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	runtime, err := s.runtimeFor(root)
	if err != nil {
		return "", err
	}
	snapshot, err := s.captureRuntime(runtime)
	if err != nil {
		return "", err
	}
	return jsonText(snapshot)
}

func (s *mcpServer) osgiRuntimeStop(args mcpWorkspaceArgs) (string, error) {
	if err := s.requireWrite(); err != nil {
		return "", err
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	running := s.runtimes[root] != nil
	s.stopRuntime(root)
	return jsonText(map[string]any{"stopped": running, "workspace": root})
}

// stopRuntime closes the console, kills the JVM and clears the overlay.
func (s *mcpServer) stopRuntime(root string) {
	s.runtimeMu.Lock()
	runtime := s.runtimes[root]
	delete(s.runtimes, root)
	s.runtimeMu.Unlock()
	if runtime == nil {
		return
	}
	runtime.closeConsole()
	_ = ideprocess.TerminateTree(runtime.command)
	s.clearRuntimeOverlay(root)
}

// stopAllRuntimes runs when the MCP server exits.
func (s *mcpServer) stopAllRuntimes() {
	s.runtimeMu.Lock()
	roots := make([]string, 0, len(s.runtimes))
	for root := range s.runtimes {
		roots = append(roots, root)
	}
	s.runtimeMu.Unlock()
	for _, root := range roots {
		s.stopRuntime(root)
	}
}

// clearRuntimeOverlay removes ACTIVE states from the cached explorer.
func (s *mcpServer) clearRuntimeOverlay(root string) {
	s.workspaceMu.Lock()
	report := s.osgiReports[root]
	s.workspaceMu.Unlock()
	if report == nil {
		return
	}
	report.Runtime = nil
	report.RuntimeDiagnostics = nil
	report.Summary.Active = 0
	report.Summary.Services = 0
	report.Summary.RuntimeIssues = 0
	for index := range report.Bundles {
		report.Bundles[index].RuntimeState = ""
		report.Bundles[index].ActiveAtMs = 0
	}
}

// captureRuntime polls the framework until its state settles, then reads services, start
// level and the Equinox diagnosis of what did not resolve.
func (s *mcpServer) captureRuntime(runtime *osgiRuntimeProcess) (*eclipsepde.RuntimeSnapshot, error) {
	report, _, err := s.osgiReport(runtime.root)
	if err != nil {
		return nil, err
	}
	if _, err := s.connectConsole(runtime); err != nil {
		return nil, err
	}
	snapshot := &eclipsepde.RuntimeSnapshot{Address: runtime.address, Port: runtime.port, CapturedAt: time.Now(), Diagnoses: map[int][]string{}}
	deadline := time.Now().Add(mcpRuntimeSettle)
	var previous []eclipsepde.RuntimeBundle
	stable := 0
	for {
		output, err := runtime.ask("ss")
		if err != nil {
			return snapshot, err
		}
		bundles := eclipsepde.ParseBundleStates(output)
		now := time.Since(runtime.startedAt).Milliseconds()
		if len(bundles) > 0 && runtime.firstState.IsZero() {
			runtime.mu.Lock()
			runtime.firstState = time.Now()
			runtime.mu.Unlock()
		}
		for index := range bundles {
			if bundles[index].State != "ACTIVE" {
				continue
			}
			runtime.mu.Lock()
			if _, seen := runtime.activeAt[bundles[index].ID]; !seen {
				runtime.activeAt[bundles[index].ID] = now
			}
			bundles[index].ActiveAtMs = runtime.activeAt[bundles[index].ID]
			runtime.mu.Unlock()
		}
		if sameRuntimeStates(previous, bundles) {
			stable++
		} else {
			stable = 0
		}
		previous = bundles
		if stable >= 2 {
			snapshot.Settled = true
			break
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(mcpRuntimePoll)
	}
	snapshot.Bundles = previous
	runtime.mu.Lock()
	if !runtime.firstState.IsZero() {
		snapshot.StartupMs = runtime.firstState.Sub(runtime.startedAt).Milliseconds()
	}
	runtime.mu.Unlock()
	if output, err := runtime.ask("startlevel"); err == nil {
		snapshot.FrameworkStartLevel = eclipsepde.ParseStartLevel(output)
	} else {
		snapshot.Problems = append(snapshot.Problems, "startlevel: "+err.Error())
	}
	if output, err := runtime.ask("services"); err == nil {
		snapshot.Services = eclipsepde.ParseServices(output)
	} else {
		snapshot.Problems = append(snapshot.Problems, "services: "+err.Error())
	}
	workspace := map[string]bool{}
	for _, row := range report.Bundles {
		if row.Source == "workspace" {
			workspace[row.SymbolicName] = true
		}
	}
	for _, bundle := range snapshot.Bundles {
		if bundle.State != "INSTALLED" || !workspace[bundle.SymbolicName] {
			continue
		}
		output, err := runtime.ask("diag " + strconv.Itoa(bundle.ID))
		if err != nil {
			snapshot.Problems = append(snapshot.Problems, fmt.Sprintf("diag %d: %v", bundle.ID, err))
			continue
		}
		if lines := eclipsepde.ParseDiagnosis(output); len(lines) > 0 {
			snapshot.Diagnoses[bundle.ID] = lines
		}
	}
	report.CorrelateRuntime(snapshot)
	return snapshot, nil
}

// connectConsole dials the console until the framework is listening.
func (s *mcpServer) connectConsole(runtime *osgiRuntimeProcess) (*eclipsepde.Console, error) {
	runtime.mu.Lock()
	existing := runtime.console
	runtime.mu.Unlock()
	if existing != nil {
		return existing, nil
	}
	deadline := time.Now().Add(mcpRuntimeStartBudget)
	var lastErr error
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		console, err := eclipsepde.DialConsole(ctx, runtime.address)
		cancel()
		if err == nil {
			runtime.mu.Lock()
			runtime.console = console
			runtime.mu.Unlock()
			return console, nil
		}
		lastErr = err
		time.Sleep(mcpRuntimePoll)
	}
	if lastErr == nil {
		lastErr = errors.New("the console did not start")
	}
	return nil, fmt.Errorf("the Equinox console on %s did not answer: %w", runtime.address, lastErr)
}

// ask runs one console command, reconnecting once after a broken socket.
func (runtime *osgiRuntimeProcess) ask(command string) (string, error) {
	runtime.mu.Lock()
	console := runtime.console
	runtime.mu.Unlock()
	if console == nil {
		return "", errors.New("the console is not connected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), mcpRuntimeCommandTTL)
	defer cancel()
	output, err := console.Ask(ctx, command)
	if err == nil {
		return output, nil
	}
	runtime.closeConsole()
	dialCtx, cancelDial := context.WithTimeout(context.Background(), 5*time.Second)
	reconnected, dialErr := eclipsepde.DialConsole(dialCtx, runtime.address)
	cancelDial()
	if dialErr != nil {
		return output, err
	}
	runtime.mu.Lock()
	runtime.console = reconnected
	runtime.mu.Unlock()
	ctx, cancel = context.WithTimeout(context.Background(), mcpRuntimeCommandTTL)
	defer cancel()
	return reconnected.Ask(ctx, command)
}

func (runtime *osgiRuntimeProcess) closeConsole() {
	runtime.mu.Lock()
	console := runtime.console
	runtime.console = nil
	runtime.mu.Unlock()
	if console != nil {
		_ = console.Close()
	}
}

func sameRuntimeStates(previous, current []eclipsepde.RuntimeBundle) bool {
	if len(previous) != len(current) {
		return false
	}
	for index := range current {
		if previous[index].ID != current[index].ID || previous[index].State != current[index].State {
			return false
		}
	}
	return true
}

// mcpRuntimeJDK picks the JVM for the runtime: the project JDK when set, else the newest
// installed one that Equinox 3.9 can run.
func mcpRuntimeJDK(root string) (java.JDK, error) {
	if home := java.ProjectJavaHome(root); home != "" {
		if jdk, ok := java.InspectJDK(home, "project"); ok {
			return jdk, nil
		}
	}
	installed := java.DiscoverJDKs()
	usable := make([]java.JDK, 0, len(installed))
	for _, jdk := range installed {
		if jdk.Available {
			usable = append(usable, jdk)
		}
	}
	if len(usable) == 0 {
		return java.JDK{}, fmt.Errorf("no JDK found: select one in Java > Select JDK, or set JAVA_HOME")
	}
	sort.SliceStable(usable, func(i, j int) bool {
		left, right := usable[i].Major, usable[j].Major
		leftOK, rightOK := left > 0 && left <= 8, right > 0 && right <= 8
		if leftOK != rightOK {
			return leftOK
		}
		return left > right
	})
	return usable[0], nil
}

// mcpFreePort reserves an ephemeral loopback port for the console.
func mcpFreePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = listener.Close() }()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, errors.New("could not reserve a local port")
	}
	return address.Port, nil
}

// runtimeLocked returns the runtime of a workspace under the lock.
func (s *mcpServer) runtimeLocked(root string) *osgiRuntimeProcess {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	return s.runtimes[root]
}

// logTail is the last lines of the framework output, for error messages.
func logTail(log *tailBuffer, lines int) string {
	text := log.String()
	if text == "" {
		return ""
	}
	split := strings.Split(text, "\n")
	if len(split) > lines {
		split = split[len(split)-lines:]
	}
	return strings.Join(split, "\n")
}
