package collab

import (
	"crypto/subtle"
	"errors"
	"time"
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
	for _, e := range m.replay {
		if e.Seq > h.LastSeq && e.From != participant.ID {
			p.enqueue(e)
		}
	}
	events := m.broadcastParticipantsLocked()
	audit("session.resumed", m.sessionID, participant.ID, participant.Role, "")
	m.mu.Unlock()
	m.emitAll(events)
	return participant, ""
}

// Resume uses an in-memory credential tied to the pinned host certificate.
// It preserves the participant identity and current server-side role.
func (m *Manager) Resume() (Status, error) {
	m.mu.Lock()
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
