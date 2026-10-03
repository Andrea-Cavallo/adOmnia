package run

import (
	processcore "adomnia/internal/ide/process"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

const (
	MaxConsoleBufferBytes  = 4 * 1024 * 1024
	MaxPendingOutputEvents = 256
	MaxConcurrentRuns      = 8
	maxStdinBytes          = 64 * 1024
	maxExecutionHistory    = 100
	// processWaitDelay limita quanto Wait attende la chiusura di stdout/stderr
	// dopo l'uscita del processo: un nipote rimasto vivo che eredita le pipe non
	// deve lasciare l'esecuzione appesa in "running" per sempre.
	processWaitDelay = 2 * time.Second
	// shutdownGracePeriod è il tempo totale concesso a tutte le esecuzioni per
	// uscire alla chiusura dell'applicazione.
	shutdownGracePeriod = 3 * time.Second
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
	// OnStop viene chiamata da Stop prima di terminare l'albero del processo:
	// serve quando uccidere il client non basta (es. docker stop del container).
	OnStop func()
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
	onStop    func()
}

type ProcessManager struct {
	// startMu serializza gli avvii: controllo del limite, spawn e registrazione
	// avvengono come un'unica operazione, così il limite non è mai superato.
	startMu   sync.Mutex
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
		return Execution{}, errors.New("eseguibile mancante")
	}
	m.startMu.Lock()
	defer m.startMu.Unlock()
	m.mu.RLock()
	activeCount := len(m.processes)
	m.mu.RUnlock()
	if activeCount >= MaxConcurrentRuns {
		return Execution{}, fmt.Errorf("troppe esecuzioni attive: limite %d", MaxConcurrentRuns)
	}

	execution := Execution{
		ID: RunID(newID("run")), SessionID: spec.SessionID, Kind: spec.Kind, Status: "running",
		Command: spec.DisplayCommand, WorkingDirectory: spec.WorkingDirectory, StartedAt: time.Now().UTC(),
	}
	managed := &managedProcess{done: make(chan struct{}), tap: spec.OutputTap, quiet: spec.QuietStdout, onExit: spec.OnExit, onStop: spec.OnStop}
	command := exec.Command(spec.Executable, spec.Arguments...)
	command.Dir = spec.WorkingDirectory
	command.Env = spec.Environment
	command.WaitDelay = processWaitDelay
	// Writer invece di StdoutPipe: così Wait attende che l'output sia stato
	// letto per intero e nessuna riga finale va persa all'uscita del processo.
	stdout := &outputWriter{manager: m, process: managed, execution: execution, stream: "stdout"}
	stderr := &outputWriter{manager: m, process: managed, execution: execution, stream: "stderr"}
	command.Stdout = stdout
	command.Stderr = stderr
	processcore.Configure(command, false)
	stdin, err := command.StdinPipe()
	if err != nil {
		return Execution{}, fmt.Errorf("impossibile collegare stdin: %w", err)
	}
	if err := command.Start(); err != nil {
		return Execution{}, fmt.Errorf("avvio processo fallito: %w", err)
	}
	execution.PID = command.Process.Pid
	managed.command = command
	managed.stdin = stdin
	managed.execution = execution

	m.mu.Lock()
	m.processes[execution.ID] = managed
	m.history[execution.ID] = execution
	m.mu.Unlock()
	m.publish(processEvent{eventType: "run.started", execution: execution, payload: execution}, true)
	go m.wait(managed, stdout, stderr)
	return execution, nil
}

// Notice aggiunge all'output di un'esecuzione una riga informativa di adOmnia.
func (m *ProcessManager) Notice(execution Execution, text string) {
	output := ProcessOutput{RunID: execution.ID, Stream: "stderr", Text: "\n[adOmnia] " + text + "\n"}
	m.publish(processEvent{eventType: "run.output", execution: execution, payload: output}, true)
}

// WriteStdin invia testo alla singola esecuzione indicata senza passare da una shell.
func (m *ProcessManager) WriteStdin(runID RunID, text string) error {
	if len(text) > maxStdinBytes {
		return fmt.Errorf("input troppo grande: limite %d byte", maxStdinBytes)
	}
	process := m.active(runID)
	if process == nil {
		return errors.New("esecuzione non attiva")
	}
	if _, err := io.WriteString(process.stdin, text); err != nil {
		return fmt.Errorf("invio input fallito: %w", err)
	}
	return nil
}

// Stop interrompe l'intero albero del processo ed è sicuro se richiamato più volte.
func (m *ProcessManager) Stop(runID RunID) error {
	process := m.active(runID)
	if process == nil || !process.stopping.CompareAndSwap(false, true) {
		return nil
	}
	_ = process.stdin.Close()
	if process.exited.Load() {
		return nil
	}
	if process.onStop != nil {
		process.onStop()
	}
	if process.exited.Load() {
		return nil
	}
	if err := processcore.TerminateTree(process.command); err != nil && !process.exited.Load() {
		return err
	}
	return nil
}

// WaitStopped attende che l'esecuzione indicata sia terminata, entro timeout.
// Restituisce true anche se l'esecuzione non è (più) attiva.
func (m *ProcessManager) WaitStopped(runID RunID, timeout time.Duration) bool {
	process := m.active(runID)
	if process == nil {
		return true
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-process.done:
		return true
	case <-timer.C:
		return false
	}
}

