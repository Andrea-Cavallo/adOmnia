package copilot

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"path/filepath"
	"sort"

	"adomnia/internal/goide/lsp"
)

// ErrExcluded indica un file escluso dal contesto AI (segreti o .adomnia/aiignore).
var ErrExcluded = errors.New("this file is excluded from AI context")

// OpenedDocument descrive un documento aperto in gO Studio.
type OpenedDocument struct {
	ID           string
	URI          string
	Root         string
	RootName     string
	RelativePath string
	LanguageID   string
	Text         string
}

// DocumentOpened registra il documento e lo invia al server se attivo. I file sensibili non partono mai.
func (m *Manager) DocumentOpened(opened OpenedDocument) {
	if len(opened.Text) > maxDocumentBytes || LoadContextFilter(opened.Root).Excluded(opened.RelativePath) {
		return
	}
	m.mu.Lock()
	if _, exists := m.documents[opened.URI]; exists {
		m.mu.Unlock()
		return
	}
	tracked := &document{uri: opened.URI, root: opened.Root, languageID: opened.LanguageID, version: 1, text: opened.Text}
	m.documents[opened.URI] = tracked
	m.byID[opened.ID] = opened.URI
	_, knownFolder := m.folders[opened.Root]
	if !knownFolder && opened.Root != "" {
		m.folders[opened.Root] = opened.RootName
	}
	running := m.current
	m.mu.Unlock()
	if running == nil {
		return
	}
	if !knownFolder && opened.Root != "" {
		_ = running.conn.Notify("workspace/didChangeWorkspaceFolders", map[string]any{"event": map[string]any{
			"added": []map[string]string{{"uri": fileURI(opened.Root), "name": opened.RootName}}, "removed": []any{},
		}})
	}
	_ = running.conn.Notify("textDocument/didOpen", map[string]any{"textDocument": lsp.TextDocumentItem{
		URI: tracked.uri, LanguageID: tracked.languageID, Version: 1, Text: tracked.text,
	}})
}

// DocumentChanged invia il buffer completo: il server accetta la sostituzione totale del testo.
func (m *Manager) DocumentChanged(documentID string, version int, text string) {
	m.mu.Lock()
	tracked := m.trackedLocked(documentID)
	if tracked == nil || version <= tracked.version || len(text) > maxDocumentBytes {
		m.mu.Unlock()
		return
	}
	tracked.version = version
	tracked.text = text
	running := m.current
	uri := tracked.uri
	m.mu.Unlock()
	if running != nil {
		_ = running.conn.Notify("textDocument/didChange", map[string]any{
			"textDocument":   lsp.VersionedTextDocumentIdentifier{URI: uri, Version: version},
			"contentChanges": []map[string]string{{"text": text}},
		})
	}
}

// DocumentSaved notifica il salvataggio.
func (m *Manager) DocumentSaved(documentID string) {
	m.notifyDocument(documentID, "textDocument/didSave")
}

// DocumentFocused comunica il file attivo: migliora la pertinenza dei suggerimenti.
func (m *Manager) DocumentFocused(documentID string) {
	m.notifyDocument(documentID, "textDocument/didFocus")
}

// DocumentClosed chiude e dimentica il documento.
func (m *Manager) DocumentClosed(documentID string) {
	m.mu.Lock()
	uri, ok := m.byID[documentID]
	if ok {
		delete(m.byID, documentID)
		delete(m.documents, uri)
	}
	running := m.current
	m.mu.Unlock()
	if ok && running != nil {
		_ = running.conn.Notify("textDocument/didClose", map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: uri}})
	}
}

func (m *Manager) notifyDocument(documentID, method string) {
	m.mu.Lock()
	uri, ok := m.byID[documentID]
	running := m.current
	m.mu.Unlock()
	if ok && running != nil {
		_ = running.conn.Notify(method, map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: uri}})
	}
}

func (m *Manager) trackedLocked(documentID string) *document {
	uri, ok := m.byID[documentID]
	if !ok {
		return nil
	}
	return m.documents[uri]
}

func (m *Manager) reopenDocuments(running *process) {
	m.mu.Lock()
	documents := make([]document, 0, len(m.documents))
	for _, tracked := range m.documents {
		documents = append(documents, *tracked)
	}
	m.mu.Unlock()
	for _, tracked := range documents {
		_ = running.conn.Notify("textDocument/didOpen", map[string]any{"textDocument": lsp.TextDocumentItem{
			URI: tracked.uri, LanguageID: tracked.languageID, Version: tracked.version, Text: tracked.text,
		}})
	}
}

func (m *Manager) workspaceFoldersLocked() []map[string]string {
	roots := make([]string, 0, len(m.folders))
	for root := range m.folders {
		roots = append(roots, root)
	}
	sort.Strings(roots)
	folders := make([]map[string]string, 0, len(roots))
	for _, root := range roots {
		folders = append(folders, map[string]string{"uri": fileURI(root), "name": m.folders[root]})
	}
	return folders
}

