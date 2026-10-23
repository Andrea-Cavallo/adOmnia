package codestudio

import (
	"bufio"
	"context"
	"crypto/sha256"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"adomnia/internal/activity"
	"adomnia/internal/ide/language"
	"adomnia/internal/ide/lsp"
	"adomnia/internal/ide/project"
	"adomnia/internal/jsonutil"
	"adomnia/internal/procutil"
)

const (
	MaxPendingLSPRequests = 128
	maxLanguageServerLog  = 500
	maxCrashRestarts      = 3
	crashWindow           = 2 * time.Minute
	initializeTimeout     = 60 * time.Second
	shutdownTimeout       = 2 * time.Second
	// exitNoticeDelay: tempo concesso a Wait per registrare un'uscita avvenuta durante la terminazione.
	exitNoticeDelay         = 250 * time.Millisecond
	defaultRequestTimeout   = 15 * time.Second
	maxCodeActionCacheItems = 64
	// diagnosticsThrottle raggruppa le raffiche di publishDiagnostics di gopls in un solo aggiornamento per file.
	diagnosticsThrottle   = 150 * time.Millisecond
	maxDiagnosticsPerFile = 1000
)

// LanguageServerOptions è la spec del server prodotta dal language adapter (per Go: gopls).
type LanguageServerOptions = lsp.ServerSpec

type lspEmitter func(eventType string, sessionID SessionID, resourceID string, payload any)

type serverProcess struct {
	syncKind int
	command  *exec.Cmd
	stdin    io.WriteCloser
	conn     *lsp.Conn
	exited   chan struct{}
}

type trackedDocument struct {
	id         DocumentID
	uri        string
	path       string
	languageID string
	version    int
	text       string
	readOnly   bool
}

type lspSession struct {
	// documentsMu orders didOpen/change/close without holding mu during pipe writes.
	documentsMu   sync.Mutex
	idleEpoch     uint64
	lifecycle     sync.Mutex
	inactiveSince time.Time
	startedAt     time.Time
	suspended     bool
	userInitiated bool
	restartEpoch  uint64 // invalidates crash retries after an explicit lifecycle change

	mu       sync.Mutex
	id       SessionID
	language string
	root     string
	rootURI  string
	name     string
	// folders are the unit roots given to the server instead of the project root (see workspaceFolderRoots).
	folders []string
	// unit è la radice dell'unità servita da questo server: vuota per i linguaggi con un solo server
	// per sessione, valorizzata quando l'adapter dichiara un server per unità (language.UnitServers).
	unit    string
	options LanguageServerOptions
	status  LanguageServerStatus
	process *serverProcess
	// synced è il processo che ha completato initialize/initialized: solo lui riceve i documenti.
	// Un didOpen durante l'handshake fa creare a gopls una vista prima dell'avvio
	// ("addView called before server initialized").
	synced      *serverProcess
	stopping    bool
	launching   bool
	crashes     []time.Time
	documents   map[DocumentID]*trackedDocument
	byURI       map[string]DocumentID
	log         []string
	codeActions map[string]lsp.CodeAction
	applyEdits  []lsp.WorkspaceEdit
	diagnostics map[string][]lsp.Diagnostic
	// Diagnostica in attesa di essere inviata alla UI: gopls ne pubblica a raffiche durante
	// il type-check, si invia solo l'ultima per file dopo diagnosticsThrottle.
	pendingDiagnostics map[string]DiagnosticsReport
	// Only non-empty normalized reports are retained; empty reports evict their URI.
	diagnosticSignatures map[string][sha256.Size]byte
	diagnosticsTimer     *time.Timer
	closed               bool
	// virtualURIs: percorso del file salvato → URI originale (non-file) del documento virtuale del server.
	virtualURIs map[string]string
	// progress: fasi $/progress aperte, per misurarne la durata nel log (lsp_trace.go).
	progress map[string]progressTrace
}

// lspKey identifica un language server: uno per linguaggio in ogni sessione, e uno per unità
// quando il linguaggio dichiara un server per unità (environment diverso per servizio).
type lspKey struct {
	session  SessionID
	language string
	// unit è la radice dell'unità: vuota per i linguaggi con un solo server per sessione.
	unit string
}

type LSPManager struct {
	memoryBudget        *lspMemoryBudget
	unsubscribeActivity func()
	activity            *activity.Manager
	mu                  sync.Mutex
	sessions            map[lspKey]*lspSession
	emit                lspEmitter
	languages           *language.Registry
	// readyObserver misura il tempo da avvio a pronto del language server.
	readyObserver func(elapsed time.Duration)
}

func NewLSPManager(languages *language.Registry) *LSPManager {
	m := &LSPManager{sessions: make(map[lspKey]*lspSession), languages: languages}
	m.setActivityManager(activity.NewManager())
	return m
}

// SetEmitter collega gli eventi LSP al proprietario applicativo.
func (m *LSPManager) SetEmitter(emit lspEmitter) {
	m.mu.Lock()
	m.emit = emit
	m.mu.Unlock()
}

// SetReadyObserver misura il tempo che un language server mette da avvio a
// pronto, per ogni avvio (inclusi i riavvii automatici).
func (m *LSPManager) SetReadyObserver(observer func(elapsed time.Duration)) {
	m.mu.Lock()
	m.readyObserver = observer
	m.mu.Unlock()
}