// List restituisce snapshot delle esecuzioni note, dalla più vecchia, filtrate
// facoltativamente per sessione.
func (m *ProcessManager) List(sessionID SessionID) []Execution {
	m.mu.RLock()
	result := make([]Execution, 0, len(m.history))
	for _, execution := range m.history {
		if sessionID == "" || execution.SessionID == sessionID {
			result = append(result, execution)
		}
	}
	m.mu.RUnlock()
	slices.SortFunc(result, func(a, b Execution) int { return a.StartedAt.Compare(b.StartedAt) })
	return result
}

// Execution restituisce lo snapshot più recente dell'esecuzione indicata.
func (m *ProcessManager) Execution(runID RunID) (Execution, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	execution, ok := m.history[runID]
	return execution, ok
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
	for _, process := range m.activeProcesses(sessionID) {
		_ = m.Stop(process.execution.ID)
	}
}

// Shutdown interrompe tutte le esecuzioni di cui il manager mantiene l'ownership
// e attende la loro uscita entro un'unica scadenza complessiva.
func (m *ProcessManager) Shutdown() {
	processes := m.activeProcesses("")
	for _, process := range processes {
		_ = m.Stop(process.execution.ID)
	}
	deadline := time.NewTimer(shutdownGracePeriod)
	defer deadline.Stop()
waiting:
	for _, process := range processes {
		select {
		case <-process.done:
		case <-deadline.C:
			break waiting
		}
	}
	m.stopOnce.Do(func() { close(m.stop) })
}

func (m *ProcessManager) active(runID RunID) *managedProcess {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.processes[runID]
}

// activeProcesses elenca i processi attivi; sessionID vuoto significa tutti.
func (m *ProcessManager) activeProcesses(sessionID SessionID) []*managedProcess {
	m.mu.RLock()
	defer m.mu.RUnlock()
	processes := make([]*managedProcess, 0, len(m.processes))
	for _, process := range m.processes {
		if sessionID == "" || process.execution.SessionID == sessionID {
			processes = append(processes, process)
		}
	}
	return processes
}

func (m *ProcessManager) wait(process *managedProcess, stdout, stderr *outputWriter) {
	err := process.command.Wait()
	process.exited.Store(true)
	// Wait è rientrato: le goroutine di copia sono terminate e i writer non
	// ricevono più byte, quindi si può svuotare il residuo UTF-8 senza lock.
	stdout.flush()
	stderr.flush()
	finished := time.Now().UTC()
	execution := process.execution
	execution.FinishedAt = &finished
	execution.DurationMillis = finished.Sub(execution.StartedAt).Milliseconds()
	exitCode := 0
	if process.command.ProcessState != nil {
		exitCode = process.command.ProcessState.ExitCode()
	}
	execution.ExitCode = &exitCode
	var exitError *exec.ExitError
	switch {
	case process.stopping.Load():
		execution.Status = "stopped"
	// ErrWaitDelay: il processo è uscito con successo ma un discendente teneva
	// ancora aperte le pipe, che sono state chiuse d'ufficio.
	case err == nil, errors.Is(err, exec.ErrWaitDelay):
		execution.Status = "exited"
	case errors.As(err, &exitError):
		execution.Status = "failed"
	default:
		execution.Status = "failed"
		execution.Error = err.Error()
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

// outputWriter pubblica come eventi i byte di un flusso del processo. Non
// spezza mai una sequenza UTF-8 tra due eventi: i byte di un carattere
// incompleto restano in carry fino alla scrittura successiva. exec.Cmd usa una
// goroutine per flusso, quindi ogni writer non è mai chiamato in concorrenza.
type outputWriter struct {
	manager   *ProcessManager
	process   *managedProcess
	execution Execution
	stream    string
	carry     []byte
}

func (w *outputWriter) Write(p []byte) (int, error) {
	if w.process.tap != nil {
		w.process.tap(w.stream, p)
	}
	if w.process.quiet && w.stream == "stdout" {
		return len(p), nil
	}
	data := p
	if len(w.carry) > 0 {
		data = append(w.carry, p...)
		w.carry = nil
	}
	cut := completeUTF8Prefix(data)
	if cut < len(data) {
		w.carry = bytes.Clone(data[cut:])
	}
	w.publish(data[:cut])
	return len(p), nil
}

func (w *outputWriter) flush() {
	w.publish(w.carry)
	w.carry = nil
}

func (w *outputWriter) publish(data []byte) {
	if len(data) == 0 {
		return
	}
	output := ProcessOutput{RunID: w.execution.ID, Stream: w.stream, Text: string(data)}
	if w.manager.publish(processEvent{eventType: "run.output", execution: w.execution, payload: output}, false) {
		return
	}
	if w.process.truncated.CompareAndSwap(false, true) {
		output.Text = "\n[adOmnia] Output ridotto: la coda eventi ha raggiunto il limite.\n"
		output.Truncated = true
		w.manager.publish(processEvent{eventType: "run.output", execution: w.execution, payload: output}, true)
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
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		select {
		case m.events <- event:
			return true
		case <-timer.C:
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

func newID(prefix string) string {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(random)
}

func completeUTF8Prefix(data []byte) int {
	for back := 1; back <= utf8.UTFMax && back <= len(data); back++ {
		start := len(data) - back
		if !utf8.RuneStart(data[start]) {
			continue
		}
		if utf8.FullRune(data[start:]) {
			return len(data)
		}
		return start
	}
	return len(data)
}

func (m *ProcessManager) ActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.processes)
}
