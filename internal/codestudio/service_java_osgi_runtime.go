package codestudio

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// The runtime adapter of the OSGi Control Center: adOmnia starts the project in Equinox with
// the console on a local port, then asks the framework for the truth (`ss`, `services`,
// `startlevel`, `diag`). Nothing is instrumented and nothing needs a newer Java: the console
// bundles are the ones already in a Kepler-era target platform.

const (
	osgiRuntimeKind = "osgi-runtime"
	// osgiRuntimeStartBudget is how long the framework may take to answer the console.
	osgiRuntimeStartBudget = 60 * time.Second
	// osgiRuntimeSettleBudget bounds the ACTIVE observation after the first answer.
	osgiRuntimeSettleBudget = 25 * time.Second
	osgiRuntimePollInterval = 250 * time.Millisecond
	osgiConsoleCommandTTL   = 10 * time.Second
)

// osgiRuntime is the console connection and the process of one session.
type osgiRuntime struct {
	sessionID   SessionID
	executionID RunID
	port        int
	address     string
	startedAt   time.Time

	mu         sync.Mutex
	console    *eclipsepde.Console
	activeAt   map[int]int64
	firstState time.Time
}

var (
	osgiRuntimes sync.Map
	// osgiConsoleDial is a variable so the tests can talk to a fake console.
	osgiConsoleDial = eclipsepde.DialConsole
)

// StartJavaOsgiRuntime launches the bundles in Equinox with the console on a local port and
// returns the real state. A runtime already running for the session is reused.
func (s *Service) StartJavaOsgiRuntime(sessionID string) (*eclipsepde.RuntimeSnapshot, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	if cached, ok := osgiRuntimes.Load(session.ID); ok {
		if runtime, valid := cached.(*osgiRuntime); valid {
			if snapshot, err := s.captureJavaOsgiRuntime(session, runtime); err == nil {
				return snapshot, nil
			}
			// The process died or the console closed: clean it up and start again.
			_ = s.StopJavaOsgiRuntime(sessionID)
		}
	}
	jvm, err := s.osgiJVM(session)
	if err != nil {
		return nil, err
	}
	port, err := freeLocalPort()
	if err != nil {
		return nil, err
	}
	launch, err := eclipsepde.PrepareRuntime(session.Project.RealPath, eclipsepde.LaunchJVM{Major: jvm.Major, Arch: jvm.Arch}, port)
	if err != nil {
		return nil, err
	}
	environment, err := s.executionEnvironment(session.ID, java.ID, nil)
	if err != nil {
		return nil, err
	}
	runtime := &osgiRuntime{
		sessionID: session.ID, port: port, address: net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
		startedAt: time.Now(), activeAt: map[int]int64{},
	}
	execution, err := s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: osgiRuntimeKind, Executable: jvm.Binary, Arguments: launch.Arguments,
		WorkingDirectory: launch.Directory, Environment: environment,
		DisplayCommand: fmt.Sprintf("equinox runtime console on 127.0.0.1:%d", port),
		OnExit: func(Execution) {
			runtime.closeConsole()
			osgiRuntimes.Delete(session.ID)
			s.clearJavaOsgiRuntimeOverlay(session.ID)
		},
	})
	if err != nil {
		return nil, err
	}
	runtime.executionID = execution.ID
	osgiRuntimes.Store(session.ID, runtime)
	snapshot, err := s.captureJavaOsgiRuntime(session, runtime)
	if err != nil {
		s.StopJavaOsgiRuntime(sessionID)
		return nil, err
	}
	if len(launch.Problems) > 0 {
		for _, problem := range launch.Problems {
			snapshot.Problems = append(snapshot.Problems, problem.String())
		}
	}
	return snapshot, nil
}

// JavaOsgiRuntimeSnapshot captures the current state of the running framework again.
func (s *Service) JavaOsgiRuntimeSnapshot(sessionID string) (*eclipsepde.RuntimeSnapshot, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	cached, ok := osgiRuntimes.Load(session.ID)
	if !ok {
		return nil, errors.New("the OSGi runtime is not running: start it in the Runtime tab")
	}
	runtime, valid := cached.(*osgiRuntime)
	if !valid {
		return nil, errors.New("the OSGi runtime is not available")
	}
	return s.captureJavaOsgiRuntime(session, runtime)
}

