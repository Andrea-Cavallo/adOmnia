package goide

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	MaxConsoleBufferBytes  = 4 * 1024 * 1024
	MaxPendingOutputEvents = 256
	MaxConcurrentRuns      = 8
	maxOutputChunkBytes    = 32 * 1024
	maxExecutionHistory    = 100
)

type CommandSpec struct {
	SessionID        SessionID
	Kind             string
	Executable       string
	Arguments        []string
	WorkingDirectory string
	Environment      []string
	DisplayCommand   string
	// OutputTap riceve l'output grezzo prima della pubblicazione (es. il parser di go test -json).
	OutputTap func(stream string, data []byte)
	// QuietStdout non pubblica stdout come run.output: lo consuma soltanto OutputTap.
	QuietStdout bool
	// OnExit viene chiamata una volta a processo terminato, prima dell'evento run.finished.
	OnExit func(Execution)
}

type processEvent struct {
	eventType string
	execution Execution
	payload   any
}

type managedProcess struct {
	command   *exec.Cmd
	stdin     io.WriteCloser
	execution Execution
	stopping  atomic.Bool
	exited    atomic.Bool
	truncated atomic.Bool
	done      chan struct{}
	tap       func(string, []byte)
	quiet     bool
	onExit    func(Execution)
}

type ProcessManager struct {
	mu        sync.RWMutex
	processes map[RunID]*managedProcess
	history   map[RunID]Execution
	events    chan processEvent
	stop      chan struct{}
	stopOnce  sync.Once
	sinkMu    sync.RWMutex
	sink      func(string, Execution, any)
}

func NewProcessManager() *ProcessManager {
	manager := &ProcessManager{
		processes: make(map[RunID]*managedProcess),
		history:   make(map[RunID]Execution),
		events:    make(chan processEvent, MaxPendingOutputEvents),
		stop:      make(chan struct{}),
	}
	go manager.dispatchEvents()
	return manager
}

// SetEventSink collega gli eventi di processo al proprietario applicativo.
func (m *ProcessManager) SetEventSink(sink func(string, Execution, any)) {
	m.sinkMu.Lock()
	m.sink = sink
	m.sinkMu.Unlock()
}

// Start avvia un eseguibile con argomenti strutturati e ne assume l'intero lifecycle.
func (m *ProcessManager) Start(spec CommandSpec) (Execution, error) {
	if strings.TrimSpace(spec.Executable) == "" {
		return Execution{}, fmt.Errorf("eseguibile mancante")
	}
	m.mu.RLock()
	activeCount := len(m.processes)
	m.mu.RUnlock()
	if activeCount >= MaxConcurrentRuns {
		return Execution{}, fmt.Errorf("troppe esecuzioni attive: limite %d", MaxConcurrentRuns)
	}
	command := exec.Command(spec.Executable, spec.Arguments...)
	command.Dir = spec.WorkingDirectory
	command.Env = spec.Environment
	configureProcess(command, false)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return Execution{}, fmt.Errorf("impossibile collegare stdout: %w", err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return Execution{}, fmt.Errorf("impossibile collegare stderr: %w", err)
	}
	stdin, err := command.StdinPipe()
	if err != nil {
		return Execution{}, fmt.Errorf("impossibile collegare stdin: %w", err)
	}
	runID := RunID(newID("run"))
	execution := Execution{
		ID: runID, SessionID: spec.SessionID, Kind: spec.Kind, Status: "running",
		Command: spec.DisplayCommand, WorkingDirectory: spec.WorkingDirectory, StartedAt: time.Now().UTC(),
	}
	if err := command.Start(); err != nil {
		stdin.Close()
		return Execution{}, fmt.Errorf("avvio processo fallito: %w", err)
	}
	execution.PID = command.Process.Pid
	managed := &managedProcess{command: command, stdin: stdin, execution: execution, done: make(chan struct{}), tap: spec.OutputTap, quiet: spec.QuietStdout, onExit: spec.OnExit}
	m.mu.Lock()
	m.processes[runID] = managed
	m.history[runID] = execution
	m.mu.Unlock()
	m.publish(processEvent{eventType: "run.started", execution: execution, payload: execution}, true)
	go m.wait(managed, stdout, stderr)
	return execution, nil
}

// WriteStdin invia testo alla singola esecuzione indicata senza passare da una shell.
func (m *ProcessManager) WriteStdin(runID RunID, text string) error {
	if len(text) > 64*1024 {
		return fmt.Errorf("input troppo grande: limite 65536 byte")
	}
	m.mu.RLock()
	process := m.processes[runID]
	m.mu.RUnlock()
	if process == nil {
		return fmt.Errorf("esecuzione non attiva")
	}
	if _, err := io.WriteString(process.stdin, text); err != nil {
		return fmt.Errorf("invio input fallito: %w", err)
	}
	return nil
}

// Stop interrompe l'intero albero del processo ed è sicuro se richiamato più volte.
func (m *ProcessManager) Stop(runID RunID) error {
	m.mu.RLock()
	process := m.processes[runID]
	m.mu.RUnlock()
	if process == nil {
		return nil
	}
	if !process.stopping.CompareAndSwap(false, true) {
		return nil
	}
	_ = process.stdin.Close()
	if process.exited.Load() {
		return nil
	}
	if err := terminateProcessTree(process.command); err != nil && !process.exited.Load() {
		return err
	}
	return nil
}

