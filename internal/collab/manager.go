package collab

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	ModeIdle  = "idle"
	ModeHost  = "host"
	ModeGuest = "guest"

	DefaultInviteTTL = 15 * time.Minute
	maxInviteTTL     = 24 * time.Hour
	maxNameLength    = 64
	wsPath           = "/collab"
)

var (
	errRateLimited = errors.New("troppi messaggi")
	errNotHost     = errors.New("solo l'host può farlo")
	errBusy        = errors.New("una sessione di collaborazione è già attiva")
)

type pendingInvite struct {
	role    Role
	expires time.Time
}

// Manager possiede l'unica sessione di collaborazione di questa istanza:
// o host (listener TLS + peers) o guest (una connessione verso l'host).
type Manager struct {
	mu        sync.Mutex
	emit      func(Event)
	mode      string
	sessionID string
	self      Participant
	seq       uint64

	// host
	server   *http.Server
	address  string
	fp       string
	invites  map[string]pendingInvite
	peers    map[string]*peer
	guard    *bruteGuard
	upgrader websocket.Upgrader

	// guest
	host         *peer
	participants []Participant
}

func NewManager(emit func(Event)) *Manager {
	if emit == nil {
		emit = func(Event) {}
	}
	return &Manager{emit: emit, mode: ModeIdle, guard: newBruteGuard()}
}

// Host apre il listener TLS su ip:port (port 0 = casuale). Mai su tutte le interfacce:
// l'utente sceglie l'indirizzo esplicitamente.
func (m *Manager) Host(ip string, port int, name string) (Status, error) {
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil || parsed.IsUnspecified() {
		return Status{}, errors.New("scegli un indirizzo IP specifico su cui condividere")
	}
	if port < 0 || port > 65535 {
		return Status{}, errors.New("porta non valida")
	}
	cert, fp, err := newSessionCert()
	if err != nil {
		return Status{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.mode != ModeIdle {
		return Status{}, errBusy
	}
	ln, err := tls.Listen("tcp", net.JoinHostPort(parsed.String(), strconv.Itoa(port)), &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
	})
	if err != nil {
		return Status{}, fmt.Errorf("impossibile aprire la porta di collaborazione: %w", err)
	}
	m.mode, m.sessionID, m.fp, m.address = ModeHost, randomToken(8), fp, ln.Addr().String()
	m.self = Participant{ID: randomToken(8), Name: cleanName(name), Role: RoleController, Host: true, JoinedAt: time.Now()}
	m.invites, m.peers, m.seq = map[string]pendingInvite{}, map[string]*peer{}, 0
	m.upgrader = websocket.Upgrader{
		HandshakeTimeout: handshakeTimeout,
		// I guest sono client Go, non browser: un Origin presente vuol dire una pagina web sulla LAN.
		CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == "" },
	}
	mux := http.NewServeMux()
	mux.HandleFunc(wsPath, m.handleJoin)
	m.server = &http.Server{Handler: mux, ReadHeaderTimeout: handshakeTimeout}
	go func(srv *http.Server) { _ = srv.Serve(ln) }(m.server)
	return m.statusLocked(), nil
}

// CreateInvite genera un token monouso a scadenza per un ruolo.
func (m *Manager) CreateInvite(role Role, ttl time.Duration) (Invite, error) {
	if !role.Valid() {
		return Invite{}, errors.New("ruolo non valido")
	}
	if ttl <= 0 {
		ttl = DefaultInviteTTL
	}
	ttl = min(ttl, maxInviteTTL)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.mode != ModeHost {
		return Invite{}, errNotHost
	}
	token := randomToken(32)
	expires := time.Now().Add(ttl)
	m.invites[token] = pendingInvite{role: role, expires: expires}
	return Invite{Code: formatInvite(m.address, token, m.fp), Role: role, ExpiresAt: expires}, nil
}

func (m *Manager) handleJoin(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !m.guard.allowed(ip) {
		http.Error(w, "troppi tentativi, riprova più tardi", http.StatusTooManyRequests)
		return
	}
	conn, err := m.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	p := newPeer(conn)
	_ = conn.SetReadDeadline(time.Now().Add(handshakeTimeout))
	var first Event
	var h hello
	if conn.ReadJSON(&first) != nil || first.Type != EventHello || json.Unmarshal(first.Payload, &h) != nil {
		m.guard.fail(ip)
		_ = conn.Close()
		return
	}
	participant, reason := m.admit(h, ip, p)
	if reason != "" {
		m.guard.fail(ip)
		_ = conn.WriteJSON(Event{Type: EventError, Payload: mustJSON(reason)})
		_ = conn.Close()
		return
	}
	m.guard.success(ip)
	go p.writeLoop()
	p.keepAlive()
	m.hostReadLoop(p, participant)
}