// StopJavaOsgiRuntime closes the console and stops the framework process.
func (s *Service) StopJavaOsgiRuntime(sessionID string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	cached, ok := osgiRuntimes.LoadAndDelete(session.ID)
	if !ok {
		return nil
	}
	runtime, valid := cached.(*osgiRuntime)
	if !valid {
		return nil
	}
	runtime.closeConsole()
	_ = s.processes.Stop(runtime.executionID)
	// The runtime states are no longer true: drop the overlay from the explorer.
	s.clearJavaOsgiRuntimeOverlay(session.ID)
	return nil
}

// clearJavaOsgiRuntimeOverlay removes the ACTIVE states and the runtime diagnostics from the
// cached explorer, without building it: the next panel load rebuilds it if needed.
func (s *Service) clearJavaOsgiRuntimeOverlay(sessionID SessionID) {
	cached, ok := osgiExplorers.Load(sessionID)
	if !ok {
		return
	}
	report, valid := cached.(*eclipsepde.ExplorerReport)
	if !valid {
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

// captureJavaOsgiRuntime connects (or reconnects) to the console, observes the activation
// order, then reads start level, services and the Equinox diagnosis of what did not resolve.
func (s *Service) captureJavaOsgiRuntime(session Session, runtime *osgiRuntime) (*eclipsepde.RuntimeSnapshot, error) {
	report, err := s.osgiExplorerReport(session)
	if err != nil {
		return nil, err
	}
	console, err := s.connectRuntimeConsole(runtime)
	if err != nil {
		return nil, err
	}
	snapshot := &eclipsepde.RuntimeSnapshot{Address: runtime.address, Port: runtime.port, CapturedAt: time.Now(), Diagnoses: map[int][]string{}}

	// Observe the bundles until the state stops changing: the first ACTIVE time of each
	// bundle is the honest startup timeline.
	deadline := time.Now().Add(osgiRuntimeSettleBudget)
	var previous []eclipsepde.RuntimeBundle
	stable := 0
	for {
		output, err := runtime.ask("ss")
		if err != nil {
			snapshot.Problems = append(snapshot.Problems, "ss: "+err.Error())
			if reconnect, dialErr := s.connectRuntimeConsole(runtime); dialErr == nil {
				console = reconnect
				continue
			}
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
		time.Sleep(osgiRuntimePollInterval)
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

	// Ask Equinox why a workspace bundle is not resolved: its own words beat any guess.
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

	// Write the real states onto the cached explorer: ACTIVE only ever comes from here.
	report.CorrelateRuntime(snapshot)
	_ = console
	return snapshot, nil
}

// connectRuntimeConsole dials the console until the framework is listening.
func (s *Service) connectRuntimeConsole(runtime *osgiRuntime) (*eclipsepde.Console, error) {
	runtime.mu.Lock()
	existing := runtime.console
	runtime.mu.Unlock()
	if existing != nil {
		return existing, nil
	}
	deadline := time.Now().Add(osgiRuntimeStartBudget)
	var lastErr error
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		console, err := osgiConsoleDial(ctx, runtime.address)
		cancel()
		if err == nil {
			runtime.mu.Lock()
			runtime.console = console
			runtime.mu.Unlock()
			return console, nil
		}
		lastErr = err
		time.Sleep(osgiRuntimePollInterval)
	}
	if lastErr == nil {
		lastErr = errors.New("the console did not start")
	}
	return nil, fmt.Errorf("the Equinox console on %s did not answer: %w", runtime.address, lastErr)
}

// ask runs one console command with a short deadline and reconnects once if the socket died.
func (runtime *osgiRuntime) ask(command string) (string, error) {
	runtime.mu.Lock()
	console := runtime.console
	runtime.mu.Unlock()
	if console == nil {
		return "", errors.New("the console is not connected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), osgiConsoleCommandTTL)
	defer cancel()
	output, err := console.Ask(ctx, command)
	if err == nil {
		return output, nil
	}
	// One reconnect: Equinox's console closes the socket when the framework stops.
	runtime.closeConsole()
	reconnected, dialErr := osgiConsoleDial(context.Background(), runtime.address)
	if dialErr != nil {
		return output, err
	}
	runtime.mu.Lock()
	runtime.console = reconnected
	runtime.mu.Unlock()
	ctx, cancel = context.WithTimeout(context.Background(), osgiConsoleCommandTTL)
	defer cancel()
	return reconnected.Ask(ctx, command)
}

func (runtime *osgiRuntime) closeConsole() {
	runtime.mu.Lock()
	console := runtime.console
	runtime.console = nil
	runtime.mu.Unlock()
	if console != nil {
		_ = console.Close()
	}
}

// sameRuntimeStates says whether two observations are identical.
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