// List restituisce snapshot delle esecuzioni note, filtrate facoltativamente per sessione.
func (m *ProcessManager) List(sessionID SessionID) []Execution {
	m.mu.RLock()
	result := make([]Execution, 0, len(m.history))
	for _, execution := range m.history {
		if sessionID == "" || execution.SessionID == sessionID {
			result = append(result, execution)
		}
	}
	m.mu.RUnlock()
	return result
}

// HasActiveSession indica se la sessione possiede processi ancora attivi.
func (m *ProcessManager) HasActiveSession(sessionID SessionID) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, process := range m.processes {
		if process.execution.SessionID == sessionID {
			return true
		}
	}
	return false
}

// HasActive indica se il manager possiede almeno un processo ancora attivo.
func (m *ProcessManager) HasActive() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.processes) > 0
}

// StopSession arresta tutti i processi posseduti da una sessione.
func (m *ProcessManager) StopSession(sessionID SessionID) {
	m.mu.RLock()
	ids := make([]RunID, 0)
	for id, process := range m.processes {
		if process.execution.SessionID == sessionID {
			ids = append(ids, id)
		}
	}
	m.mu.RUnlock()
	for _, id := range ids {
		_ = m.Stop(id)
	}
}

// Shutdown interrompe tutte le esecuzioni di cui il manager mantiene l'ownership.
func (m *ProcessManager) Shutdown() {
	m.mu.RLock()
	ids := make([]RunID, 0, len(m.processes))
	for id := range m.processes {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		_ = m.Stop(id)
	}
	for _, id := range ids {
		m.mu.RLock()
		process := m.processes[id]
		m.mu.RUnlock()
		if process != nil {
			select {
			case <-process.done:
			case <-time.After(3 * time.Second):
			}
		}
	}
	m.stopOnce.Do(func() { close(m.stop) })
}

func (m *ProcessManager) wait(process *managedProcess, stdout, stderr io.ReadCloser) {
	var readers sync.WaitGroup
	readers.Add(2)
	go func() { defer readers.Done(); m.readOutput(process, "stdout", stdout) }()
	go func() { defer readers.Done(); m.readOutput(process, "stderr", stderr) }()
	err := process.command.Wait()
	process.exited.Store(true)
	readers.Wait()
	_ = process.stdin.Close()
	finished := time.Now().UTC()
	execution := process.execution
	execution.FinishedAt = &finished
	execution.DurationMillis = finished.Sub(execution.StartedAt).Milliseconds()
	exitCode := 0
	if process.command.ProcessState != nil {
		exitCode = process.command.ProcessState.ExitCode()
	}
	execution.ExitCode = &exitCode
	switch {
	case process.stopping.Load():
		execution.Status = "stopped"
	case err == nil:
		execution.Status = "exited"
	default:
		execution.Status = "failed"
		var exitError *exec.ExitError
		if !errors.As(err, &exitError) {
			execution.Error = err.Error()
		}
	}
	m.mu.Lock()
	delete(m.processes, execution.ID)
	m.history[execution.ID] = execution
	m.pruneHistoryLocked()
	m.mu.Unlock()
	process.execution = execution
	if process.onExit != nil {
		process.onExit(execution)
	}
	close(process.done)
	m.publish(processEvent{eventType: "run.finished", execution: execution, payload: execution}, true)
}

func (m *ProcessManager) readOutput(process *managedProcess, stream string, reader io.Reader) {
	buffered := bufio.NewReaderSize(reader, maxOutputChunkBytes)
	buffer := make([]byte, maxOutputChunkBytes)
	for {
		read, err := buffered.Read(buffer)
		if read > 0 && process.tap != nil {
			process.tap(stream, buffer[:read])
		}
		if read > 0 && !(process.quiet && stream == "stdout") {
			output := ProcessOutput{RunID: process.execution.ID, Stream: stream, Text: string(buffer[:read])}
			if !m.publish(processEvent{eventType: "run.output", execution: process.execution, payload: output}, false) && process.truncated.CompareAndSwap(false, true) {
				output.Text = "\n[adOmnia] Output ridotto: la coda eventi ha raggiunto il limite.\n"
				output.Truncated = true
				m.publish(processEvent{eventType: "run.output", execution: process.execution, payload: output}, true)
			}
		}
		if err != nil {
			return
		}
	}
}

func (m *ProcessManager) pruneHistoryLocked() {
	for len(m.history) > maxExecutionHistory {
		var oldestID RunID
		var oldest time.Time
		for id, execution := range m.history {
			if _, active := m.processes[id]; active {
				continue
			}
			if oldestID == "" || execution.StartedAt.Before(oldest) {
				oldestID = id
				oldest = execution.StartedAt
			}
		}
		if oldestID == "" {
			return
		}
		delete(m.history, oldestID)
	}
}

func (m *ProcessManager) publish(event processEvent, important bool) bool {
	if important {
		select {
		case m.events <- event:
			return true
		case <-time.After(2 * time.Second):
			return false
		case <-m.stop:
			return false
		}
	}
	select {
	case m.events <- event:
		return true
	default:
		return false
	}
}

func (m *ProcessManager) dispatchEvents() {
	for {
		select {
		case event := <-m.events:
			m.sinkMu.RLock()
			sink := m.sink
			m.sinkMu.RUnlock()
			if sink != nil {
				sink(event.eventType, event.execution, event.payload)
			}
		case <-m.stop:
			return
		}
	}
}