// noteReady notifica l'osservatore di load performance senza mai rallentare il server.
func (m *LSPManager) noteReady(elapsed time.Duration) {
	m.mu.Lock()
	observer := m.readyObserver
	m.mu.Unlock()
	if observer != nil {
		observer(elapsed)
	}
}

func (m *LSPManager) publish(eventType string, sessionID SessionID, resourceID string, payload any) {
	m.mu.Lock()
	emit := m.emit
	m.mu.Unlock()
	if emit != nil {
		emit(eventType, sessionID, resourceID, payload)
	}
}

func (m *LSPManager) ensure(session Session, languageID string) *lspSession {
	return m.ensureUnit(session, languageID, "")
}

// unitServerLanguage dice se il linguaggio va servito da un server per unità. Il core non nomina
// linguaggi: lo dichiara l'adapter con language.UnitServers.
func (m *LSPManager) unitServerLanguage(languageID string) bool {
	if m.languages == nil {
		return false
	}
	adapter, ok := m.languages.Get(languageID)
	if !ok {
		return false
	}
	perUnit, ok := adapter.(language.UnitServers)
	return ok && perUnit.ServersPerUnit()
}

// unitRoots sono le radici delle unità del linguaggio, in ordine stabile. Un linguaggio senza unità
// riconosciute resta un solo server alla radice del progetto, come per gli altri linguaggi.
func unitRoots(session Session, languageID string) []string {
	seen := make(map[string]bool, 2)
	roots := make([]string, 0, 2)
	for _, unit := range session.Project.Units {
		if unit.Language != languageID || unit.Root == "" {
			continue
		}
		root := filepath.Clean(unit.Root)
		if seen[root] {
			continue
		}
		seen[root] = true
		roots = append(roots, root)
	}
	if len(roots) == 0 {
		return []string{filepath.Clean(session.Project.RealPath)}
	}
	sort.Strings(roots)
	return roots
}

// unitRootForPath è la radice dell'unità del linguaggio che contiene il file (la più profonda), o la
// radice del progetto se il file non appartiene a nessuna unità.
func unitRootForPath(session Session, languageID, path string) string {
	root := filepath.Clean(session.Project.RealPath)
	for _, unit := range session.Project.Units {
		if unit.Language != languageID || unit.Root == "" {
			continue
		}
		candidate := filepath.Clean(unit.Root)
		if len(candidate) <= len(root) || project.EnsureWithin(candidate, path) != nil {
			continue
		}
		root = candidate
	}
	return root
}

// ensureUnit restituisce, creandolo, il server del linguaggio per una sessione e una unità. Per i
// linguaggi con un solo server per sessione unitRoot è vuota: il server parte dalla radice del
// progetto con tutte le cartelle delle unità. Per gli altri parte dalla radice dell'unità e riceve
// una sola cartella: è ciò che tiene separati interpreti e import di unità diverse.
func (m *LSPManager) ensureUnit(session Session, languageID, unitRoot string) *lspSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := lspKey{session: session.ID, language: languageID, unit: unitRoot}
	if existing, ok := m.sessions[key]; ok {
		return existing
	}
	root, name := session.Project.RealPath, session.Project.Name
	var folders []string
	if unitRoot == "" {
		folders = workspaceFolderRoots(session.Project.RealPath, session.Project.Units, languageID)
	} else {
		root, name = unitRoot, filepath.Base(unitRoot)
	}
	created := &lspSession{
		id: session.ID, language: languageID, unit: unitRoot, root: root, rootURI: fileURI(root), name: name,
		folders:   folders,
		status:    LanguageServerStatus{SessionID: session.ID, Language: languageID, State: LanguageServerStopped},
		documents: make(map[DocumentID]*trackedDocument), byURI: make(map[string]DocumentID),
		codeActions: make(map[string]lsp.CodeAction), diagnostics: make(map[string][]lsp.Diagnostic),
	}
	m.sessions[key] = created
	return created
}

// server restituisce il server principale del linguaggio (il primo in ordine di unità).
func (m *LSPManager) server(sessionID SessionID, languageID string) (*lspSession, bool) {
	states := m.statesOf(sessionID, languageID)
	if len(states) == 0 {
		return nil, false
	}
	return states[0], true
}

// statesOf restituisce i server del linguaggio nella sessione, ordinati per unità: di norma uno solo,
// uno per unità per i linguaggi che dichiarano un server per unità.
func (m *LSPManager) statesOf(sessionID SessionID, languageID string) []*lspSession {
	m.mu.Lock()
	result := make([]*lspSession, 0, 1)
	for key, state := range m.sessions {
		if key.session == sessionID && key.language == languageID {
			result = append(result, state)
		}
	}
	m.mu.Unlock()
	sort.Slice(result, func(i, j int) bool { return result[i].unit < result[j].unit })
	return result
}

// servers restituisce i language server della sessione, ordinati per linguaggio (risultati stabili).
func (m *LSPManager) servers(sessionID SessionID) []*lspSession {
	m.mu.Lock()
	result := make([]*lspSession, 0, 1)
	for key, state := range m.sessions {
		if key.session == sessionID {
			result = append(result, state)
		}
	}
	m.mu.Unlock()
	sort.Slice(result, func(i, j int) bool { return result[i].language < result[j].language })
	return result
}

