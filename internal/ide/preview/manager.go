package preview

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
)

// Mode dice come l'anteprima viene prodotta.
type Mode string

const (
	ModeStatic    Mode = "static"    // server statico di adOmnia con live reload
	ModeDevServer Mode = "devserver" // dev server del progetto (Vite, Next, …) con il suo HMR
)

// State è lo stato del ciclo di vita di un'anteprima.
type State string

const (
	StateStarting State = "starting"
	StateReady    State = "ready"
	StateStopping State = "stopping"
	StateStopped  State = "stopped"
	StateFailed   State = "failed"
)

// Problema riconosciuto dall'output di un dev server fallito: guida il messaggio mostrato all'utente.
const (
	FailurePortInUse        = "port-in-use"
	FailureMissingDeps      = "missing-dependencies"
	FailureExited           = "exited"
	FailureTimeout          = "timeout"
	FailureSpawn            = "spawn"
	FailureServerUnreadable = "unreachable"
)

const (
	defaultDevTimeout = 90 * time.Second
	readyProbeTimeout = 45 * time.Second
	stopGrace         = 5 * time.Second
	outputTailLines   = 40
)

// Preview è lo stato osservabile di un'anteprima, serializzato verso la UI.
type Preview struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	Mode      Mode   `json:"mode"`
	State     State  `json:"state"`
	// URL è l'indirizzo base della pagina; vuoto finché il server non è stato rilevato.
	URL  string `json:"url,omitempty"`
	Port int    `json:"port,omitempty"`
	// Root è la cartella servita (statico) o in cui gira il dev server.
	Root string `json:"root"`
	// DirectURL è l'indirizzo del server vero (dev server o sito statico): lo usano il browser esterno e
	// la finestra nativa. URL, invece, passa dal proxy del bridge quando Bridged è vero.
	DirectURL string `json:"directUrl,omitempty"`
	// Bridged è vero se la pagina passa dal proxy di adOmnia: ricarica, indietro/avanti, console ed
	// errori funzionano. Falso se il proxy non è partito: la preview resta operativa con meno controlli.
	Bridged bool `json:"bridged"`
	// Entry è la pagina da aprire sotto URL (sito statico con un HTML diverso da index.html).
	Entry string `json:"entry,omitempty"`
	// Label è il nome mostrato (cartella o script).
	Label   string `json:"label,omitempty"`
	Command string `json:"command,omitempty"`
	// RunID è l'esecuzione del dev server nel ProcessManager: la console Run mostra stdout e stderr.
	RunID       string `json:"runId,omitempty"`
	Error       string `json:"error,omitempty"`
	FailureKind string `json:"failureKind,omitempty"`
	// Hints sono le soluzioni possibili al problema (es. come installare Node.js).
	Hints     []string  `json:"hints,omitempty"`
	StartedAt time.Time `json:"startedAt"`
	// Subscribers è il numero di pagine collegate al live reload (solo statico).
	Subscribers int `json:"subscribers,omitempty"`
}

// Launcher è la parte del ProcessManager che serve al supervisore dei dev server.
type Launcher interface {
	Start(run.CommandSpec) (run.Execution, error)
	Stop(run.RunID) error
	WaitStopped(run.RunID, time.Duration) bool
}

// Manager possiede le anteprime di tutte le sessioni: server statici e dev server. Ogni anteprima
// appartiene a una sessione e si libera con lei (chiusura, revoca della fiducia, uscita dall'app).
type Manager struct {
	launcher Launcher
	onChange func(Preview)
	// register e release tengono il registro dei figli gestiti: un crash di adOmnia non lascia il dev server vivo.
	registerChild func(pid int, name string)
	releaseChild  func(pid int)

	mu       sync.Mutex
	previews map[string]*entry
}

type entry struct {
	preview Preview
	static  *StaticServer
	proxy   *ProxyServer
	cancel  context.CancelFunc
	// stopping distingue l'arresto richiesto da un'uscita imprevista del processo.
	stopping bool
	tail     *outputTail
	done     chan struct{}
}

