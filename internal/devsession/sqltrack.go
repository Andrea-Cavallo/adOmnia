package devsession

import (
	"bytes"
	"encoding/binary"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Statement è un'istruzione SQL osservata dal proxy con il suo esito: durata, righe, errore.
// Kind "transaction" descrive una transazione chiusa (dalla prima istruzione al COMMIT/ROLLBACK).
type Statement struct {
	SQL       string
	Kind      string
	Started   time.Time
	Duration  time.Duration
	Rows      int64 // -1 se il database non lo dice
	Error     string
	Code      string // SQLSTATE (Postgres) o numero d'errore (MySQL)
	Completed bool   // false: la connessione si è chiusa prima della risposta
}

type pendingStatement struct {
	sql     string
	started time.Time
	// skip: un comando MySQL che riceve una risposta ma non è un'istruzione (ping, init db…).
	skip bool
	// prepare: risposta a COM_STMT_PREPARE, che porta l'id dello statement.
	prepare bool
}

// statementTracker accoppia, per una connessione, le istruzioni inviate alle risposte del server.
// Il lato client e il lato server girano in goroutine diverse: tutto passa dal mutex.
type statementTracker struct {
	mu        sync.Mutex
	now       func() time.Time
	record    func(Statement)
	pending   []pendingStatement
	named     map[string]string // Postgres: statement preparato → SQL
	portals   map[string]string // Postgres: portal → SQL
	prepared  map[uint32]string // MySQL: id statement → SQL
	txStarted time.Time
	inTx      bool
	txFailed  bool
	// MySQL: capability di server e client.
	serverCaps, clientCaps uint32
	// commands: il client ha finito l'autenticazione e invia comandi.
	commands bool
}

func (t *statementTracker) startCommands() {
	t.mu.Lock()
	t.commands = true
	t.mu.Unlock()
}

func (t *statementTracker) commandsStarted() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.commands
}

func newStatementTracker(record func(Statement)) *statementTracker {
	return &statementTracker{now: time.Now, record: record, named: map[string]string{}, portals: map[string]string{}, prepared: map[uint32]string{}}
}

func cleanSQL(sql string) string {
	sql = strings.TrimSpace(strings.TrimLeftFunc(sql, func(r rune) bool { return r < ' ' }))
	if len(sql) > 4000 {
		sql = sql[:4000]
	}
	return sql
}

func (t *statementTracker) push(item pendingStatement) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.pending) < 1024 {
		t.pending = append(t.pending, item)
	}
}

func (t *statementTracker) pushSQL(sql string) {
	if sql = cleanSQL(sql); sql != "" {
		t.push(pendingStatement{sql: sql, started: t.now()})
	}
}

// pop chiude la prima istruzione in attesa (se c'è) con l'esito ricevuto.
func (t *statementTracker) pop(rows int64, message, code string) {
	t.mu.Lock()
	if len(t.pending) == 0 {
		t.mu.Unlock()
		return
	}
	item := t.pending[0]
	t.pending = t.pending[1:]
	t.mu.Unlock()
	if item.skip || item.prepare || item.sql == "" || t.record == nil {
		return
	}
	t.record(Statement{SQL: item.sql, Kind: "statement", Started: item.started, Duration: t.now().Sub(item.started), Rows: rows, Error: message, Code: code, Completed: true})
}

func (t *statementTracker) front() (pendingStatement, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.pending) == 0 {
		return pendingStatement{}, false
	}
	return t.pending[0], true
}

// flush registra come non completate le istruzioni rimaste senza risposta (connessione chiusa).
func (t *statementTracker) flush() {
	t.mu.Lock()
	pending := t.pending
	t.pending = nil
	t.mu.Unlock()
	for _, item := range pending {
		if !item.skip && !item.prepare && item.sql != "" && t.record != nil {
			t.record(Statement{SQL: item.sql, Kind: "statement", Started: item.started, Rows: -1})
		}
	}
}

// transactionState aggiorna lo stato della transazione dal ReadyForQuery di Postgres (I, T, E).
func (t *statementTracker) transactionState(status byte) {
	t.mu.Lock()
	// Le istruzioni rimaste dopo Sync non avranno risposta (errore nel protocollo esteso).
	t.pending = nil
	now := t.now()
	var closed *Statement
	switch {
	case (status == 'T' || status == 'E') && !t.inTx:
		t.inTx, t.txStarted = true, now
	case status == 'I' && t.inTx:
		closed = &Statement{SQL: "transaction", Kind: "transaction", Started: t.txStarted, Duration: now.Sub(t.txStarted), Rows: -1, Completed: true}
		if t.txFailed {
			closed.Error = "the transaction failed and was rolled back"
		}
		t.inTx, t.txFailed = false, false
	}
	if status == 'E' {
		t.txFailed = true
	}
	t.mu.Unlock()
	if closed != nil && t.record != nil {
		t.record(*closed)
	}
}