// admit consuma l'invito (monouso) e registra il partecipante.
func (m *Manager) admit(h hello, ip string, p *peer) (Participant, string) {
	m.mu.Lock()
	if m.mode != ModeHost {
		m.mu.Unlock()
		return Participant{}, "sessione chiusa"
	}
	var match string
	for token := range m.invites {
		if subtle.ConstantTimeCompare([]byte(token), []byte(h.Token)) == 1 {
			match = token
		}
	}
	inv, ok := m.invites[match]
	if !ok || match == "" {
		m.mu.Unlock()
		return Participant{}, "invito non valido o già usato"
	}
	delete(m.invites, match)
	if time.Now().After(inv.expires) {
		m.mu.Unlock()
		return Participant{}, "invito scaduto"
	}
	if len(m.peers)+1 >= maxParticipants {
		m.mu.Unlock()
		return Participant{}, "sessione piena"
	}
	participant := Participant{ID: randomToken(8), Name: cleanName(h.Name), Role: inv.role, Address: ip, JoinedAt: time.Now()}
	p.participant = participant
	m.peers[participant.ID] = p
	welcomeEvent := Event{Type: EventWelcome, Payload: mustJSON(welcome{SessionID: m.sessionID, ParticipantID: participant.ID, Participants: m.participantsLocked()})}
	p.enqueue(welcomeEvent)
	events := m.broadcastParticipantsLocked()
	m.mu.Unlock()
	m.emitAll(events)
	return participant, ""
}

func (m *Manager) hostReadLoop(p *peer, participant Participant) {
	defer m.dropPeer(participant.ID)
	for {
		e, err := p.read()
		if err != nil {
			return
		}
		if e.Type != EventShare {
			p.enqueue(Event{Type: EventError, Payload: mustJSON("messaggio non supportato")})
			continue
		}
		if msg := m.relayShare(participant.ID, e.Payload); msg != "" {
			p.enqueue(Event{Type: EventError, Payload: mustJSON(msg)})
		}
	}
}

// relayShare valida permesso e contenuto lato host, poi inoltra a tutti gli altri.
func (m *Manager) relayShare(from string, payload json.RawMessage) string {
	m.mu.Lock()
	p := m.peers[from]
	if p == nil {
		m.mu.Unlock()
		return "partecipante sconosciuto"
	}
	if !p.participant.Role.Can(PermShare) {
		m.mu.Unlock()
		return "il tuo ruolo non permette di condividere"
	}
	m.mu.Unlock()
	var share Share
	if err := json.Unmarshal(payload, &share); err != nil {
		return "contenuto condiviso non valido"
	}
	clean, err := sanitizeShare(share)
	if err != nil {
		return err.Error()
	}
	m.mu.Lock()
	event := m.nextLocked(Event{Type: EventShare, From: from, Payload: mustJSON(clean)})
	for id, other := range m.peers {
		if id != from {
			other.enqueue(event)
		}
	}
	m.mu.Unlock()
	m.emit(event)
	return ""
}

// PreviewShare mostra cosa uscirebbe davvero dalla macchina, senza inviare.
func PreviewShare(kind ShareKind, title string, data json.RawMessage) (Share, error) {
	return sanitizeShare(Share{Kind: kind, Title: title, Data: data})
}

func sanitizeShare(s Share) (Share, error) {
	if !s.Kind.Valid() {
		return Share{}, errors.New("tipo di contenuto non condivisibile")
	}
	if len(s.Data) == 0 || len(s.Data) > maxMessageBytes {
		return Share{}, errors.New("contenuto vuoto o troppo grande")
	}
	data, redacted, err := Redact(s.Data)
	if err != nil {
		return Share{}, fmt.Errorf("contenuto non valido: %w", err)
	}
	if s.ID == "" {
		s.ID = randomToken(8)
	}
	s.Title = cleanName(s.Title)
	s.Data, s.Redacted = data, redacted
	return s, nil
}