// forDocument restituisce il server che ha sincronizzato il documento.
func (m *LSPManager) forDocument(sessionID SessionID, documentID DocumentID) (*lspSession, bool) {
	for _, state := range m.servers(sessionID) {
		state.mu.Lock()
		_, tracked := state.documents[documentID]
		state.mu.Unlock()
		if tracked {
			return state, true
		}
	}
	return nil, false
}

// forPath restituisce il server del linguaggio che possiede il file, anche se non è aperto. Con i
// server per unità è quello dell'unità che contiene il file.
func (m *LSPManager) forPath(sessionID SessionID, path string) (*lspSession, bool) {
	owner, _, ok := m.languages.ForPath(path)
	if !ok {
		return nil, false
	}
	state, found := chooseByPath(m.statesOf(sessionID, owner.ID()), path)
	if found {
		m.armIdle(state)
	}
	return state, found
}

// chooseByPath sceglie il server dell'unità che contiene il path (la radice più profonda); senza
// corrispondenze usa il primo, così i linguaggi a server unico restano identici a prima.
func chooseByPath(states []*lspSession, path string) (*lspSession, bool) {
	if len(states) == 0 {
		return nil, false
	}
	best, bestLength := states[0], -1
	for _, state := range states {
		state.mu.Lock()
		root := state.root
		state.mu.Unlock()
		if project.EnsureWithin(root, path) != nil || len(root) <= bestLength {
			continue
		}
		best, bestLength = state, len(root)
	}
	return best, true
}

// Status restituisce lo stato del linguaggio nella sessione. Con un server per unità lo stato è
// aggregato: pronto appena un'unità lo è; l'errore di un'unità che non parte resta nel suo log.
func (m *LSPManager) Status(sessionID SessionID, languageID string) LanguageServerStatus {
	return aggregateStatus(sessionID, languageID, m.statesOf(sessionID, languageID))
}

func aggregateStatus(sessionID SessionID, languageID string, states []*lspSession) LanguageServerStatus {
	if len(states) == 0 {
		return LanguageServerStatus{SessionID: sessionID, Language: languageID, State: LanguageServerStopped}
	}
	statuses := make([]LanguageServerStatus, 0, len(states))
	for _, state := range states {
		state.mu.Lock()
		statuses = append(statuses, state.status)
		state.mu.Unlock()
	}
	// Priorità: pronto, in avvio, in crash, fermo. Il primo esemplare fornisce gli altri campi.
	for _, wanted := range []LanguageServerState{LanguageServerReady, LanguageServerStarting, LanguageServerCrashed, LanguageServerStopped} {
		for _, status := range statuses {
			if status.State == wanted {
				return status
			}
		}
	}
	return statuses[0]
}

// Log restituisce il log del linguaggio: con più unità ogni riga porta il nome dell'unità, così
// l'avvio e gli errori di una unità restano distinguibili.
func (m *LSPManager) Log(sessionID SessionID, languageID string) []string {
	states := m.statesOf(sessionID, languageID)
	if len(states) == 0 {
		return []string{}
	}
	var lines []string
	for _, state := range states {
		state.mu.Lock()
		root, log := state.root, state.log
		state.mu.Unlock()
		prefix := ""
		if len(states) > 1 || state.unit != "" {
			prefix = "[" + filepath.Base(root) + "] "
		}
		for _, line := range log {
			lines = append(lines, prefix+line)
		}
	}
	if overflow := len(lines) - maxLanguageServerLog; overflow > 0 {
		lines = lines[overflow:]
	}
	return lines
}

// Start avvia il server di options.Language per la sessione se non è già attivo; i documenti
// tracciati per quel linguaggio vengono riaperti.
func (m *LSPManager) Start(session Session, options LanguageServerOptions) (LanguageServerStatus, error) {
	return m.start(session, options, launchReasonStart)
}

// start è Start con il motivo scritto nel log di avvio.
func (m *LSPManager) start(session Session, options LanguageServerOptions, reason string) (LanguageServerStatus, error) {
	if options.Language == "" {
		return LanguageServerStatus{}, fmt.Errorf("language server language not specified")
	}
	if options.PerUnitSpec != nil {
		return m.startUnits(session, options, reason)
	}
	// Un linguaggio che dichiara un server per unità ma arriva qui senza factory (un chiamante che
	// costruisce la spec a mano) continua con un solo server alla radice del progetto: la UI resta
	// funzionante e l'isolamento per unità manca solo in quel percorso.
	state := m.ensureUnit(session, options.Language, "")
	return m.startState(session, state, options, reason)
}

