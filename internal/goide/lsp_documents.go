package goide

import (
	"fmt"
	"net/url"
	"path/filepath"

	"adomnia/internal/ide/lsp"
)

// ErrStaleDocumentVersion indica una modifica con versione non successiva a quella già sincronizzata.
var ErrStaleDocumentVersion = fmt.Errorf("versione documento obsoleta")

// TrackDocument registra un documento aperto e lo invia al language server del suo linguaggio se attivo;
// i file che nessun linguaggio registrato riconosce vengono ignorati.
func (m *LSPManager) TrackDocument(session Session, document Document, text string, readOnly bool) {
	owner, languageID, ok := m.languages.ForPath(document.Path)
	if !ok {
		return
	}
	state := m.ensure(session, owner.ID())
	state.mu.Lock()
	if _, exists := state.documents[document.ID]; exists {
		state.mu.Unlock()
		return
	}
	tracked := &trackedDocument{id: document.ID, uri: document.URI, path: document.Path, languageID: languageID, version: 1, text: text, readOnly: readOnly}
	state.documents[document.ID] = tracked
	state.byURI[document.URI] = document.ID
	process := state.synced
	state.mu.Unlock()
	if process != nil {
		_ = process.conn.Notify("textDocument/didOpen", map[string]any{"textDocument": lsp.TextDocumentItem{
			URI: tracked.uri, LanguageID: languageID, Version: 1, Text: text,
		}})
	}
}

// UpdateDocument sincronizza il buffer non salvato; versioni non crescenti vengono rifiutate come obsolete.
func (m *LSPManager) UpdateDocument(sessionID SessionID, documentID DocumentID, version int, text string) error {
	if int64(len(text)) > MaxDocumentBytes {
		return fmt.Errorf("documento troppo grande per la sincronizzazione")
	}
	state, ok := m.forDocument(sessionID, documentID)
	if !ok {
		return nil
	}
	state.mu.Lock()
	tracked, ok := state.documents[documentID]
	if !ok {
		state.mu.Unlock()
		return nil
	}
	if tracked.readOnly {
		state.mu.Unlock()
		return fmt.Errorf("documento in sola lettura")
	}
	if version <= tracked.version {
		state.mu.Unlock()
		return ErrStaleDocumentVersion
	}
	tracked.version = version
	tracked.text = text
	uri := tracked.uri
	process := state.synced
	state.mu.Unlock()
	if process == nil {
		return nil
	}
	return process.conn.Notify("textDocument/didChange", map[string]any{
		"textDocument":   lsp.VersionedTextDocumentIdentifier{URI: uri, Version: version},
		"contentChanges": []map[string]string{{"text": text}},
	})
}

// DocumentSaved notifica a gopls il salvataggio del documento.
func (m *LSPManager) DocumentSaved(sessionID SessionID, documentID DocumentID) {
	state, ok := m.forDocument(sessionID, documentID)
	if !ok {
		return
	}
	state.mu.Lock()
	tracked, ok := state.documents[documentID]
	process := state.synced
	state.mu.Unlock()
	if ok && process != nil {
		_ = process.conn.Notify("textDocument/didSave", map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: tracked.uri}})
	}
}

// UntrackDocument chiude il documento lato gopls e lo dimentica.
func (m *LSPManager) UntrackDocument(sessionID SessionID, documentID DocumentID) {
	state, ok := m.forDocument(sessionID, documentID)
	if !ok {
		return
	}
	state.mu.Lock()
	tracked, ok := state.documents[documentID]
	if ok {
		delete(state.documents, documentID)
		delete(state.byURI, tracked.uri)
	}
	process := state.synced
	state.mu.Unlock()
	if ok && process != nil {
		_ = process.conn.Notify("textDocument/didClose", map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: tracked.uri}})
	}
}

// snapshot restituisce una copia del documento e la connessione del server che lo possiede;
// errore se il server non è pronto.
func (m *LSPManager) snapshot(sessionID SessionID, documentID DocumentID) (trackedDocument, *serverProcess, error) {
	state, ok := m.forDocument(sessionID, documentID)
	if !ok {
		return trackedDocument{}, nil, fmt.Errorf("documento non sincronizzato con un language server")
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.process == nil || state.status.State != LanguageServerReady {
		return trackedDocument{}, nil, fmt.Errorf("%s non è pronto", state.options.DisplayName())
	}
	return *state.documents[documentID], state.process, nil
}

func pathFromURI(uri string) string {
	parsed, err := url.Parse(uri)
	if err != nil || parsed.Scheme != "file" {
		return ""
	}
	path := parsed.Path
	if len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	return filepath.FromSlash(path)
}

// relativeWithin restituisce il percorso relativo con "/" se path è dentro root, altrimenti stringa vuota.
func relativeWithin(root, path string) string {
	if root == "" || path == "" || ensureWithinRoot(root, path) != nil {
		return ""
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(rel)
}

func editorRange(value lsp.Range) EditorRange {
	return EditorRange{
		StartLine: value.Start.Line + 1, StartColumn: value.Start.Character + 1,
		EndLine: value.End.Line + 1, EndColumn: value.End.Character + 1,
	}
}

func lspPosition(line, column int) lsp.Position {
	return lsp.Position{Line: max(0, line-1), Character: max(0, column-1)}
}

func editorEdits(edits []lsp.TextEdit) []EditorTextEdit {
	result := make([]EditorTextEdit, 0, len(edits))
	for _, edit := range edits {
		result = append(result, EditorTextEdit{Range: editorRange(edit.Range), Text: edit.NewText})
	}
	return result
}

// NotifyWatchedFiles comunica a ogni language server della sessione i file cambiati su disco che
// osserva (WatchesFile) e che non sono aperti nell'editor.
func (m *LSPManager) NotifyWatchedFiles(sessionID SessionID, changes []DiskChange) {
	for _, state := range m.servers(sessionID) {
		state.mu.Lock()
		process := state.process
		ready := state.status.State == LanguageServerReady
		watches := state.options.WatchesFile
		events := make([]map[string]any, 0, len(changes))
		for _, change := range changes {
			uri := fileURI(change.Path)
			if _, open := state.byURI[uri]; open || watches == nil || !watches(change.Path) {
				continue
			}
			events = append(events, map[string]any{"uri": uri, "type": int(change.Kind)})
		}
		state.mu.Unlock()
		if process == nil || !ready || len(events) == 0 {
			continue
		}
		_ = process.conn.Notify("workspace/didChangeWatchedFiles", map[string]any{"changes": events})
	}
}
