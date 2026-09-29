package goide

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	pty "github.com/aymanbagabas/go-pty"
)

const (
	// MaxTerminalsPerSession evita che una sessione apra shell senza limite.
	MaxTerminalsPerSession = 8
	// terminalReadChunkBytes è la dimensione del buffer di lettura dal PTY.
	terminalReadChunkBytes = 16 * 1024
	// terminalFlushInterval coalesce l'output ad alta frequenza in un solo
	// evento per intervallo, così un comando molto prolisso non inonda la UI.
	terminalFlushInterval = 25 * time.Millisecond
	// terminalDrainTimeout limita l'attesa dell'ultimo output dopo l'uscita.
	terminalDrainTimeout = 2 * time.Second
	defaultTerminalCols  = 80
	defaultTerminalRows  = 24
)

// TerminalSession descrive un terminale interattivo dal punto di vista dell'interfaccia.
type TerminalSession struct {
	ID               TerminalID `json:"id"`
	SessionID        SessionID  `json:"sessionId"`
	Name             string     `json:"name"`
	Shell            string     `json:"shell"`
	WorkingDirectory string     `json:"workingDirectory"`
	Status           string     `json:"status"`
	PID              int        `json:"pid,omitempty"`
	StartedAt        time.Time  `json:"startedAt"`
	ExitedAt         *time.Time `json:"exitedAt,omitempty"`
	ExitCode         *int       `json:"exitCode,omitempty"`
	Error            string     `json:"error,omitempty"`
}

// TerminalOutput è un blocco di byte prodotto dal PTY, già coalescato.
type TerminalOutput struct {
	TerminalID TerminalID `json:"terminalId"`
	Data       string     `json:"data"`
}