// ── Postgres ──────────────────────────────────────────────────────────────────

// clientMessage interpreta un messaggio del frontend Postgres (dopo l'avvio).
func (t *statementTracker) pgClientMessage(kind byte, body []byte) {
	switch kind {
	case 'Q':
		t.pushSQL(cString(body))
	case 'P': // Parse: nome \0 query \0 …
		name, rest, ok := bytes.Cut(body, []byte{0})
		if ok {
			t.mu.Lock()
			t.named[string(name)] = cleanSQL(cString(rest))
			t.mu.Unlock()
		}
	case 'B': // Bind: portal \0 statement \0 …
		portal, rest, ok := bytes.Cut(body, []byte{0})
		if ok {
			statement, _, _ := bytes.Cut(rest, []byte{0})
			t.mu.Lock()
			t.portals[string(portal)] = t.named[string(statement)]
			t.mu.Unlock()
		}
	case 'E': // Execute: portal \0 maxrows
		portal, _, _ := bytes.Cut(body, []byte{0})
		t.mu.Lock()
		sql := t.portals[string(portal)]
		t.mu.Unlock()
		t.pushSQL(sql)
	}
}

// pgServerMessage interpreta un messaggio del backend Postgres.
func (t *statementTracker) pgServerMessage(kind byte, body []byte) {
	switch kind {
	case 'C': // CommandComplete: "SELECT 3", "INSERT 0 1", "UPDATE 2"…
		t.pop(commandRows(cString(body)), "", "")
	case 'I': // EmptyQueryResponse
		t.pop(-1, "", "")
	case 'E':
		message, code := pgError(body)
		t.pop(-1, message, code)
	case 'Z':
		if len(body) > 0 {
			t.transactionState(body[0])
		}
	}
}

func commandRows(tag string) int64 {
	fields := strings.Fields(tag)
	if len(fields) < 2 {
		return -1
	}
	switch fields[0] {
	case "SELECT", "INSERT", "UPDATE", "DELETE", "MOVE", "FETCH", "COPY", "MERGE":
		if rows, err := strconv.ParseInt(fields[len(fields)-1], 10, 64); err == nil {
			return rows
		}
	}
	return -1
}

// pgError legge i campi M (messaggio) e C (SQLSTATE) di un ErrorResponse.
func pgError(body []byte) (string, string) {
	var message, code string
	for len(body) > 1 {
		field := body[0]
		value, rest, ok := bytes.Cut(body[1:], []byte{0})
		if !ok {
			break
		}
		switch field {
		case 'M':
			message = string(value)
		case 'C':
			code = string(value)
		}
		body = rest
	}
	return message, code
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

const (
	mysqlComInitDB       = 0x02
	mysqlComStmtExecute  = 0x17
	mysqlComStmtSendLong = 0x18
	mysqlComStmtClose    = 0x19
	mysqlComQuit         = 0x01
)

// mysqlCommand interpreta un comando del client (pacchetto con sequenza 0).
func (t *statementTracker) mysqlCommand(payload []byte) {
	if len(payload) == 0 {
		return
	}
	switch payload[0] {
	case mysqlComQuery:
		t.pushSQL(string(payload[1:]))
	case mysqlComStmtPrepare:
		t.push(pendingStatement{sql: cleanSQL(string(payload[1:])), started: t.now(), prepare: true})
	case mysqlComStmtExecute:
		if len(payload) >= 5 {
			t.mu.Lock()
			sql := t.prepared[binary.LittleEndian.Uint32(payload[1:5])]
			t.mu.Unlock()
			if sql == "" {
				t.push(pendingStatement{skip: true})
			} else {
				t.pushSQL(sql)
			}
		}
	case mysqlComStmtClose, mysqlComStmtSendLong, mysqlComQuit:
		// nessuna risposta dal server
	default:
		t.push(pendingStatement{skip: true})
	}
}

const mysqlDeprecateEOF = 1 << 24

// mysqlCapabilities registra le capability dichiarate da server (greeting) e client (handshake):
// con CLIENT_DEPRECATE_EOF i result set non hanno l'EOF dopo le colonne.
func (t *statementTracker) mysqlCapabilities(server, client uint32) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if server != 0 {
		t.serverCaps = server
	}
	if client != 0 {
		t.clientCaps = client
	}
}