// Share invia contenuto filtrato: l'host lo manda a tutti, il guest all'host (che decide).
func (m *Manager) Share(kind ShareKind, title string, data json.RawMessage) (Share, error) {
	clean, err := PreviewShare(kind, title, data)
	if err != nil {
		return Share{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	switch m.mode {
	case ModeHost:
		event := m.nextLocked(Event{Type: EventShare, From: m.self.ID, Payload: mustJSON(clean)})
		for _, p := range m.peers {
			p.enqueue(event)
		}
	case ModeGuest:
		if !m.self.Role.Can(PermShare) {
			return Share{}, errors.New("il tuo ruolo non permette di condividere")
		}
		if m.host == nil || !m.host.enqueue(Event{Type: EventShare, From: m.self.ID, Payload: mustJSON(clean)}) {
			return Share{}, errors.New("connessione con l'host persa")
		}
	default:
		return Share{}, errors.New("nessuna sessione di collaborazione attiva")
	}
	return clean, nil
}

// SetRole cambia il ruolo di un guest; i permessi valgono dal messaggio successivo.
func (m *Manager) SetRole(participantID string, role Role) error {
	if !role.Valid() {
		return errors.New("ruolo non valido")
	}
	m.mu.Lock()
	if m.mode != ModeHost {
		m.mu.Unlock()
		return errNotHost
	}
	p := m.peers[participantID]
	if p == nil {
		m.mu.Unlock()
		return errors.New("partecipante non trovato")
	}
	p.participant.Role = role
	events := m.broadcastParticipantsLocked()
	m.mu.Unlock()
	m.emitAll(events)
	return nil
}

// Revoke espelle un guest.
func (m *Manager) Revoke(participantID string) error {
	m.mu.Lock()
	if m.mode != ModeHost {
		m.mu.Unlock()
		return errNotHost
	}
	p := m.peers[participantID]
	m.mu.Unlock()
	if p == nil {
		return errors.New("partecipante non trovato")
	}
	p.enqueue(Event{Type: EventClosed, Payload: mustJSON("l'host ti ha rimosso dalla sessione")})
	p.close()
	m.dropPeer(participantID)
	return nil
}

func (m *Manager) dropPeer(id string) {
	m.mu.Lock()
	p := m.peers[id]
	if p == nil || m.mode != ModeHost {
		m.mu.Unlock()
		return
	}
	delete(m.peers, id)
	p.close()
	events := m.broadcastParticipantsLocked()
	m.mu.Unlock()
	m.emitAll(events)
}

// Join si collega all'host dell'invito verificandone il certificato.
func (m *Manager) Join(code, name string) (Status, error) {
	inv, err := parseInvite(code)
	if err != nil {
		return Status{}, err
	}
	m.mu.Lock()
	if m.mode != ModeIdle {
		m.mu.Unlock()
		return Status{}, errBusy
	}
	m.mode = ModeGuest // prenota: blocca Host/Join concorrenti durante il dial
	m.mu.Unlock()

	status, err := m.dialHost(inv, name)
	if err != nil {
		m.mu.Lock()
		m.mode = ModeIdle
		m.mu.Unlock()
	}
	return status, err
}

func (m *Manager) dialHost(inv parsedInvite, name string) (Status, error) {
	dialer := websocket.Dialer{TLSClientConfig: pinnedTLS(inv.Fingerprint), HandshakeTimeout: handshakeTimeout}
	ctx, cancel := context.WithTimeout(context.Background(), handshakeTimeout)
	defer cancel()
	conn, resp, err := dialer.DialContext(ctx, "wss://"+inv.Address+wsPath, nil)
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusTooManyRequests {
			return Status{}, errors.New("troppi tentativi falliti: riprova tra qualche minuto")
		}
		return Status{}, fmt.Errorf("impossibile raggiungere l'host: %w", err)
	}
	p := newPeer(conn)
	_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	if err := conn.WriteJSON(Event{Type: EventHello, Payload: mustJSON(hello{Token: inv.Token, Name: cleanName(name)})}); err != nil {
		_ = conn.Close()
		return Status{}, fmt.Errorf("handshake fallito: %w", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(handshakeTimeout))
	var reply Event
	if err := conn.ReadJSON(&reply); err != nil {
		_ = conn.Close()
		return Status{}, fmt.Errorf("handshake fallito: %w", err)
	}
	if reply.Type == EventError {
		_ = conn.Close()
		var msg string
		_ = json.Unmarshal(reply.Payload, &msg)
		return Status{}, errors.New(msg)
	}
	var w welcome
	if reply.Type != EventWelcome || json.Unmarshal(reply.Payload, &w) != nil {
		_ = conn.Close()
		return Status{}, errors.New("risposta dell'host non valida")
	}
	m.mu.Lock()
	if m.mode != ModeGuest || m.host != nil { // Stop durante il dial
		m.mu.Unlock()
		_ = conn.Close()
		return Status{}, errors.New("connessione annullata")
	}
	m.sessionID, m.host, m.participants, m.address, m.fp = w.SessionID, p, w.Participants, inv.Address, inv.Fingerprint
	for _, part := range w.Participants {
		if part.ID == w.ParticipantID {
			m.self = part
		}
	}
	status := m.statusLocked()
	m.mu.Unlock()
	go p.writeLoop()
	p.keepAlive()
	go m.guestReadLoop(p)
	return status, nil
}

func (m *Manager) guestReadLoop(p *peer) {
	reason := "connessione con l'host persa"
	for {
		e, err := p.read()
		if err != nil {
			break
		}
		switch e.Type {
		case EventParticipants:
			var list []Participant
			if json.Unmarshal(e.Payload, &list) == nil {
				m.mu.Lock()
				m.participants = list
				for _, part := range list {
					if part.ID == m.self.ID {
						m.self = part
					}
				}
				m.mu.Unlock()
			}
			m.emit(e)
		case EventShare, EventError:
			m.emit(e)
		case EventClosed:
			_ = json.Unmarshal(e.Payload, &reason)
		}
		if e.Type == EventClosed {
			break
		}
	}
	p.close()
	m.mu.Lock()
	lost := m.host == p // false se l'utente è uscito con Stop: niente evento
	if lost {
		m.resetLocked()
	}
	m.mu.Unlock()
	if lost {
		m.emit(Event{Type: EventClosed, Payload: mustJSON(reason)})
	}
}

// Stop chiude la sessione (host: espelle tutti e chiude la porta; guest: esce).
func (m *Manager) Stop() {
	m.mu.Lock()
	var server *http.Server
	switch m.mode {
	case ModeHost:
		closing := Event{Type: EventClosed, Payload: mustJSON("l'host ha chiuso la sessione")}
		for _, p := range m.peers {
			p.enqueue(closing)
			p.close()
		}
		server = m.server
	case ModeGuest:
		if m.host != nil {
			m.host.close()
		}
	}
	m.resetLocked()
	m.mu.Unlock()
	if server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

func (m *Manager) resetLocked() {
	m.mode, m.sessionID, m.address, m.fp = ModeIdle, "", "", ""
	m.self, m.server, m.host = Participant{}, nil, nil
	m.invites, m.peers, m.participants = nil, nil, nil
}

func (m *Manager) statusLocked() Status {
	s := Status{Mode: m.mode, SessionID: m.sessionID, Self: m.self.ID, Address: m.address, Fingerprint: m.fp, Participants: []Participant{}}
	switch m.mode {
	case ModeHost:
		s.Participants = m.participantsLocked()
		now := time.Now()
		for _, inv := range m.invites {
			if now.Before(inv.expires) {
				s.PendingInvite++
			}
		}
	case ModeGuest:
		s.Participants = append(s.Participants, m.participants...)
	}
	return s
}

func (m *Manager) participantsLocked() []Participant {
	list := []Participant{m.self}
	for _, p := range m.peers {
		list = append(list, p.participant)
	}
	guests := list[1:]
	sort.SliceStable(guests, func(i, j int) bool { return guests[i].JoinedAt.Before(guests[j].JoinedAt) })
	return list
}

// broadcastParticipantsLocked accoda la lista aggiornata ai guest e restituisce l'evento per l'host.
func (m *Manager) broadcastParticipantsLocked() []Event {
	event := m.nextLocked(Event{Type: EventParticipants, Payload: mustJSON(m.participantsLocked())})
	for _, p := range m.peers {
		p.enqueue(event)
	}
	return []Event{event}
}

func (m *Manager) nextLocked(e Event) Event {
	m.seq++
	e.Seq = m.seq
	return e
}

func (m *Manager) emitAll(events []Event) {
	for _, e := range events {
		m.emit(e)
	}
}

func cleanName(name string) string {
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name))
	if name == "" {
		return "Anonimo"
	}
	if r := []rune(name); len(r) > maxNameLength {
		name = string(r[:maxNameLength])
	}
	return name
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic("collab: payload non serializzabile: " + err.Error())
	}
	return b
}