// TerminalRequest descrive l'apertura di un nuovo terminale.
type TerminalRequest struct {
	SessionID        SessionID         `json:"sessionId"`
	Name             string            `json:"name"`
	Shell            string            `json:"shell,omitempty"`
	ShellArguments   []string          `json:"shellArguments,omitempty"`
	WorkingDirectory string            `json:"workingDirectory,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
	Columns          int               `json:"columns,omitempty"`
	Rows             int               `json:"rows,omitempty"`
}

type managedTerminal struct {
	pty       pty.Pty
	command   *pty.Cmd
	session   TerminalSession
	closing   atomic.Bool
	exited    atomic.Bool
	done      chan struct{}
	pumped    chan struct{}
	writeMu   sync.Mutex
	sessionMu sync.RWMutex
	closeOnce sync.Once
}

// closePTY rilascia lo pseudo-terminale una sola volta. Su Windows ConPTY una
// seconda chiusura corrompe l'heap del processo (STATUS_HEAP_CORRUPTION), quindi
// proprietario della chiusura è soltanto la goroutine di wait.
func (t *managedTerminal) closePTY() {
	t.closeOnce.Do(func() { _ = t.pty.Close() })
}

// TerminalManager possiede i terminali PTY, isolati per sessione IDE.
type TerminalManager struct {
	openMu    sync.Mutex
	mu        sync.RWMutex
	terminals map[TerminalID]*managedTerminal
	counter   atomic.Uint64
	sinkMu    sync.RWMutex
	sink      func(eventType string, terminal TerminalSession, payload any)
}

func NewTerminalManager() *TerminalManager {
	return &TerminalManager{terminals: make(map[TerminalID]*managedTerminal)}
}

// SetEventSink registra il canale con cui il manager notifica output e stato.
func (m *TerminalManager) SetEventSink(sink func(string, TerminalSession, any)) {
	m.sinkMu.Lock()
	m.sink = sink
	m.sinkMu.Unlock()
}

func (m *TerminalManager) emit(eventType string, terminal TerminalSession, payload any) {
	m.sinkMu.RLock()
	sink := m.sink
	m.sinkMu.RUnlock()
	if sink != nil {
		sink(eventType, terminal, payload)
	}
}

// Open avvia una shell interattiva nella working directory indicata.
// Non inietta mai comandi né credenziali nel terminale appena aperto.
func (m *TerminalManager) Open(request TerminalRequest, environment []string) (TerminalSession, error) {
	if request.SessionID == "" {
		return TerminalSession{}, fmt.Errorf("terminale senza sessione di appartenenza")
	}
	// Controllo del limite, avvio della shell e registrazione sono un'unica
	// operazione: due aperture concorrenti non possono superare il limite.
	m.openMu.Lock()
	defer m.openMu.Unlock()
	if count := m.countForSession(request.SessionID); count >= MaxTerminalsPerSession {
		return TerminalSession{}, fmt.Errorf("massimo %d terminali per sessione", MaxTerminalsPerSession)
	}

	shell := strings.TrimSpace(request.Shell)
	arguments := request.ShellArguments
	if shell == "" {
		shell, arguments = defaultShell()
	}
	if shell == "" {
		return TerminalSession{}, fmt.Errorf("nessuna shell disponibile su questa piattaforma")
	}
	if info, err := os.Stat(request.WorkingDirectory); err != nil || !info.IsDir() {
		return TerminalSession{}, fmt.Errorf("working directory del terminale non valida")
	}

	terminal, err := pty.New()
	if err != nil {
		return TerminalSession{}, fmt.Errorf("apertura pseudo-terminale fallita: %w", err)
	}
	columns, rows := request.Columns, request.Rows
	if columns <= 0 {
		columns = defaultTerminalCols
	}
	if rows <= 0 {
		rows = defaultTerminalRows
	}
	if err := terminal.Resize(columns, rows); err != nil {
		_ = terminal.Close()
		return TerminalSession{}, fmt.Errorf("dimensionamento del terminale fallito: %w", err)
	}

	command := terminal.Command(shell, arguments...)
	command.Dir = request.WorkingDirectory
	command.Env = environment
	if err := command.Start(); err != nil {
		_ = terminal.Close()
		return TerminalSession{}, fmt.Errorf("avvio della shell fallito: %w", err)
	}

	id := TerminalID(fmt.Sprintf("term-%d-%d", time.Now().UnixNano(), m.counter.Add(1)))
	name := strings.TrimSpace(request.Name)
	if name == "" {
		name = shellDisplayName(shell)
	}
	managed := &managedTerminal{
		pty:     terminal,
		command: command,
		done:    make(chan struct{}),
		pumped:  make(chan struct{}),
		session: TerminalSession{
			ID: id, SessionID: request.SessionID, Name: name,
			Shell: shell, WorkingDirectory: request.WorkingDirectory,
			Status: "running", StartedAt: time.Now().UTC(),
		},
	}
	if command.Process != nil {
		managed.session.PID = command.Process.Pid
	}

	m.mu.Lock()
	m.terminals[id] = managed
	m.mu.Unlock()

	m.emit("terminal.opened", managed.snapshot(), nil)
	go m.pump(managed)
	go m.wait(managed)
	return managed.snapshot(), nil
}

// Write invia input dell'utente alla shell. Nessun contenuto viene registrato.
func (m *TerminalManager) Write(id TerminalID, data string) error {
	managed, err := m.lookup(id)
	if err != nil {
		return err
	}
	if managed.exited.Load() {
		return fmt.Errorf("il terminale è terminato")
	}
	managed.writeMu.Lock()
	defer managed.writeMu.Unlock()
	if _, err := io.WriteString(managed.pty, data); err != nil {
		return fmt.Errorf("scrittura sul terminale fallita: %w", err)
	}
	return nil
}

// Resize adatta il PTY alle dimensioni correnti del pannello xterm.
func (m *TerminalManager) Resize(id TerminalID, columns, rows int) error {
	managed, err := m.lookup(id)
	if err != nil {
		return err
	}
	if managed.exited.Load() {
		return nil
	}
	if columns <= 0 || rows <= 0 {
		return fmt.Errorf("dimensioni del terminale non valide")
	}
	if err := managed.pty.Resize(columns, rows); err != nil {
		return fmt.Errorf("ridimensionamento del terminale fallito: %w", err)
	}
	return nil
}

// Close termina shell e intero albero di processi del terminale indicato.
func (m *TerminalManager) Close(id TerminalID) error {
	managed, err := m.lookup(id)
	if err != nil {
		return nil
	}
	m.terminate(managed)
	select {
	case <-managed.done:
	case <-time.After(5 * time.Second):
		// La shell non è uscita in tempo: chiudere il PTY sblocca la lettura e
		// fa rientrare Wait, che completerà la pulizia.
		managed.closePTY()
	}
	m.mu.Lock()
	delete(m.terminals, id)
	m.mu.Unlock()
	return nil
}

// CloseSession chiude soltanto i terminali della sessione indicata, lasciando
// intatti quelli appartenenti alle altre sessioni aperte.
func (m *TerminalManager) CloseSession(sessionID SessionID) {
	for _, id := range m.idsForSession(sessionID) {
		_ = m.Close(id)
	}
}

// List elenca i terminali della sessione indicata.
func (m *TerminalManager) List(sessionID SessionID) []TerminalSession {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sessions := make([]TerminalSession, 0, 4)
	for _, managed := range m.terminals {
		if managed.session.SessionID == sessionID {
			sessions = append(sessions, managed.snapshot())
		}
	}
	return sessions
}

// HasActiveSession indica se la sessione possiede terminali ancora vivi.
func (m *TerminalManager) HasActiveSession(sessionID SessionID) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, managed := range m.terminals {
		if managed.session.SessionID == sessionID && !managed.exited.Load() {
			return true
		}
	}
	return false
}

// Shutdown chiude tutti i terminali, usato alla chiusura dell'applicazione.
func (m *TerminalManager) Shutdown() {
	m.mu.RLock()
	ids := make([]TerminalID, 0, len(m.terminals))
	for id := range m.terminals {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		_ = m.Close(id)
	}
}

// pump legge dal PTY e pubblica l'output coalescato a intervalli regolari.
// Non scarta mai byte: se la UI rallenta, il lettore si ferma e il PTY applica
// la sua naturale backpressure alla shell, come in un terminale vero.
func (m *TerminalManager) pump(managed *managedTerminal) {
	defer close(managed.pumped)
	ticker := time.NewTicker(terminalFlushInterval)
	defer ticker.Stop()
	chunks := make(chan []byte, 16)
	go func() {
		defer close(chunks)
		buffer := make([]byte, terminalReadChunkBytes)
		for {
			count, err := managed.pty.Read(buffer)
			if count > 0 {
				chunks <- append([]byte(nil), buffer[:count]...)
			}
			if err != nil {
				return
			}
		}
	}()

	pending := make([]byte, 0, terminalReadChunkBytes)
	flush := func(final bool) {
		ready := pending
		if !final {
			ready = pending[:completeUTF8Prefix(pending)]
		}
		if len(ready) == 0 {
			return
		}
		m.emit("terminal.output", managed.snapshot(), TerminalOutput{TerminalID: managed.session.ID, Data: string(ready)})
		pending = append(pending[:0], pending[len(ready):]...)
	}
	for {
		select {
		case chunk, ok := <-chunks:
			if !ok {
				flush(true)
				return
			}
			pending = append(pending, chunk...)
			if len(pending) >= terminalReadChunkBytes {
				flush(false)
			}
		case <-ticker.C:
			flush(false)
		}
	}
}

// completeUTF8Prefix restituisce la lunghezza del prefisso che non termina a metà
// di un carattere multibyte: il resto attende il blocco successivo, così "è" o
// "→" non diventano mai "\uFFFD" nel terminale.
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

// wait attende l'uscita della shell e pubblica lo stato finale una sola volta.
func (m *TerminalManager) wait(managed *managedTerminal) {
	defer close(managed.done)
	err := managed.command.Wait()
	managed.exited.Store(true)
	now := time.Now().UTC()

	managed.sessionMu.Lock()
	managed.session.ExitedAt = &now
	if managed.command.ProcessState != nil {
		code := managed.command.ProcessState.ExitCode()
		managed.session.ExitCode = &code
	}
	if managed.closing.Load() {
		managed.session.Status = "closed"
	} else if err != nil && managed.session.ExitCode == nil {
		managed.session.Status = "failed"
		managed.session.Error = err.Error()
	} else {
		managed.session.Status = "exited"
	}
	snapshot := managed.session
	managed.sessionMu.Unlock()

	managed.closePTY()
	// L'ultimo output deve arrivare alla UI prima dell'evento di uscita.
	select {
	case <-managed.pumped:
	case <-time.After(terminalDrainTimeout):
	}
	m.emit("terminal.exited", snapshot, nil)
}

// terminate arresta l'albero di processi della shell. Non chiude il PTY: quello
// è compito esclusivo di wait, che lo fa una volta sola quando la shell è uscita.
func (m *TerminalManager) terminate(managed *managedTerminal) {
	if managed.closing.Swap(true) {
		return
	}
	if managed.exited.Load() {
		managed.closePTY()
		return
	}
	if managed.command.Process != nil {
		if err := terminateProcessTreeByPID(managed.command.Process.Pid); err != nil {
			// Se l'arresto dell'albero fallisce resta il kill diretto: meglio
			// una shell chiusa a metà che un processo orfano invisibile.
			_ = managed.command.Process.Kill()
		}
	}
}

func (m *TerminalManager) lookup(id TerminalID) (*managedTerminal, error) {
	m.mu.RLock()
	managed, ok := m.terminals[id]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("terminale %q non trovato", id)
	}
	return managed, nil
}

func (m *TerminalManager) countForSession(sessionID SessionID) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	count := 0
	for _, managed := range m.terminals {
		if managed.session.SessionID == sessionID {
			count++
		}
	}
	return count
}

func (m *TerminalManager) idsForSession(sessionID SessionID) []TerminalID {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ids := make([]TerminalID, 0, 4)
	for id, managed := range m.terminals {
		if managed.session.SessionID == sessionID {
			ids = append(ids, id)
		}
	}
	return ids
}

// snapshot restituisce una copia coerente dello stato del terminale: viene
// letto anche dal pump mentre wait sta aggiornando lo stato finale.
func (t *managedTerminal) snapshot() TerminalSession {
	t.sessionMu.RLock()
	defer t.sessionMu.RUnlock()
	return t.session
}

func shellDisplayName(shell string) string {
	trimmed := strings.TrimSpace(shell)
	if trimmed == "" {
		return "shell"
	}
	separator := strings.LastIndexAny(trimmed, `/\`)
	name := trimmed[separator+1:]
	if extension := strings.LastIndex(name, "."); extension > 0 {
		name = name[:extension]
	}
	if name == "" {
		return "shell"
	}
	return name
}
