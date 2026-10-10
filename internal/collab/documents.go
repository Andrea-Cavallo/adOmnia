package collab

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

const maxDocumentUpdate = 1 << 20
const maxDocumentHistory = 6 << 20 // base64 snapshot stays below the 10 MiB wire limit
const maxSharedDocuments = 64

// DocumentMessage carries opaque Yjs bytes. Only the host creates rooms.
// The relay never interprets code, writes files, or runs language tooling.
type DocumentMessage struct {
	ID      string   `json:"id"`
	Action  string   `json:"action"` // open, sync, update, awareness, close
	Data    string   `json:"data,omitempty"`
	Updates []string `json:"updates,omitempty"`
}

type documentRoom struct {
	updates []string
	bytes   int
}

func (m *Manager) documentIDsLocked() []string {
	if m.mode == ModeGuest {
		return append([]string{}, m.guestDocuments...)
	}
	ids := make([]string, 0, len(m.documents))
	for id := range m.documents {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func documentBytes(data string) (int, error) {
	if len(data) == 0 || len(data) > base64.StdEncoding.EncodedLen(maxDocumentUpdate) {
		return 0, errors.New("update documento vuoto o troppo grande")
	}
	bytes, err := base64.StdEncoding.DecodeString(data)
	if err != nil || len(bytes) == 0 || len(bytes) > maxDocumentUpdate {
		return 0, errors.New("update documento non valido")
	}
	return len(bytes), nil
}

func validDocumentID(id string) bool {
	return len(id) > 0 && len(id) <= 160 && !strings.ContainsAny(id, "\x00\r\n")
}

// OpenDocument registers a host-reviewed document with its initial Yjs state.
// IDs are opaque identifiers, never filesystem paths accepted from a guest.
func (m *Manager) OpenDocument(id, initial string) error {
	size, err := documentBytes(initial)
	if err != nil {
		return err
	}
	if !validDocumentID(id) {
		return errors.New("ID documento non valido")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.mode != ModeHost {
		return errNotHost
	}
	if m.documents == nil {
		m.documents = map[string]*documentRoom{}
	}
	if _, exists := m.documents[id]; exists {
		return errors.New("documento già condiviso")
	}
	if len(m.documents) >= maxSharedDocuments {
		return errors.New("troppi documenti condivisi")
	}
	m.documents[id] = &documentRoom{updates: []string{initial}, bytes: size}
	e := m.nextLocked(Event{Type: EventDocument, From: m.self.ID, Payload: mustJSON(DocumentMessage{ID: id, Action: "open", Updates: []string{initial}})})
	for _, p := range m.peers {
		p.enqueue(e)
	}
	return nil
}

func (m *Manager) Document(message DocumentMessage) error {
	m.mu.Lock()
	if m.mode == ModeGuest {
		if message.Action == "update" && !m.self.Role.Can(PermEditDocument) {
			m.mu.Unlock()
			return errors.New("il tuo ruolo non permette di modificare documenti")
		}
		p := m.host
		m.mu.Unlock()
		if p == nil || !p.enqueue(Event{Type: EventDocument, Payload: mustJSON(message)}) {
			return errors.New("connessione con l'host persa")
		}
		return nil
	}
	from := m.self.ID
	host := m.mode == ModeHost
	m.mu.Unlock()
	if !host {
		return errors.New("nessuna sessione attiva")
	}
	if msg := m.relayDocument(from, mustJSON(message)); msg != "" {
		return errors.New(msg)
	}
	return nil
}

func (m *Manager) relayDocument(from string, payload json.RawMessage) string {
	var message DocumentMessage
	if json.Unmarshal(payload, &message) != nil || !validDocumentID(message.ID) || len(message.Updates) != 0 {
		return "messaggio documento non valido"
	}
	size := 0
	switch message.Action {
	case "update", "awareness":
		var err error
		size, err = documentBytes(message.Data)
		if err != nil {
			return err.Error()
		}
	case "sync", "close":
		if message.Data != "" {
			return "messaggio documento non valido"
		}
	default:
		return "azione documento non consentita"
	}
	m.mu.Lock()
	if m.mode != ModeHost {
		m.mu.Unlock()
		return "sessione chiusa"
	}
	host := from == m.self.ID
	p := m.peers[from]
	if !host && p == nil {
		m.mu.Unlock()
		return "partecipante sconosciuto"
	}
	room := m.documents[message.ID]
	if room == nil {
		m.mu.Unlock()
		return "documento non condiviso"
	}
	if message.Action == "close" && !host {
		m.mu.Unlock()
		return "solo l'host può chiudere un documento"
	}
	if message.Action == "update" && !host && !p.participant.Role.Can(PermEditDocument) {
		m.mu.Unlock()
		return "il tuo ruolo non permette di modificare documenti"
	}
	if message.Action == "sync" {
		reply := m.nextLocked(Event{Type: EventDocument, From: m.self.ID, Payload: mustJSON(DocumentMessage{ID: message.ID, Action: "sync", Updates: room.updates})})
		if !host {
			p.enqueue(reply)
		}
		m.mu.Unlock()
		if host {
			m.emit(reply)
		}
		return ""
	}
	if message.Action == "update" {
		if room.bytes+size > maxDocumentHistory || len(room.updates) >= 1024 {
			m.mu.Unlock()
			return "cronologia documento piena: l'host deve riaprire la condivisione"
		}
		room.updates = append(room.updates, message.Data)
		room.bytes += size
	}
	if message.Action == "close" {
		delete(m.documents, message.ID)
	}
	e := m.nextLocked(Event{Type: EventDocument, From: from, Payload: mustJSON(message)})
	for id, other := range m.peers {
		if id != from {
			other.enqueue(e)
		}
	}
	m.mu.Unlock()
	if !host {
		m.emit(e)
	}
	return ""
}