// startUnits avvia un server per ogni unità del linguaggio, ognuno con la spec della propria unità:
// è così che due unità con ambienti diversi restano isolate. Un'unità che non parte non impedisce
// alle altre di funzionare; l'errore della prima finisce nel risultato e nel log della sua unità.
func (m *LSPManager) startUnits(session Session, options LanguageServerOptions, reason string) (LanguageServerStatus, error) {
	roots := unitRoots(session, options.Language)
	started := make(map[string]bool, len(roots))
	var firstErr error
	for _, root := range roots {
		started[root] = true
		if err := m.startUnit(session, options, root, reason); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	// Un file fuori da ogni unità resta sul server della radice del progetto: lo si avvia solo se ha
	// già documenti tracciati, per non aggiungere un server vuoto.
	projectRoot := filepath.Clean(session.Project.RealPath)
	if !started[projectRoot] && m.trackedDocuments(session.ID, options.Language, projectRoot) > 0 {
		if err := m.startUnit(session, options, projectRoot, reason); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return m.Status(session.ID, options.Language), firstErr
}

// startUnit avvia il server di una unità costruendone la spec con la radice dell'unità.
func (m *LSPManager) startUnit(session Session, options LanguageServerOptions, root, reason string) error {
	spec, err := options.PerUnitSpec(root)
	if err != nil {
		// L'unità senza spec (ambiente o server mancante) resta visibile nel suo log e nel suo stato.
		m.setState(m.ensureUnit(session, options.Language, root), LanguageServerCrashed, err.Error())
		return fmt.Errorf("%s: %w", root, err)
	}
	spec.PerUnitSpec = nil
	_, err = m.startState(session, m.ensureUnit(session, options.Language, root), spec, reason)
	return err
}

// trackedDocuments conta i documenti già tracciati per un server identificato da (linguaggio, unità).
func (m *LSPManager) trackedDocuments(sessionID SessionID, languageID, unitRoot string) int {
	m.mu.Lock()
	state := m.sessions[lspKey{session: sessionID, language: languageID, unit: unitRoot}]
	m.mu.Unlock()
	if state == nil {
		return 0
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return len(state.documents)
}

// startState avvia il server di uno stato già identificato (il linguaggio, o una sua unità).
func (m *LSPManager) startState(session Session, state *lspSession, options LanguageServerOptions, reason string) (LanguageServerStatus, error) {
	state.lifecycle.Lock()
	defer state.lifecycle.Unlock()
	state.mu.Lock()
	if state.closed {
		state.mu.Unlock()
		return LanguageServerStatus{}, fmt.Errorf("language server session is closed")
	}
	state.idleEpoch++
	state.suspended = false
	m.activity.Track(lspActivityID(state), "code-studio:"+string(session.ID))
	if state.process != nil || state.launching {
		status := state.status
		state.mu.Unlock()
		m.armIdle(state)
		return status, nil
	}
	state.launching = true
	state.restartEpoch++
	state.options = options
	if options.DiscoversNestedUnits {
		state.folders = nil
	}
	state.stopping = false
	state.status = LanguageServerStatus{SessionID: session.ID, Language: options.Language, State: LanguageServerStarting, Binary: options.Binary, Version: options.Version, Restarts: state.status.Restarts}
	state.mu.Unlock()
	m.publishStatus(state)
	if err := m.launch(state, reason); err != nil {
		m.setState(state, LanguageServerCrashed, err.Error())
		return m.Status(session.ID, options.Language), err
	}
	m.armIdle(state)
	return m.Status(session.ID, options.Language), nil
}

// launch avvia il processo; il chiamante deve aver impostato launching, che viene sempre azzerato.
// reason finisce nel log: spiega perché il server ricarica il workspace.
func (m *LSPManager) launch(state *lspSession, reason string) error {
	defer func() {
		state.mu.Lock()
		state.launching = false
		state.mu.Unlock()
	}()
	state.mu.Lock()
	options := state.options
	root := state.root
	state.mu.Unlock()
	name := options.DisplayName()
	m.traceLaunch(state, reason)
	launchedAt := time.Now()

	command := procutil.Command(options.Binary, options.Arguments...)
	command.Dir = root
	command.Env = options.Environment
	configureProcess(command, false)
	stdin, err := command.StdinPipe()
	if err != nil {
		return fmt.Errorf("could not attach stdin of %s: %w", name, err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("could not attach stdout of %s: %w", name, err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return fmt.Errorf("could not attach stderr of %s: %w", name, err)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("avvio %s fallito: %w", name, err)
	}
	process := &serverProcess{command: command, stdin: stdin, exited: make(chan struct{})}
	process.conn = lsp.NewConn(stdout, stdin, &lspHandler{manager: m, session: state, process: process})
	// Backpressure: oltre MaxPendingLSPRequests le nuove richieste falliscono
	// subito invece di accumularsi ed esaurire i timeout.
	process.conn.SetPendingLimit(MaxPendingLSPRequests)
	go process.conn.Run()
	go m.collectStderr(state, process, stderr)
	go m.watch(state, process)

	state.mu.Lock()
	state.process = process
	state.status.PID = command.Process.Pid
	state.startedAt = time.Now()
	state.mu.Unlock()
	// Il server language è un figlio gestito: dopo un crash lo sweep dell'avvio
	// successivo lo ritrova e lo termina (managedchildren.go).
	registerManagedChild(command.Process.Pid, filepath.Base(options.Binary))
	m.trace(state, "process started, PID %d (%s)", command.Process.Pid, round(time.Since(launchedAt)))

	ctx, cancel := context.WithTimeout(context.Background(), initializeTimeout)
	defer cancel()
	var initialized initializeResult
	initializeAt := time.Now()
	if err := process.conn.Call(ctx, "initialize", initializeParams(state), &initialized); err != nil {
		m.trace(state, "initialize failed after %s: %v", round(time.Since(initializeAt)), err)
		m.abandon(state, process)
		return fmt.Errorf("inizializzazione %s fallita: %w", name, err)
	}
	m.trace(state, "initialize answered in %s", round(time.Since(initializeAt)))
	features := initialized.Capabilities.features()
	process.syncKind = initialized.Capabilities.syncKind()
	state.mu.Lock()
	state.status.Features = &features
	state.mu.Unlock()
	if err := process.conn.Notify("initialized", map[string]any{}); err != nil {
		m.abandon(state, process)
		return err
	}
	// Da qui i documenti aperti dall'utente vanno al server; quelli aperti durante l'handshake li riapre reopenDocuments.
	m.reopenDocuments(state, process)
	m.trace(state, "ready in %s; the server now loads the workspace in the background (phases below)", round(time.Since(launchedAt)))
	m.noteReady(time.Since(launchedAt))
	m.setState(state, LanguageServerReady, "")
	m.signalMemoryBudget()
	return nil
}

func (m *LSPManager) reopenDocuments(state *lspSession, process *serverProcess) {
	state.documentsMu.Lock()
	defer state.documentsMu.Unlock()
	state.mu.Lock()
	documents := make([]trackedDocument, 0, len(state.documents))
	for _, document := range state.documents {
		documents = append(documents, *document)
	}
	state.synced = process
	state.mu.Unlock()
	for _, document := range documents {
		_ = process.conn.Notify("textDocument/didOpen", map[string]any{"textDocument": lsp.TextDocumentItem{
			URI: document.uri, LanguageID: document.languageID, Version: document.version, Text: document.text,
		}})
	}
}

func (m *LSPManager) collectStderr(state *lspSession, process *serverProcess, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		if !m.isCurrent(state, process) {
			continue
		}
		m.appendLog(state, "stderr: "+scanner.Text())
	}
	if err := scanner.Err(); err != nil && m.isCurrent(state, process) {
		m.appendLog(state, "stderr: "+err.Error())
	}
}

func (m *LSPManager) watch(state *lspSession, process *serverProcess) {
	err := process.command.Wait()
	// exited si chiude solo dopo l'aggiornamento di stato: chi attende Stop vede già lo stato finale.
	defer close(process.exited)
	// Il processo è morto: esce dal registro dei figli gestiti.
	releaseManagedChild(process.command.Process.Pid)
	state.mu.Lock()
	if state.process != process {
		state.mu.Unlock()
		return
	}
	state.process = nil
	state.synced = nil
	stopping := state.stopping
	state.status.PID = 0
	state.mu.Unlock()
	if stopping {
		m.setState(state, LanguageServerStopped, "")
		return
	}
	state.mu.Lock()
	reason := state.options.DisplayName() + " terminato inaspettatamente"
	state.mu.Unlock()
	if err != nil {
		reason = fmt.Sprintf("%s: %v", reason, err)
	}
	m.appendLog(state, reason)
	m.handleCrash(state, reason)
}

func (m *LSPManager) handleCrash(state *lspSession, reason string) {
	state.mu.Lock()
	if state.closed || state.stopping {
		state.mu.Unlock()
		return
	}
	now := time.Now()
	recent := state.crashes[:0]
	for _, crash := range state.crashes {
		if now.Sub(crash) < crashWindow {
			recent = append(recent, crash)
		}
	}
	state.crashes = append(recent, now)
	epoch := state.restartEpoch
	attempt := len(state.crashes)
	state.status.Restarts++
	state.mu.Unlock()
	if attempt > maxCrashRestarts {
		m.setState(state, LanguageServerCrashed, reason+"; riavvio automatico sospeso, usa Restart")
		return
	}
	m.setState(state, LanguageServerStarting, reason+"; riavvio in corso")
	go func() {
		time.Sleep(time.Duration(1<<(attempt-1)) * time.Second)
		state.lifecycle.Lock()
		defer state.lifecycle.Unlock()
		state.mu.Lock()
		cancelled := state.restartEpoch != epoch || state.closed || state.stopping || state.process != nil || state.launching
		if !cancelled {
			state.launching = true
		}
		state.mu.Unlock()
		if cancelled {
			return
		}
		if err := m.launch(state, launchReasonCrash); err != nil {
			m.handleCrash(state, err.Error())
		} else {
			m.armIdle(state)
		}
	}()
}

// Stop chiude i language server del linguaggio (tutte le unità) con shutdown/exit e termina il
// process tree se non rispondono.
func (m *LSPManager) Stop(sessionID SessionID, languageID string) {
	for _, state := range m.statesOf(sessionID, languageID) {
		m.stop(state)
	}
}

func (m *LSPManager) stop(state *lspSession) {
	m.stopState(state, false)
}

func (m *LSPManager) stopState(state *lspSession, closeSession bool) {
	state.lifecycle.Lock()
	defer state.lifecycle.Unlock()
	state.mu.Lock()
	state.closed = state.closed || closeSession
	state.suspended = false
	state.userInitiated = false
	m.activity.Forget(lspActivityID(state))
	state.idleEpoch++
	state.mu.Unlock()
	m.stopLocked(state)
}
func (m *LSPManager) stopLocked(state *lspSession) {
	state.mu.Lock()
	state.stopping = true
	state.restartEpoch++
	process, pid := state.process, state.status.PID
	state.mu.Unlock()
	if process == nil {
		m.setState(state, LanguageServerStopped, "")
		return
	}
	stoppingAt := time.Now()
	m.trace(state, "stopping PID %d", pid)
	defer func() {
		select {
		case <-process.exited:
			m.trace(state, "stopped in %s", round(time.Since(stoppingAt)))
		default:
		}
	}()
	// A server that stops reading stdin can block even a notification write.
	// Closing stdin below releases the protocol writer when the grace period ends.
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	graceful := make(chan struct{})
	go func() {
		defer close(graceful)
		_ = process.conn.Call(ctx, "shutdown", nil, nil)
		_ = process.conn.Notify("exit", nil)
	}()
	select {
	case <-graceful:
	case <-ctx.Done():
	}
	_ = process.stdin.Close()
	select {
	case <-process.exited:
	case <-time.After(shutdownTimeout):
		m.trace(state, "no exit %s after shutdown (server busy): forcing termination", shutdownTimeout)
		// Il server può uscire da solo mentre lo si termina: "processo non trovato" non è un errore.
		if err := terminateProcessTree(process.command); err != nil && !processExited(process) {
			m.appendLog(state, fmt.Sprintf("process tree termination failed: %v", err))
			if process.command.Process != nil {
				if killErr := process.command.Process.Kill(); killErr != nil {
					m.appendLog(state, fmt.Sprintf("direct process termination failed: %v", killErr))
				}
			}
		}
		select {
		case <-process.exited:
		case <-time.After(shutdownTimeout):
			// Keep the process and registry entry until watch's Wait confirms exit.
			message := "language server did not exit after forced termination"
			m.appendLog(state, message)
			m.setState(state, LanguageServerCrashed, message)
		}
	}
}

// processExited dice se il processo è già uscito, lasciando a Wait un attimo per accorgersene.
func processExited(process *serverProcess) bool {
	select {
	case <-process.exited:
		return true
	case <-time.After(exitNoticeDelay):
		return false
	}
}

// Restart arresta e riavvia i server del linguaggio (tutte le unità) azzerando il contatore dei crash.
func (m *LSPManager) Restart(session Session, options LanguageServerOptions) (LanguageServerStatus, error) {
	explicit := false
	for _, state := range m.statesOf(session.ID, options.Language) {
		state.mu.Lock()
		explicit = explicit || state.userInitiated
		state.mu.Unlock()
	}
	m.Stop(session.ID, options.Language)
	for _, state := range m.statesOf(session.ID, options.Language) {
		state.mu.Lock()
		state.userInitiated = explicit
		state.crashes = nil
		state.mu.Unlock()
	}
	return m.start(session, options, launchReasonRestart)
}

// StopSession arresta tutti i language server della sessione.
func (m *LSPManager) StopSession(sessionID SessionID) {
	for _, state := range m.servers(sessionID) {
		m.stop(state)
	}
}

// CloseSession arresta i language server della sessione e ne dimentica documenti e diagnostica.
func (m *LSPManager) CloseSession(sessionID SessionID) {
	for _, state := range m.servers(sessionID) {
		m.stopState(state, true)
	}
	m.mu.Lock()
	for key, state := range m.sessions {
		if key.session != sessionID {
			continue
		}
		state.mu.Lock()
		state.closed = true
		if state.diagnosticsTimer != nil {
			state.diagnosticsTimer.Stop()
		}
		state.pendingDiagnostics, state.diagnosticsTimer = nil, nil
		state.mu.Unlock()
		delete(m.sessions, key)
	}
	m.mu.Unlock()
}

// Shutdown arresta tutti i language server posseduti dal manager.
func (m *LSPManager) Shutdown() {
	m.stopMemoryBudget()
	if m.unsubscribeActivity != nil {
		m.unsubscribeActivity()
	}
	m.mu.Lock()
	states := make([]*lspSession, 0, len(m.sessions))
	for _, state := range m.sessions {
		states = append(states, state)
	}
	m.mu.Unlock()
	var group sync.WaitGroup
	for _, state := range states {
		group.Go(func() { m.stopState(state, true) })
	}
	group.Wait()
}

// abandon stacca il processo dalla sessione prima di terminarlo, così il watcher non lo tratta come crash.
func (m *LSPManager) abandon(state *lspSession, process *serverProcess) {
	state.mu.Lock()
	if state.process == process {
		state.process = nil
		state.synced = nil
		state.status.PID = 0
	}
	state.mu.Unlock()
	_ = process.stdin.Close()
	_ = terminateProcessTree(process.command)
}

func (m *LSPManager) isCurrent(state *lspSession, process *serverProcess) bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.process == process
}

func (m *LSPManager) setState(state *lspSession, value LanguageServerState, message string) {
	state.mu.Lock()
	if value == LanguageServerStopped || value == LanguageServerCrashed {
		state.diagnosticSignatures = nil
	}
	state.status.State = value
	state.status.Error = message
	state.mu.Unlock()
	m.publishStatus(state)
}

func (m *LSPManager) publishStatus(state *lspSession) {
	status := aggregateStatus(state.id, state.language, m.statesOf(state.id, state.language))
	m.publish("lsp.status", status.SessionID, string(status.SessionID), status)
}

func (m *LSPManager) appendLog(state *lspSession, line string) {
	stamped := time.Now().Format("15:04:05.000") + " " + strings.TrimRight(line, "\r\n")
	state.mu.Lock()
	state.log = append(state.log, stamped)
	if overflow := len(state.log) - maxLanguageServerLog; overflow > 0 {
		state.log = append([]string(nil), state.log[overflow:]...)
	}
	state.mu.Unlock()
}

func initializeParams(state *lspSession) map[string]any {
	state.mu.Lock()
	defer state.mu.Unlock()
	return map[string]any{
		"processId":             nil,
		"clientInfo":            map[string]any{"name": "adOmnia IDE"},
		"rootUri":               state.rootURI,
		"workspaceFolders":      state.workspaceFolders(),
		"initializationOptions": state.options.InitializationOptions,
		"capabilities": map[string]any{
			"general": map[string]any{"positionEncodings": []string{"utf-16"}},
			"workspace": map[string]any{
				"applyEdit": true, "configuration": true, "workspaceFolders": true,
				"workspaceEdit": map[string]any{"documentChanges": true, "resourceOperations": []string{}},
				"symbol":        map[string]any{"dynamicRegistration": false},
			},
			"window": map[string]any{"workDoneProgress": true, "showMessage": map[string]any{}},
			"textDocument": map[string]any{
				"synchronization": map[string]any{"didSave": true, "willSave": false},
				"completion": map[string]any{
					"completionItem": map[string]any{
						"snippetSupport": true, "documentationFormat": []string{"markdown", "plaintext"},
						"deprecatedSupport": true, "preselectSupport": true, "tagSupport": map[string]any{"valueSet": []int{1}},
					},
					"contextSupport": true,
				},
				"hover":          map[string]any{"contentFormat": []string{"markdown", "plaintext"}},
				"signatureHelp":  map[string]any{"signatureInformation": map[string]any{"documentationFormat": []string{"markdown", "plaintext"}, "parameterInformation": map[string]any{"labelOffsetSupport": true}}},
				"definition":     map[string]any{"linkSupport": true},
				"typeDefinition": map[string]any{"linkSupport": true},
				"implementation": map[string]any{"linkSupport": true},
				"references":     map[string]any{},
				"documentSymbol": map[string]any{"hierarchicalDocumentSymbolSupport": true},
				"formatting":     map[string]any{},
				"rename":         map[string]any{"prepareSupport": true},
				"codeAction": map[string]any{
					"codeActionLiteralSupport": map[string]any{"codeActionKind": map[string]any{"valueSet": []string{
						"", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll",
					}}},
					"resolveSupport": map[string]any{"properties": []string{"edit"}},
					"dataSupport":    true, "isPreferredSupport": true, "disabledSupport": true,
				},
				"publishDiagnostics": map[string]any{"relatedInformation": false, "versionSupport": true},
				"documentHighlight":  map[string]any{},
				"callHierarchy":      map[string]any{},
				"typeHierarchy":      map[string]any{},
				"inlayHint":          map[string]any{},
				"semanticTokens": map[string]any{
					"requests":       map[string]any{"full": true, "range": false},
					"tokenTypes":     semanticTokenTypes,
					"tokenModifiers": semanticTokenModifiers,
					"formats":        []string{"relative"},
				},
			},
		},
	}
}

type lspHandler struct {
	manager *LSPManager
	session *lspSession
	process *serverProcess
}

// HandleNotification scarta i messaggi di processi del server non più correnti.
func (h *lspHandler) HandleNotification(method string, params jsonv1.RawMessage) {
	if !h.manager.isCurrent(h.session, h.process) {
		return
	}
	switch method {
	case "textDocument/publishDiagnostics":
		var report lsp.PublishDiagnosticsParams
		if json.Unmarshal(params, &report) == nil {
			h.manager.publishDiagnostics(h.session, report)
		}
	case "window/logMessage", "window/showMessage":
		var message LanguageServerMessage
		if json.Unmarshal(params, &message) != nil {
			return
		}
		h.manager.appendLog(h.session, message.Message)
		if method == "window/showMessage" && message.Type <= 2 {
			h.manager.publish("lsp.message", h.session.id, string(h.session.id), message)
		}
	case "$/progress":
		h.manager.publishProgress(h.session, params)
	}
}

// sectionSettings risolve la sezione richiesta dentro le impostazioni: LSP chiede il sottoalbero
// della sezione (per Java `java` → il contenuto di `java`), non l'intero albero. Quando la sezione
// non è un cammino delle impostazioni vale la risposta intera: i server che ricevono già il
// contenuto della sezione (gopls, i server web) continuano a funzionare come prima.
func sectionSettings(settings any, section string) any {
	current := settings
	for _, part := range strings.Split(section, ".") {
		if part == "" {
			continue
		}
		object, ok := current.(map[string]any)
		if !ok {
			return settings
		}
		value, ok := object[part]
		if !ok {
			return settings
		}
		current = value
	}
	return current
}

// HandleRequest risponde alle richieste del server necessarie; workspace/applyEdit viene catturato per l'anteprima.
func (h *lspHandler) HandleRequest(_ context.Context, method string, params jsonv1.RawMessage) (any, error) {
	switch method {
	case "workspace/configuration":
		var request struct {
			Items []jsonv1.RawMessage `json:"items"`
		}
		_ = json.Unmarshal(params, &request)
		h.session.mu.Lock()
		configuration := h.session.options.Configuration
		h.session.mu.Unlock()
		var settings any
		if configuration != nil {
			settings = configuration()
		}
		result := make([]any, len(request.Items))
		for index, item := range request.Items {
			var entry struct {
				Section string `json:"section"`
			}
			_ = json.Unmarshal(item, &entry)
			result[index] = sectionSettings(settings, entry.Section)
		}
		return result, nil
	case "window/workDoneProgress/create", "client/registerCapability", "client/unregisterCapability":
		return nil, nil
	case "workspace/workspaceFolders":
		return h.session.workspaceFolders(), nil
	case "workspace/applyEdit":
		var request lsp.ApplyWorkspaceEditParams
		if err := json.Unmarshal(params, &request); err != nil {
			return map[string]any{"applied": false, "failureReason": "edit non valido"}, nil
		}
		h.session.mu.Lock()
		h.session.applyEdits = append(h.session.applyEdits, request.Edit)
		h.session.mu.Unlock()
		return map[string]any{"applied": true}, nil
	case "window/showDocument":
		return map[string]any{"success": false}, nil
	}
	return nil, lsp.ErrMethodNotFound
}

func (m *LSPManager) publishProgress(state *lspSession, params jsonv1.RawMessage) {
	token, value, ok := parseProgress(params)
	if !ok {
		return
	}
	m.traceProgress(state, token, value)
	m.publish("lsp.progress", state.id, string(state.id), LanguageServerProgress{
		Token: token, Kind: value.Kind, Title: value.Title, Message: value.Message, Percentage: value.Percentage,
	})
}

func (m *LSPManager) publishDiagnostics(state *lspSession, report lsp.PublishDiagnosticsParams) {
	path := pathFromURI(report.URI)
	// Un file generato enorme può produrre migliaia di voci: la UI ne riceve al massimo maxDiagnosticsPerFile, errori prima.
	shown := report.Diagnostics
	if len(shown) > maxDiagnosticsPerFile {
		shown = append([]lsp.Diagnostic(nil), shown...)
		sort.SliceStable(shown, func(i, j int) bool { return max(1, shown[i].Severity) < max(1, shown[j].Severity) })
		shown = shown[:maxDiagnosticsPerFile]
	}
	diagnostics := make([]EditorDiagnostic, 0, len(shown))
	for _, diagnostic := range shown {
		diagnostics = append(diagnostics, EditorDiagnostic{
			Range: editorRange(diagnostic.Range), Severity: max(1, diagnostic.Severity), Message: diagnostic.Message,
			Source: diagnostic.Source, Code: strings.Trim(string(diagnostic.Code), `"`),
		})
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if len(report.Diagnostics) == 0 {
		delete(state.diagnostics, report.URI)
	} else {
		state.diagnostics[report.URI] = report.Diagnostics
	}
	if state.closed {
		return
	}
	next := DiagnosticsReport{
		URI: report.URI, Path: path, RelativePath: relativeWithin(state.root, path), DocumentID: state.documentIDFor(report.URI),
		Diagnostics: diagnostics,
	}
	previous, exists := state.diagnosticSignatures[report.URI]
	if len(diagnostics) == 0 {
		if !exists {
			return
		}
		delete(state.diagnosticSignatures, report.URI)
	} else {
		// Compare the visible, capped report, not raw diagnostics: invisible fields
		// still refresh above for code actions. Metadata is part of the identity.
		encoded, _ := jsonutil.Marshal(next) // report contains only JSON-safe value types
		signature := sha256.Sum256(encoded)
		if exists && previous == signature {
			return
		}
		if state.diagnosticSignatures == nil {
			state.diagnosticSignatures = make(map[string][sha256.Size]byte)
		}
		state.diagnosticSignatures[report.URI] = signature
	}
	if state.pendingDiagnostics == nil {
		state.pendingDiagnostics = make(map[string]DiagnosticsReport)
	}
	state.pendingDiagnostics[report.URI] = next
	if state.diagnosticsTimer == nil {
		state.diagnosticsTimer = time.AfterFunc(diagnosticsThrottle, func() { m.flushDiagnostics(state) })
	}
}

// flushDiagnostics invia alla UI l'ultima diagnostica di ogni file cambiato nella finestra di throttling.
func (m *LSPManager) flushDiagnostics(state *lspSession) {
	state.mu.Lock()
	pending := state.pendingDiagnostics
	state.pendingDiagnostics, state.diagnosticsTimer = nil, nil
	closed := state.closed
	state.mu.Unlock()
	if closed {
		return
	}
	for uri, report := range pending {
		m.publish("lsp.diagnostics", state.id, uri, report)
	}
}