// InlineCompletionRequest usa posizioni Monaco (1-based, UTF-16), come il resto di gO Studio.
type InlineCompletionRequest struct {
	DocumentID   string `json:"documentId"`
	Version      int    `json:"version"`
	Line         int    `json:"line"`
	Column       int    `json:"column"`
	TabSize      int    `json:"tabSize"`
	InsertSpaces bool   `json:"insertSpaces"`
	// Automatic distingue la digitazione (Automatic) dalla richiesta esplicita (Alt+\).
	Automatic bool `json:"automatic"`
}

// InlineCompletionItem è un suggerimento in coordinate Monaco. Raw va restituito così com'è per
// la telemetria di visualizzazione e accettazione richiesta dal server.
type InlineCompletionItem struct {
	InsertText  string          `json:"insertText"`
	StartLine   int             `json:"startLine"`
	StartColumn int             `json:"startColumn"`
	EndLine     int             `json:"endLine"`
	EndColumn   int             `json:"endColumn"`
	Raw         json.RawMessage `json:"raw"`
}

type lspInlineItem struct {
	InsertText string    `json:"insertText"`
	Range      lsp.Range `json:"range"`
}

const (
	triggerInvoked   = 1
	triggerAutomatic = 2
)

// InlineCompletion chiede il ghost text. La cancellazione del contesto (nuova digitazione) invia
// $/cancelRequest, così non arrivano suggerimenti obsoleti.
func (m *Manager) InlineCompletion(ctx context.Context, request InlineCompletionRequest) ([]InlineCompletionItem, error) {
	m.mu.Lock()
	enabled := m.settings.InlineCompletion && m.status.State == StateReady
	tracked := m.trackedLocked(request.DocumentID)
	running := m.current
	var uri string
	var version int
	if tracked != nil {
		uri, version = tracked.uri, tracked.version
	}
	m.mu.Unlock()
	if !enabled || running == nil {
		return []InlineCompletionItem{}, nil
	}
	if tracked == nil {
		return []InlineCompletionItem{}, ErrExcluded
	}
	if request.Version > version {
		// Il buffer più recente non è ancora arrivato: meglio nessun suggerimento che uno sbagliato.
		return []InlineCompletionItem{}, nil
	}
	trigger := triggerInvoked
	if request.Automatic {
		trigger = triggerAutomatic
	}
	callCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	var result struct {
		Items []json.RawMessage `json:"items"`
	}
	params := map[string]any{
		"textDocument":      map[string]any{"uri": uri, "version": version},
		"position":          lsp.Position{Line: request.Line - 1, Character: request.Column - 1},
		"context":           map[string]any{"triggerKind": trigger},
		"formattingOptions": map[string]any{"tabSize": max(1, request.TabSize), "insertSpaces": request.InsertSpaces},
	}
	if err := running.conn.Call(callCtx, "textDocument/inlineCompletion", params, &result); err != nil {
		if lsp.IsCancelled(err) || errors.Is(err, context.Canceled) {
			return []InlineCompletionItem{}, nil
		}
		return []InlineCompletionItem{}, err
	}
	items := make([]InlineCompletionItem, 0, len(result.Items))
	for _, raw := range result.Items {
		var item lspInlineItem
		if json.Unmarshal(raw, &item) != nil || item.InsertText == "" {
			continue
		}
		items = append(items, InlineCompletionItem{
			InsertText: item.InsertText,
			StartLine:  item.Range.Start.Line + 1, StartColumn: item.Range.Start.Character + 1,
			EndLine: item.Range.End.Line + 1, EndColumn: item.Range.End.Character + 1,
			Raw: raw,
		})
	}
	return items, nil
}

// DidShowCompletion segnala al server che il suggerimento è stato mostrato.
func (m *Manager) DidShowCompletion(raw json.RawMessage) {
	if running, err := m.connection(); err == nil {
		_ = running.Notify("textDocument/didShowCompletion", map[string]any{"item": raw})
	}
}

// DidAcceptCompletion esegue il comando di accettazione allegato al suggerimento.
func (m *Manager) DidAcceptCompletion(raw json.RawMessage) {
	var item struct {
		Command *command `json:"command"`
	}
	running, err := m.connection()
	if err != nil || json.Unmarshal(raw, &item) != nil || item.Command == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	_ = running.Call(ctx, "workspace/executeCommand", map[string]any{"command": item.Command.Command, "arguments": item.Command.Arguments}, nil)
}

// DidPartiallyAcceptCompletion segnala un'accettazione parziale (parola per parola).
func (m *Manager) DidPartiallyAcceptCompletion(raw json.RawMessage, acceptedLength int) {
	if running, err := m.connection(); err == nil {
		_ = running.Notify("textDocument/didPartiallyAcceptCompletion", map[string]any{"item": raw, "acceptedLength": acceptedLength})
	}
}

// fileURI converte un percorso assoluto in URI file://, con la stessa codifica usata da goide per i documenti.
func fileURI(path string) string {
	normalized := filepath.ToSlash(path)
	if len(normalized) >= 2 && normalized[1] == ':' {
		normalized = "/" + normalized
	}
	return (&url.URL{Scheme: "file", Path: normalized}).String()
}