// NewManager crea il supervisore; onChange riceve ogni cambio di stato (può essere nil).
func NewManager(launcher Launcher, onChange func(Preview)) *Manager {
	return &Manager{launcher: launcher, onChange: onChange, previews: map[string]*entry{}}
}

func key(sessionID, id string) string { return sessionID + "\x00" + id }

// SetProcessHooks collega il registro dei processi figli gestiti (contenimento e pulizia dopo un crash).
func (m *Manager) SetProcessHooks(register func(pid int, name string), release func(pid int)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.registerChild, m.releaseChild = register, release
}

// StaticRequest chiede un server statico.
type StaticRequest struct {
	ID, SessionID, Label, Entry string
	Options                     StaticOptions
}

// StartStatic avvia (o restituisce quello già attivo) il server statico per la richiesta.
func (m *Manager) StartStatic(request StaticRequest) (Preview, error) {
	if existing, ok := m.active(request.SessionID, request.ID); ok {
		return existing, nil
	}
	server, err := StartStatic(request.Options)
	if err != nil {
		return Preview{}, err
	}
	state := &entry{
		static: server, done: make(chan struct{}),
		preview: Preview{
			ID: request.ID, SessionID: request.SessionID, Mode: ModeStatic, State: StateReady, URL: server.URL(), DirectURL: server.URL(), Bridged: true, Port: server.Port(),
			Root: server.Root(), Label: request.Label, Entry: request.Entry, StartedAt: time.Now().UTC(),
		},
	}
	m.mu.Lock()
	m.previews[key(request.SessionID, request.ID)] = state
	snapshot := state.preview
	m.mu.Unlock()
	m.notify(snapshot)
	return snapshot, nil
}

// Report registra un'anteprima che non è mai partita (runtime mancante, dipendenze da installare…):
// la UI la mostra come qualunque altra anteprima fallita, con la spiegazione.
func (m *Manager) Report(preview Preview) Preview {
	preview.State = StateFailed
	if preview.StartedAt.IsZero() {
		preview.StartedAt = time.Now().UTC()
	}
	state := &entry{preview: preview, done: make(chan struct{})}
	close(state.done)
	m.mu.Lock()
	if existing, ok := m.previews[key(preview.SessionID, preview.ID)]; ok && isActive(existing.preview.State) {
		snapshot := existing.preview
		m.mu.Unlock()
		return snapshot
	}
	m.previews[key(preview.SessionID, preview.ID)] = state
	m.mu.Unlock()
	m.notify(preview)
	return preview
}

// DevServerRequest chiede il dev server di un progetto.
type DevServerRequest struct {
	ID, SessionID, Label string
	// ProxyPort è la porta preferita del proxy del bridge (0: una libera).
	ProxyPort int
	// Spec è il comando già validato dal chiamante (fiducia, argomenti espliciti, ambiente).
	Spec run.CommandSpec
	// Timeout è il tempo massimo per il rilevamento dell'URL (default 90 s: la prima compilazione è lenta).
	Timeout time.Duration
}

