// Package workspace holds the core types of a Code Studio session (project, session, open documents) shared
// by the host and the IDE packages, so a feature can leave internal/codestudio without importing it.
package workspace

import (
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// DocumentID identifies a document open in a session.
type DocumentID string

type AuthorizationState string

const (
	AuthorizationOpened    AuthorizationState = "opened"
	AuthorizationPermitted AuthorizationState = "tooling-permitted"
)

type Project struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	RootPath      string             `json:"rootPath"`
	RealPath      string             `json:"realPath"`
	Authorization AuthorizationState `json:"authorization"`
	// Units sono le unità di build rilevate dai language adapter (multi-linguaggio): moduli Go,
	// go.work e cartelle sciolte si leggono da qui (goLayoutOf), non da campi dedicati.
	Units []project.Unit `json:"units"`
}

type Session struct {
	ID      run.SessionID `json:"id"`
	Project Project       `json:"project"`
	// WorkspaceID è il workspace Code Studio che contiene la sessione, indipendente dai workspace API di adOmnia.
	WorkspaceID string    `json:"workspaceId,omitempty"`
	OpenedAt    time.Time `json:"openedAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Document struct {
	ID           DocumentID    `json:"id"`
	SessionID    run.SessionID `json:"sessionId"`
	URI          string        `json:"uri"`
	Path         string        `json:"path"`
	RelativePath string        `json:"relativePath"`
	Name         string        `json:"name"`
	Language     string        `json:"language"`
	Version      int           `json:"version"`
	Dirty        bool          `json:"dirty"`
	ReadOnly     bool          `json:"readOnly,omitzero"`
	External     bool          `json:"external,omitzero"`
	// MediaType è valorizzato per le immagini (image/png, image/jpeg…); Language è "image".
	MediaType string `json:"mediaType,omitempty"`
}

type OpenDocument struct {
	Document   Document  `json:"document"`
	Content    string    `json:"content"`
	DiskToken  string    `json:"diskToken"`
	ModifiedAt time.Time `json:"modifiedAt"`
	// DataURL è il contenuto base64 di un'immagine, per l'anteprima nell'editor.
	DataURL string `json:"dataUrl,omitempty"`
}

type DocumentDiskState struct {
	DocumentID DocumentID `json:"documentId"`
	Changed    bool       `json:"changed"`
	Content    string     `json:"content,omitempty"`
	DiskToken  string     `json:"diskToken"`
	ModifiedAt time.Time  `json:"modifiedAt"`
}
