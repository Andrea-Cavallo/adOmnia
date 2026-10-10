// Package collab è il Collaboration Engine: sessioni LAN autenticate tra
// istanze adOmnia, host-authoritative, senza account cloud.
package collab

import (
	"encoding/json"
	"time"
)

// Role di un partecipante. L'host è sempre Controller.
type Role string

const (
	RoleViewer     Role = "viewer"
	RoleEditor     Role = "editor"
	RoleController Role = "controller"
)

// Permission è un'azione che un guest chiede all'host di eseguire o inoltrare.
// ponytail: solo i permessi con un consumer reale; terminal/debug/git arrivano con le loro feature.
type Permission string

const (
	PermShare        Permission = "share"
	PermEditDocument Permission = "document.edit"
)

var rolePermissions = map[Role]map[Permission]bool{
	RoleViewer:     {},
	RoleEditor:     {PermShare: true, PermEditDocument: true},
	RoleController: {PermShare: true, PermEditDocument: true},
}

func (r Role) Valid() bool { _, ok := rolePermissions[r]; return ok }

// Can è l'unico punto in cui si decide un permesso (validazione server-side sull'host).
func (r Role) Can(p Permission) bool { return rolePermissions[r][p] }

type Participant struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Role     Role      `json:"role"`
	Host     bool      `json:"host"`
	Address  string    `json:"address,omitempty"`
	JoinedAt time.Time `json:"joinedAt"`
}

// Event è l'envelope di ogni messaggio sul filo e verso il frontend.
type Event struct {
	Seq     uint64          `json:"seq"`
	Type    string          `json:"type"`
	From    string          `json:"from,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

const (
	EventHello        = "hello"
	EventWelcome      = "welcome"
	EventParticipants = "participants"
	EventShare        = "share"
	EventClosed       = "closed"
	EventError        = "error"
	EventDocument     = "document"
)

// ShareKind è il tipo di contenuto condiviso (feature 11, 13, 14).
type ShareKind string

const (
	ShareCollection   ShareKind = "collection"
	ShareRequest      ShareKind = "request"
	ShareEnvironments ShareKind = "environments"
)

func (k ShareKind) Valid() bool {
	return k == ShareCollection || k == ShareRequest || k == ShareEnvironments
}

// Share è il payload di EventShare: contenuto già filtrato dai segreti all'origine.
type Share struct {
	ID              string          `json:"id"`
	Kind            ShareKind       `json:"kind"`
	Title           string          `json:"title"`
	Data            json.RawMessage `json:"data"`
	Redacted        []string        `json:"redacted,omitempty"`
	Revision        string          `json:"revision,omitempty"`
	SecretVariables []string        `json:"secretVariables,omitempty"`
	SourceID        string          `json:"sourceId,omitempty"`
}

type hello struct {
	Token   string `json:"token"`
	Name    string `json:"name"`
	Resume  string `json:"resume,omitempty"`
	LastSeq uint64 `json:"lastSeq,omitempty"`
}

type welcome struct {
	SessionID     string        `json:"sessionId"`
	ParticipantID string        `json:"participantId"`
	Participants  []Participant `json:"participants"`
	Project       *ProjectInfo  `json:"project,omitempty"`
	Documents     []string      `json:"documents,omitempty"`
	Resume        string        `json:"resume,omitempty"`
}

// Status è lo snapshot che il frontend legge all'avvio o dopo ogni evento.
type Status struct {
	Mode          string        `json:"mode"` // "idle" | "host" | "guest"
	SessionID     string        `json:"sessionId,omitempty"`
	Self          string        `json:"self,omitempty"`
	Address       string        `json:"address,omitempty"`
	Fingerprint   string        `json:"fingerprint,omitempty"`
	Participants  []Participant `json:"participants"`
	PendingInvite int           `json:"pendingInvites"`
	Project       *ProjectInfo  `json:"project,omitempty"`
	Documents     []string      `json:"documents,omitempty"`
	Disconnected  bool          `json:"disconnected,omitempty"`
}

// Invite è ciò che l'host copia e manda al guest.
type Invite struct {
	Code      string    `json:"code"`
	Role      Role      `json:"role"`
	ExpiresAt time.Time `json:"expiresAt"`
}