// StartDevServer avvia il dev server e ne attende l'URL e la prontezza reale. Restituisce subito lo
// stato "starting"; i passaggi successivi arrivano da onChange. Un solo dev server per ID attivo.
func (m *Manager) StartDevServer(request DevServerRequest) (Preview, error) {
	if m.launcher == nil {
		return Preview{}, errors.New("no process launcher configured")
	}
	m.mu.Lock()
	if existing, ok := m.previews[key(request.SessionID, request.ID)]; ok && isActive(existing.preview.State) {
		snapshot := existing.preview
		m.mu.Unlock()
		return snapshot, nil
	}
	tail := &outputTail{}
	scanner := NewURLScanner()
	found := make(chan string, 1)
	var scanMu sync.Mutex
	spec := request.Spec
	spec.OutputTap = func(stream string, data []byte) {
		tail.Add(data)
		scanMu.Lock()
		url, changed := scanner.Feed(stream, data)
		scanMu.Unlock()
		if changed {
			select {
			case found <- url:
			default:
			}
		}
	}
	state := &entry{tail: tail, done: make(chan struct{}), preview: Preview{
		ID: request.ID, SessionID: request.SessionID, Mode: ModeDevServer, State: StateStarting, Root: spec.WorkingDirectory,
		Label: request.Label, Command: spec.DisplayCommand, StartedAt: time.Now().UTC(),
	}}
	spec.OnExit = func(execution run.Execution) {
		if m.releaseChild != nil && execution.PID > 0 {
			m.releaseChild(execution.PID)
		}
		m.processExited(state, execution)
	}
	m.previews[key(request.SessionID, request.ID)] = state
	m.mu.Unlock()

	execution, err := m.launcher.Start(spec)
	if err != nil {
		m.finish(state, StateFailed, FailureSpawn, err.Error())
		return m.snapshot(state), err
	}
	if m.registerChild != nil && execution.PID > 0 {
		m.registerChild(execution.PID, filepath.Base(spec.Executable))
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	state.cancel = cancel
	state.preview.RunID = string(execution.ID)
	snapshot := state.preview
	m.mu.Unlock()
	m.notify(snapshot)
	timeout := request.Timeout
	if timeout <= 0 {
		timeout = defaultDevTimeout
	}
	go m.awaitReady(ctx, state, found, timeout, request.ProxyPort)
	return snapshot, nil
}

// awaitReady attende l'URL stampato dal dev server e poi una risposta HTTP reale.
func (m *Manager) awaitReady(ctx context.Context, state *entry, found <-chan string, timeout time.Duration, proxyPort int) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	var url string
	for url == "" {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			m.fail(state, FailureTimeout, fmt.Sprintf("The dev server printed no address within %s. Check the Run console for its output.", timeout.Round(time.Second)))
			return
		case url = <-found:
		}
	}
	m.mu.Lock()
	state.preview.URL = url
	snapshot := state.preview
	m.mu.Unlock()
	m.notify(snapshot)
	probeCtx, cancel := context.WithTimeout(ctx, readyProbeTimeout)
	defer cancel()
	for {
		if err := WaitReady(probeCtx, url); err == nil {
			break
		}
		select {
		case latest := <-found:
			// Il server ha cambiato porta (Vite passa alla successiva se occupata).
			url = latest
			m.mu.Lock()
			state.preview.URL = url
			m.mu.Unlock()
			continue
		default:
		}
		if ctx.Err() != nil {
			return
		}
		m.fail(state, FailureServerUnreadable, "The dev server announced "+url+" but does not answer. Check the Run console.")
		return
	}
	// Il proxy del bridge è un di più: se non parte la preview funziona comunque, direttamente sul dev server.
	proxy, proxyErr := StartProxy(url, proxyPort)
	m.mu.Lock()
	if state.stopping || state.preview.State != StateStarting {
		m.mu.Unlock()
		if proxy != nil {
			_ = proxy.Close()
		}
		return
	}
	state.preview.State, state.preview.DirectURL, state.preview.Port = StateReady, url, portOf(url)
	if proxyErr == nil {
		state.proxy, state.preview.URL, state.preview.Bridged = proxy, proxy.URL(), true
	} else {
		state.preview.URL, state.preview.Bridged = url, false
	}
	snapshot = state.preview
	m.mu.Unlock()
	m.notify(snapshot)
}

// fail ferma il processo e segna l'anteprima come fallita con un messaggio per l'utente.
func (m *Manager) fail(state *entry, kind, message string) {
	m.mu.Lock()
	runID := state.preview.RunID
	state.stopping = true
	m.mu.Unlock()
	if runID != "" {
		_ = m.launcher.Stop(run.RunID(runID))
	}
	m.finish(state, StateFailed, kind, message)
}

