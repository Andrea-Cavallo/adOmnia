package collab

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

const EventDisconnected = "disconnected"
const EventResumed = "resumed"
const maxReplayBytes = 16 << 20

type resumeTicket struct {
	participant Participant
	expires     time.Time
}

func (m *Manager) pruneResumesLocked() {
	for token, ticket := range m.resumes {
		if time.Now().After(ticket.expires) {
			delete(m.resumes, token)
		}
	}
}

// Restore loads durable state without opening a listener or contacting the host.
func (m *Manager) Restore() {
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	if m.store == nil {
		return
	}
	var snapshot recoverySession
	found, err := m.store.loadJSON(recoverySessionKey, &snapshot)
	if err == nil && !found {
		return
	}
	if err == nil {
		err = validateRecoverySession(snapshot)
	}
	var replay []Event
	if err == nil {
		if _, err = m.store.loadJSON(recoveryReplayKey, &replay); err != nil {
			err = fmt.Errorf("replay recovery non disponibile: %w", err)
		}
	}
	if err == nil && snapshot.ReplayLatest > 0 && (len(replay) == 0 || replay[len(replay)-1].Seq < snapshot.ReplayLatest) {
		err = errors.New("replay recovery incompleto")
	}
	if err == nil && len(replay) > 0 && replay[len(replay)-1].Seq > snapshot.Seq {
		kept := replay[:0]
		for _, event := range replay {
			if event.Seq <= snapshot.Seq {
				kept = append(kept, event)
			}
		}
		replay = kept
	}
	documents := map[string]*documentRoom{}
	if err == nil && snapshot.Mode == ModeHost {
		for _, id := range snapshot.Documents {
			var document storedDocument
			if _, err = m.store.loadJSON(recoveryDocumentKey+id, &document); err != nil {
				break
			}
			if document.ID != id || len(document.Updates) == 0 {
				err = errors.New("documento recovery mancante o non valido")
				break
			}
			documents[id] = &documentRoom{updates: document.Updates, bytes: document.Bytes}
		}
	}
	if err != nil {
		m.mu.Lock()
		m.recoveryError = "recovery non disponibile: " + err.Error()
		m.mu.Unlock()
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.mode != ModeIdle {
		return
	}
	m.mode, m.sessionID, m.self, m.seq = snapshot.Mode, snapshot.SessionID, snapshot.Self, snapshot.Seq
	m.address, m.fp = snapshot.Address, snapshot.Fingerprint
	m.certPEM, m.keyPEM = snapshot.CertificatePEM, snapshot.PrivateKeyPEM
	m.projectInfo, m.resumeToken, m.lastSeq = snapshot.Project, snapshot.ResumeToken, snapshot.LastSeq
	m.guestInvite, m.replay = snapshot.GuestInvite, replay
	m.replayBytes, m.replayFloor = snapshot.ReplayBytes, snapshot.ReplayFloor
	m.recoveryPending, m.recoveryError = true, ""
	m.invites, m.peers = map[string]pendingInvite{}, map[string]*peer{}
	m.resumes = map[string]resumeTicket{}
	for _, ticket := range snapshot.Resumes {
		if time.Now().Before(ticket.Expires) {
			m.resumes[ticket.Token] = resumeTicket{participant: ticket.Participant, expires: ticket.Expires}
		}
	}
	if snapshot.Mode == ModeHost {
		m.documents = documents
		if snapshot.Project != nil {
			m.project = &sharedProject{info: *snapshot.Project, root: snapshot.ProjectRoot}
		}
	} else {
		m.participants = append([]Participant(nil), snapshot.Participants...)
		m.guestDocuments = append([]string(nil), snapshot.Documents...)
	}
}

func validateRecoverySession(snapshot recoverySession) error {
	if snapshot.Version != recoveryVersion || snapshot.SessionID == "" {
		return errors.New("versione o identità sessione non valida")
	}
	if snapshot.SavedAt.IsZero() || time.Since(snapshot.SavedAt) > maxRecoveryAge {
		return errors.New("recovery scaduto")
	}
	switch snapshot.Mode {
	case ModeHost:
		if _, err := decodeSessionCert(snapshot.CertificatePEM, snapshot.PrivateKeyPEM, snapshot.Fingerprint); err != nil {
			return err
		}
		if _, _, err := net.SplitHostPort(snapshot.Address); err != nil {
			return errors.New("indirizzo host recovery non valido")
		}
		if snapshot.Project != nil {
			stat, err := os.Stat(snapshot.ProjectRoot)
			if err != nil || !stat.IsDir() {
				return errors.New("progetto condiviso non più disponibile")
			}
		}
	case ModeGuest:
		if snapshot.ResumeToken == "" || snapshot.GuestInvite.Address == "" || snapshot.GuestInvite.Fingerprint == "" {
			return errors.New("credenziale guest recovery incompleta")
		}
	default:
		return errors.New("modalità recovery non valida")
	}
	return nil
}

// Called with m.mu held; always releases it, matching admit.
func (m *Manager) admitResumeLocked(h hello, ip string, p *peer) (Participant, string) {
	m.pruneResumesLocked()
	match := ""
	for token := range m.resumes {
		if subtle.ConstantTimeCompare([]byte(token), []byte(h.Resume)) == 1 {
			match = token
		}
	}
	ticket, ok := m.resumes[match]
	if !ok {
		m.mu.Unlock()
		return Participant{}, "ripresa non valida, scaduta o revocata"
	}
	participant := ticket.participant
	participant.Address = ip
	if old := m.peers[participant.ID]; old != nil {
		old.close()
	}
	p.participant = participant
	m.peers[participant.ID] = p
	p.enqueue(Event{Type: EventWelcome, Payload: mustJSON(welcome{SessionID: m.sessionID, ParticipantID: participant.ID, Participants: m.participantsLocked(), Project: m.projectInfo, Documents: m.documentIDsLocked(), Resume: match})})
	if h.LastSeq < m.replayFloor {
		p.enqueue(Event{Type: EventError, Payload: mustJSON("alcuni snapshot precedenti non sono più disponibili: chiedi all’host di condividerli di nuovo")})
	}
	if h.LastSeq > m.seq {
		p.enqueue(Event{Type: EventError, Payload: mustJSON("l’host ha recuperato una snapshot precedente: verifica i contenuti prima di continuare")})
	}
	for _, e := range m.replay {
		if e.Seq > h.LastSeq && e.From != participant.ID {
			p.enqueue(e)
		}
	}
	events := m.broadcastParticipantsLocked()
	audit("session.resumed", m.sessionID, participant.ID, participant.Role, "")
	m.mu.Unlock()
	m.checkpointSession()
	m.emitAll(events)
	return participant, ""
}

// Resume restores the same guest identity or reopens a recovered host explicitly.
func (m *Manager) Resume() (Status, error) {
	m.mu.Lock()
	if m.mode == ModeHost && m.server == nil && m.recoveryPending {
		m.mu.Unlock()
		return m.resumeHost()
	}
	if m.mode != ModeGuest || m.host != nil || m.resumeToken == "" || m.connecting {
		m.mu.Unlock()
		return Status{}, errors.New("nessuna connessione da riprendere")
	}
	inv, name, token, seq := m.guestInvite, m.self.Name, m.resumeToken, m.lastSeq
	generation := m.generation
	m.connecting = true
	m.mu.Unlock()
	status, err := m.dialHost(inv, name, token, seq, generation)
	m.mu.Lock()
	if m.generation == generation {
		m.connecting = false
	}
	m.mu.Unlock()
	if err == nil {
		m.emit(Event{Type: EventResumed, Payload: mustJSON(status)})
	}
	return status, err
}

func (m *Manager) resumeHost() (Status, error) {
	m.mu.Lock()
	cert, err := decodeSessionCert(m.certPEM, m.keyPEM, m.fp)
	if err != nil {
		m.mu.Unlock()
		return Status{}, err
	}
	address := m.address
	m.mu.Unlock()
	ln, err := tls.Listen("tcp", address, &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{cert}})
	if err != nil {
		return Status{}, fmt.Errorf("impossibile riaprire la porta di collaborazione: %w", err)
	}
	m.mu.Lock()
	if m.mode != ModeHost || m.server != nil || !m.recoveryPending {
		m.mu.Unlock()
		_ = ln.Close()
		return Status{}, errors.New("ripresa della sessione annullata")
	}
	m.upgrader = websocket.Upgrader{
		HandshakeTimeout: handshakeTimeout,
		CheckOrigin:      func(r *http.Request) bool { return r.Header.Get("Origin") == "" },
	}
	mux := http.NewServeMux()
	mux.HandleFunc(wsPath, m.handleJoin)
	m.server = &http.Server{Handler: mux, ReadHeaderTimeout: handshakeTimeout}
	m.recoveryPending = false
	go func(srv *http.Server) { _ = srv.Serve(ln) }(m.server)
	audit("session.resumed", m.sessionID, m.self.ID, m.self.Role, "")
	status := m.statusLocked()
	m.mu.Unlock()
	m.checkpointSession()
	m.emit(Event{Type: EventResumed, Payload: mustJSON(status)})
	return status, nil
}

// Shutdown closes transports for application exit while preserving recovery state.
func (m *Manager) Shutdown() {
	// Gli aggiornamenti di documento accodati devono arrivare su disco prima di chiudere.
	m.stopDocumentCheckpoints()
	m.mu.Lock()
	server, host := m.server, m.host
	peers := make([]*peer, 0, len(m.peers))
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	m.server, m.host = nil, nil
	m.peers = map[string]*peer{}
	m.generation++
	m.connecting = false
	m.recoveryPending = m.mode != ModeIdle
	m.mu.Unlock()
	for _, p := range peers {
		p.close()
	}
	if host != nil {
		host.close()
	}
	if server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}
	m.checkpointSession()
}