func (t *statementTracker) deprecateEOF() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.serverCaps&t.clientCaps&mysqlDeprecateEOF != 0
}

type mysqlPhase struct {
	kind int // mysqlSkip (n pacchetti), mysqlEOF (un pacchetto EOF), mysqlRows
	n    int
}

const (
	mysqlSkip = iota
	mysqlEOF
	mysqlRows
)

// mysqlResponses segue le risposte del server pacchetto per pacchetto, con le fasi attese.
type mysqlResponses struct {
	tracker *statementTracker
	phases  []mysqlPhase
	rows    int64
}

func lengthEncoded(data []byte) (uint64, int) {
	if len(data) == 0 {
		return 0, 0
	}
	switch data[0] {
	case 0xfc:
		if len(data) >= 3 {
			return uint64(binary.LittleEndian.Uint16(data[1:])), 3
		}
	case 0xfd:
		if len(data) >= 4 {
			return uint64(data[1]) | uint64(data[2])<<8 | uint64(data[3])<<16, 4
		}
	case 0xfe:
		if len(data) >= 9 {
			return binary.LittleEndian.Uint64(data[1:]), 9
		}
	case 0xfb, 0xff:
		return 0, 0
	default:
		return uint64(data[0]), 1
	}
	return 0, 0
}

// definitions aggiunge n definizioni (colonne o parametri) seguite dall'EOF, se il protocollo lo prevede.
func (r *mysqlResponses) definitions(n int) {
	if n <= 0 {
		return
	}
	r.phases = append(r.phases, mysqlPhase{kind: mysqlSkip, n: n})
	if !r.tracker.deprecateEOF() {
		r.phases = append(r.phases, mysqlPhase{kind: mysqlEOF})
	}
}

func (r *mysqlResponses) packet(payload []byte) {
	if len(payload) == 0 {
		return
	}
	if len(r.phases) == 0 {
		r.start(payload)
		return
	}
	phase := &r.phases[0]
	switch phase.kind {
	case mysqlSkip:
		phase.n--
		if phase.n <= 0 {
			r.phases = r.phases[1:]
		}
	case mysqlEOF:
		r.phases = r.phases[1:]
	case mysqlRows:
		switch {
		case payload[0] == 0xff:
			message, code := mysqlError(payload)
			r.tracker.pop(-1, message, code)
			r.phases = nil
		case payload[0] == 0xfe && len(payload) < 0xffffff:
			r.tracker.pop(r.rows, "", "")
			r.phases = nil
		default:
			r.rows++
		}
	}
}

func (r *mysqlResponses) start(payload []byte) {
	front, _ := r.tracker.front()
	switch payload[0] {
	case 0x00:
		if front.prepare && len(payload) >= 9 {
			id := binary.LittleEndian.Uint32(payload[1:5])
			columns := int(binary.LittleEndian.Uint16(payload[5:7]))
			params := int(binary.LittleEndian.Uint16(payload[7:9]))
			r.tracker.mu.Lock()
			r.tracker.prepared[id] = front.sql
			r.tracker.mu.Unlock()
			r.tracker.pop(-1, "", "")
			r.definitions(params)
			r.definitions(columns)
			return
		}
		rows, _ := lengthEncoded(payload[1:])
		r.tracker.pop(int64(rows), "", "")
	case 0xff:
		message, code := mysqlError(payload)
		r.tracker.pop(-1, message, code)
	case 0xfb: // LOCAL INFILE: il client invia il file, poi arriva OK/ERR
	default:
		count, size := lengthEncoded(payload)
		if size == 0 || count == 0 || count > 4096 {
			return
		}
		r.rows = 0
		r.definitions(int(count))
		r.phases = append(r.phases, mysqlPhase{kind: mysqlRows})
	}
}

func mysqlError(payload []byte) (string, string) {
	if len(payload) < 3 {
		return "error", ""
	}
	code := strconv.Itoa(int(binary.LittleEndian.Uint16(payload[1:3])))
	message := payload[3:]
	if len(message) > 0 && message[0] == '#' && len(message) >= 6 {
		message = message[6:]
	}
	return string(message), code
}