// processExited gestisce la fine del processo: arresto richiesto, oppure uscita imprevista da spiegare.
func (m *Manager) processExited(state *entry, execution run.Execution) {
	m.mu.Lock()
	wasStopping, previous := state.stopping, state.preview.State
	m.mu.Unlock()
	switch {
	case wasStopping && previous != StateFailed:
		m.finish(state, StateStopped, "", "")
	case previous == StateFailed:
		// già spiegato da fail()
	default:
		kind, message := classifyExit(state.tail.Text(), exitCode(execution), previous == StateReady)
		next := StateFailed
		if previous == StateReady {
			next = StateStopped
		}
		m.finish(state, next, kind, message)
	}
}

func (m *Manager) finish(state *entry, next State, kind, message string) {
	m.mu.Lock()
	if state.cancel != nil {
		state.cancel()
	}
	state.preview.State, state.preview.FailureKind, state.preview.Error = next, kind, message
	proxy := state.proxy
	state.proxy = nil
	snapshot := state.preview
	select {
	case <-state.done:
	default:
		close(state.done)
	}
	m.mu.Unlock()
	if proxy != nil {
		_ = proxy.Close()
	}
	m.notify(snapshot)
}

// Stop ferma l'anteprima e attende il termine dell'intero albero di processi.
func (m *Manager) Stop(sessionID, id string) error {
	m.mu.Lock()
	state, ok := m.previews[key(sessionID, id)]
	if !ok || !isActive(state.preview.State) {
		m.mu.Unlock()
		return nil
	}
	state.stopping = true
	state.preview.State = StateStopping
	snapshot := state.preview
	m.mu.Unlock()
	m.notify(snapshot)
	m.release(state)
	return nil
}

// release libera le risorse di un'anteprima in arresto: server statico chiuso, processo terminato.
func (m *Manager) release(state *entry) {
	if state.static != nil {
		_ = state.static.Close()
		m.finish(state, StateStopped, "", "")
		return
	}
	m.mu.Lock()
	runID := state.preview.RunID
	m.mu.Unlock()
	if runID == "" {
		m.finish(state, StateStopped, "", "")
		return
	}
	_ = m.launcher.Stop(run.RunID(runID))
	if !m.launcher.WaitStopped(run.RunID(runID), stopGrace) {
		m.finish(state, StateFailed, FailureExited, "The dev server did not stop in time.")
		return
	}
	// OnExit chiude lo stato; se il processo era già uscito lo si chiude qui.
	select {
	case <-state.done:
	case <-time.After(time.Second):
		m.finish(state, StateStopped, "", "")
	}
}

// StopSession ferma tutte le anteprime di una sessione (chiusura, revoca della fiducia).
func (m *Manager) StopSession(sessionID string) {
	for _, preview := range m.List(sessionID) {
		if isActive(preview.State) {
			_ = m.Stop(sessionID, preview.ID)
		}
	}
}

// Shutdown ferma ogni anteprima all'uscita dall'app, senza lasciare processi orfani.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	sessions := map[string]struct{}{}
	for _, state := range m.previews {
		sessions[state.preview.SessionID] = struct{}{}
	}
	m.mu.Unlock()
	var wait sync.WaitGroup
	for sessionID := range sessions {
		wait.Add(1)
		go func(id string) {
			defer wait.Done()
			m.StopSession(id)
		}(sessionID)
	}
	wait.Wait()
}

// Get restituisce lo stato di un'anteprima.
func (m *Manager) Get(sessionID, id string) (Preview, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, ok := m.previews[key(sessionID, id)]
	if !ok {
		return Preview{}, false
	}
	return m.snapshotLocked(state), true
}

// List restituisce le anteprime della sessione, comprese quelle ferme o fallite (la UI mostra perché).
func (m *Manager) List(sessionID string) []Preview {
	m.mu.Lock()
	defer m.mu.Unlock()
	previews := make([]Preview, 0, 2)
	for _, state := range m.previews {
		if state.preview.SessionID == sessionID {
			previews = append(previews, m.snapshotLocked(state))
		}
	}
	return previews
}

func (m *Manager) active(sessionID, id string) (Preview, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, ok := m.previews[key(sessionID, id)]
	if !ok || !isActive(state.preview.State) {
		return Preview{}, false
	}
	return m.snapshotLocked(state), true
}

func (m *Manager) snapshot(state *entry) Preview {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked(state)
}

func (m *Manager) snapshotLocked(state *entry) Preview {
	preview := state.preview
	switch {
	case state.static != nil:
		preview.Subscribers = state.static.Subscribers()
	case state.proxy != nil:
		preview.Subscribers = state.proxy.Subscribers()
	}
	return preview
}

// Forget dimentica le anteprime ferme o fallite della sessione (la UI le ha già mostrate).
func (m *Manager) Forget(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, state := range m.previews {
		if state.preview.SessionID == sessionID && !isActive(state.preview.State) {
			delete(m.previews, k)
		}
	}
}

// ReloadSession ricarica le pagine di tutti i server statici della sessione (modifiche troppo numerose per elencarle).
func (m *Manager) ReloadSession(sessionID string) {
	m.mu.Lock()
	servers := make([]*StaticServer, 0, 1)
	for _, state := range m.previews {
		if state.preview.SessionID == sessionID && state.static != nil && state.preview.State == StateReady {
			servers = append(servers, state.static)
		}
	}
	m.mu.Unlock()
	for _, server := range servers {
		server.Broadcast(LiveEvent{Type: "reload"})
	}
}

// NotifyChanges inoltra le modifiche su disco ai server statici della sessione: solo CSS aggiorna i
// fogli di stile senza ricaricare, qualunque altra modifica ricarica la pagina.
func (m *Manager) NotifyChanges(sessionID string, paths []string) {
	m.mu.Lock()
	servers := make([]*StaticServer, 0, 1)
	for _, state := range m.previews {
		if state.preview.SessionID == sessionID && state.static != nil && state.preview.State == StateReady {
			servers = append(servers, state.static)
		}
	}
	m.mu.Unlock()
	for _, server := range servers {
		if event, ok := liveEventFor(server.Root(), paths); ok {
			server.Broadcast(event)
		}
	}
}

// liveEventFor sceglie l'evento per un gruppo di modifiche; ok è false se nessuna riguarda il sito.
func liveEventFor(root string, paths []string) (LiveEvent, bool) {
	relevant := make([]string, 0, len(paths))
	onlyCSS := true
	for _, changed := range paths {
		relative, within := relativeWithin(root, changed)
		if !within {
			continue
		}
		relevant = append(relevant, relative)
		if !strings.HasSuffix(strings.ToLower(relative), ".css") {
			onlyCSS = false
		}
	}
	if len(relevant) == 0 {
		return LiveEvent{}, false
	}
	if onlyCSS {
		return LiveEvent{Type: "css", Paths: relevant}, true
	}
	return LiveEvent{Type: "reload", Paths: relevant}, true
}

func relativeWithin(root, changed string) (string, bool) {
	if project.EnsureWithin(root, changed) != nil {
		return "", false
	}
	relative := strings.TrimPrefix(strings.ReplaceAll(strings.TrimPrefix(changed, root), "\\", "/"), "/")
	if relative == "" {
		return "", false
	}
	for _, segment := range strings.Split(relative, "/") {
		if project.IgnoredDirectory(segment) || strings.HasPrefix(segment, ".") {
			return "", false
		}
	}
	return relative, true
}

func (m *Manager) notify(preview Preview) {
	if m.onChange != nil {
		m.onChange(preview)
	}
}

func isActive(state State) bool {
	return state == StateStarting || state == StateReady || state == StateStopping
}

func exitCode(execution run.Execution) int {
	if execution.ExitCode == nil {
		return -1
	}
	return *execution.ExitCode
}
