package goide

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf16"

	"adomnia/internal/goide/lsp"
)

const (
	maxLocationResults        = 500
	maxWorkspaceSymbolResults = 200
	maxCompletionItems        = 300
)

var locationMethods = map[string]string{
	"definition":     "textDocument/definition",
	"typeDefinition": "textDocument/typeDefinition",
	"implementation": "textDocument/implementation",
	"references":     "textDocument/references",
}

func withRequestTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, defaultRequestTimeout)
}

func positionParams(document trackedDocument, line, column int) lsp.TextDocumentPositionParams {
	return lsp.TextDocumentPositionParams{TextDocument: lsp.TextDocumentIdentifier{URI: document.uri}, Position: lspPosition(line, column)}
}

// Completion restituisce i suggerimenti gopls per il buffer sincronizzato, inclusi gli import automatici.
func (m *LSPManager) Completion(ctx context.Context, sessionID SessionID, documentID DocumentID, line, column int) (CompletionResult, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return CompletionResult{}, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var raw json.RawMessage
	if err := process.conn.Call(ctx, "textDocument/completion", positionParams(document, line, column), &raw); err != nil {
		return CompletionResult{}, err
	}
	list := lsp.CompletionList{}
	if len(raw) > 0 && raw[0] == '[' {
		_ = json.Unmarshal(raw, &list.Items)
	} else if len(raw) > 0 {
		_ = json.Unmarshal(raw, &list)
	}
	result := CompletionResult{Version: document.version, Incomplete: list.IsIncomplete, Items: make([]CompletionEntry, 0, min(len(list.Items), maxCompletionItems))}
	for _, item := range list.Items {
		if len(result.Items) == maxCompletionItems {
			result.Incomplete = true
			break
		}
		result.Items = append(result.Items, completionEntry(item))
	}
	return result, nil
}

func completionEntry(item lsp.CompletionItem) CompletionEntry {
	entry := CompletionEntry{
		Label: item.Label, Kind: item.Kind, Detail: item.Detail, Documentation: markupText(item.Documentation),
		SortText: item.SortText, FilterText: item.FilterText, InsertText: item.InsertText, Snippet: item.InsertTextFormat == 2,
		AdditionalEdits: editorEdits(item.AdditionalTextEdits), Preselect: item.Preselect, Deprecated: item.Deprecated,
	}
	for _, tag := range item.Tags {
		entry.Deprecated = entry.Deprecated || tag == 1
	}
	if item.TextEdit != nil {
		replace := editorRange(item.TextEdit.Range)
		entry.Range = &replace
		entry.InsertText = item.TextEdit.NewText
	}
	if entry.InsertText == "" {
		entry.InsertText = item.Label
	}
	return entry
}

// Hover restituisce la documentazione Markdown del simbolo sotto il cursore.
func (m *LSPManager) Hover(ctx context.Context, sessionID SessionID, documentID DocumentID, line, column int) (HoverResult, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return HoverResult{}, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var hover *lsp.Hover
	if err := process.conn.Call(ctx, "textDocument/hover", positionParams(document, line, column), &hover); err != nil {
		return HoverResult{}, err
	}
	result := HoverResult{Version: document.version}
	if hover == nil {
		return result, nil
	}
	result.Markdown = hover.Contents.Value
	if hover.Range != nil {
		value := editorRange(*hover.Range)
		result.Range = &value
	}
	return result, nil
}

// SignatureHelp restituisce le firme della chiamata sotto il cursore con il parametro attivo.
func (m *LSPManager) SignatureHelp(ctx context.Context, sessionID SessionID, documentID DocumentID, line, column int) (SignatureResult, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return SignatureResult{}, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var help *lsp.SignatureHelp
	if err := process.conn.Call(ctx, "textDocument/signatureHelp", positionParams(document, line, column), &help); err != nil {
		return SignatureResult{}, err
	}
	result := SignatureResult{Version: document.version, Signatures: []SignatureEntry{}}
	if help == nil {
		return result, nil
	}
	result.ActiveSignature = help.ActiveSignature
	result.ActiveParameter = help.ActiveParameter
	for _, signature := range help.Signatures {
		entry := SignatureEntry{Label: signature.Label, Documentation: markupText(signature.Documentation), Parameters: []SignatureParameter{}}
		for _, parameter := range signature.Parameters {
			entry.Parameters = append(entry.Parameters, SignatureParameter{
				Label: parameterLabel(signature.Label, parameter.Label), Documentation: markupText(parameter.Documentation),
			})
		}
		result.Signatures = append(result.Signatures, entry)
	}
	return result, nil
}

// Locations esegue definition, typeDefinition, implementation o references con anteprima della riga.
func (m *LSPManager) Locations(ctx context.Context, sessionID SessionID, documentID DocumentID, kind string, line, column int) ([]EditorLocation, error) {
	method, ok := locationMethods[kind]
	if !ok {
		return nil, fmt.Errorf("tipo di navigazione non supportato")
	}
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	params := map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: document.uri}, "position": lspPosition(line, column)}
	if kind == "references" {
		params["context"] = map[string]bool{"includeDeclaration": true}
	}
	var raw json.RawMessage
	if err := process.conn.Call(ctx, method, params, &raw); err != nil {
		return nil, err
	}
	locations := decodeLocations(raw)
	if len(locations) > maxLocationResults {
		locations = locations[:maxLocationResults]
	}
	state, _ := m.get(sessionID)
	return m.editorLocations(state, locations), nil
}

func decodeLocations(raw json.RawMessage) []lsp.Location {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	if raw[0] == '{' {
		var single lsp.Location
		if json.Unmarshal(raw, &single) == nil {
			return []lsp.Location{single}
		}
		return nil
	}
	var entries []json.RawMessage
	if json.Unmarshal(raw, &entries) != nil {
		return nil
	}
	locations := make([]lsp.Location, 0, len(entries))
	for _, entry := range entries {
		var link lsp.LocationLink
		if json.Unmarshal(entry, &link) == nil && link.TargetURI != "" {
			locations = append(locations, lsp.Location{URI: link.TargetURI, Range: link.TargetSelectionRange})
			continue
		}
		var location lsp.Location
		if json.Unmarshal(entry, &location) == nil && location.URI != "" {
			locations = append(locations, location)
		}
	}
	return locations
}

func (m *LSPManager) editorLocations(state *lspSession, locations []lsp.Location) []EditorLocation {
	texts := map[string]string{}
	result := make([]EditorLocation, 0, len(locations))
	for _, location := range locations {
		path := pathFromURI(location.URI)
		text, ok := texts[location.URI]
		if !ok {
			text = m.documentText(state, location.URI, path)
			texts[location.URI] = text
		}
		relative := relativeWithin(state.root, path)
		result = append(result, EditorLocation{
			URI: location.URI, Path: path, RelativePath: relative, External: relative == "",
			Range: editorRange(location.Range), Preview: strings.TrimSpace(lsp.LineText(text, location.Range.Start.Line)),
		})
	}
	sort.SliceStable(result, func(left, right int) bool {
		if result[left].Path != result[right].Path {
			return result[left].Path < result[right].Path
		}
		return result[left].Range.StartLine < result[right].Range.StartLine
	})
	return result
}

// documentText preferisce il buffer sincronizzato al contenuto su disco.
func (m *LSPManager) documentText(state *lspSession, uri, path string) string {
	state.mu.Lock()
	if id, ok := state.byURI[uri]; ok {
		text := state.documents[id].text
		state.mu.Unlock()
		return text
	}
	state.mu.Unlock()
	text, _, _, err := readTextFile(path)
	if err != nil {
		return ""
	}
	return text
}

// DocumentSymbols restituisce la struttura gerarchica del file.
func (m *LSPManager) DocumentSymbols(ctx context.Context, sessionID SessionID, documentID DocumentID) ([]SymbolNode, int, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return nil, 0, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var symbols []lsp.DocumentSymbol
	if err := process.conn.Call(ctx, "textDocument/documentSymbol", map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: document.uri}}, &symbols); err != nil {
		return nil, 0, err
	}
	return symbolNodes(symbols), document.version, nil
}

func symbolNodes(symbols []lsp.DocumentSymbol) []SymbolNode {
	nodes := make([]SymbolNode, 0, len(symbols))
	for _, symbol := range symbols {
		nodes = append(nodes, SymbolNode{
			Name: symbol.Name, Detail: symbol.Detail, Kind: symbol.Kind, Range: editorRange(symbol.Range),
			SelectionRange: editorRange(symbol.SelectionRange), Children: symbolNodes(symbol.Children),
		})
	}
	return nodes
}

// WorkspaceSymbols cerca simboli in tutto il workspace della sessione.
func (m *LSPManager) WorkspaceSymbols(ctx context.Context, sessionID SessionID, query string) ([]WorkspaceSymbol, error) {
	state, process, err := m.readyProcess(sessionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var symbols []lsp.SymbolInformation
	if err := process.conn.Call(ctx, "workspace/symbol", map[string]string{"query": query}, &symbols); err != nil {
		return nil, err
	}
	if len(symbols) > maxWorkspaceSymbolResults {
		symbols = symbols[:maxWorkspaceSymbolResults]
	}
	converted := make([]WorkspaceSymbol, 0, len(symbols))
	for _, symbol := range symbols {
		path := pathFromURI(symbol.Location.URI)
		relative := relativeWithin(state.root, path)
		converted = append(converted, WorkspaceSymbol{
			Name: symbol.Name, Kind: symbol.Kind, Container: symbol.ContainerName,
			Location: EditorLocation{URI: symbol.Location.URI, Path: path, RelativePath: relative, External: relative == "", Range: editorRange(symbol.Location.Range)},
		})
	}
	return converted, nil
}

func (m *LSPManager) readyProcess(sessionID SessionID) (*lspSession, *serverProcess, error) {
	state, ok := m.get(sessionID)
	if !ok {
		return nil, nil, fmt.Errorf("gopls non avviato per questa sessione")
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.process == nil || state.status.State != LanguageServerReady {
		return nil, nil, fmt.Errorf("gopls non è pronto")
	}
	return state, state.process, nil
}

// PrepareRename verifica che il simbolo sia rinominabile e restituisce il nome corrente.
func (m *LSPManager) PrepareRename(ctx context.Context, sessionID SessionID, documentID DocumentID, line, column int) (RenameTarget, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return RenameTarget{}, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var result *lsp.PrepareRenameResult
	if err := process.conn.Call(ctx, "textDocument/prepareRename", positionParams(document, line, column), &result); err != nil {
		return RenameTarget{}, err
	}
	if result == nil {
		return RenameTarget{}, fmt.Errorf("nessun simbolo rinominabile in questa posizione")
	}
	return RenameTarget{Version: document.version, Range: editorRange(result.Range), Placeholder: result.Placeholder}, nil
}

// Rename calcola il rename semantico come anteprima; nessun file viene scritto.
func (m *LSPManager) Rename(ctx context.Context, sessionID SessionID, documentID DocumentID, line, column int, newName string) (WorkspaceChange, error) {
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return WorkspaceChange{}, fmt.Errorf("il nuovo nome non può essere vuoto")
	}
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return WorkspaceChange{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*defaultRequestTimeout)
	defer cancel()
	params := map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: document.uri}, "position": lspPosition(line, column), "newName": newName}
	var edit *lsp.WorkspaceEdit
	if err := process.conn.Call(ctx, "textDocument/rename", params, &edit); err != nil {
		return WorkspaceChange{}, err
	}
	if edit == nil {
		return WorkspaceChange{Label: "Rename", Files: []FileChange{}}, nil
	}
	state, _ := m.get(sessionID)
	return m.workspaceChange(state, "Rename to "+newName, *edit)
}

// Format restituisce gli edit di formattazione gopls/gofmt per il buffer corrente.
func (m *LSPManager) Format(ctx context.Context, sessionID SessionID, documentID DocumentID) ([]EditorTextEdit, int, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return nil, 0, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var edits []lsp.TextEdit
	params := map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: document.uri}, "options": map[string]any{"tabSize": 4, "insertSpaces": false}}
	if err := process.conn.Call(ctx, "textDocument/formatting", params, &edits); err != nil {
		return nil, 0, err
	}
	return editorEdits(edits), document.version, nil
}

// CodeActions elenca quick fix, refactoring e azioni sorgente disponibili per l'intervallo.
func (m *LSPManager) CodeActions(ctx context.Context, sessionID SessionID, documentID DocumentID, selection EditorRange, only []string) ([]CodeActionEntry, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return nil, err
	}
	state, _ := m.get(sessionID)
	requested := lsp.Range{Start: lspPosition(selection.StartLine, selection.StartColumn), End: lspPosition(selection.EndLine, selection.EndColumn)}
	actionContext := map[string]any{"diagnostics": m.overlappingDiagnostics(state, document.uri, requested)}
	if len(only) > 0 {
		actionContext["only"] = only
	}
	params := map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: document.uri}, "range": requested, "context": actionContext}
	requestCtx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var raw []json.RawMessage
	if err := process.conn.Call(requestCtx, "textDocument/codeAction", params, &raw); err != nil {
		return nil, err
	}
	entries := make([]CodeActionEntry, 0, len(raw))
	state.mu.Lock()
	if len(state.codeActions) > maxCodeActionCacheItems {
		state.codeActions = make(map[string]lsp.CodeAction)
	}
	for _, item := range raw {
		var action lsp.CodeAction
		if json.Unmarshal(item, &action) != nil || action.Title == "" {
			continue
		}
		if action.Edit == nil && action.Command == nil && len(action.Data) == 0 {
			var command lsp.Command
			if json.Unmarshal(item, &command) != nil || command.Command == "" {
				continue
			}
			action.Command = &command
		}
		id := newID("action")
		state.codeActions[id] = action
		entry := CodeActionEntry{ID: id, Title: action.Title, Kind: action.Kind, Preferred: action.IsPreferred}
		if action.Disabled != nil {
			entry.Disabled = action.Disabled.Reason
		}
		entries = append(entries, entry)
	}
	state.mu.Unlock()
	return entries, nil
}

// ResolveCodeAction calcola le modifiche dell'azione come anteprima transazionale, senza scrivere file.
func (m *LSPManager) ResolveCodeAction(ctx context.Context, sessionID SessionID, actionID string) (WorkspaceChange, error) {
	state, process, err := m.readyProcess(sessionID)
	if err != nil {
		return WorkspaceChange{}, err
	}
	state.mu.Lock()
	action, ok := state.codeActions[actionID]
	delete(state.codeActions, actionID)
	state.mu.Unlock()
	if !ok {
		return WorkspaceChange{}, fmt.Errorf("azione non più disponibile: richiedila di nuovo")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*defaultRequestTimeout)
	defer cancel()
	if action.Edit == nil && len(action.Data) > 0 {
		var resolved lsp.CodeAction
		if err := process.conn.Call(ctx, "codeAction/resolve", action, &resolved); err != nil {
			return WorkspaceChange{}, err
		}
		action.Edit = resolved.Edit
		if resolved.Command != nil {
			action.Command = resolved.Command
		}
	}
	if action.Edit != nil {
		return m.workspaceChange(state, action.Title, *action.Edit)
	}
	if action.Command == nil {
		return WorkspaceChange{Label: action.Title, Files: []FileChange{}}, nil
	}
	return m.executeCommand(ctx, state, process, action.Title, *action.Command)
}

// executeCommand esegue un comando gopls e raccoglie gli workspace/applyEdit emessi durante l'esecuzione.
func (m *LSPManager) executeCommand(ctx context.Context, state *lspSession, process *serverProcess, label string, command lsp.Command) (WorkspaceChange, error) {
	state.mu.Lock()
	state.applyEdits = nil
	state.mu.Unlock()
	params := map[string]any{"command": command.Command, "arguments": command.Arguments}
	if err := process.conn.Call(ctx, "workspace/executeCommand", params, nil); err != nil {
		return WorkspaceChange{}, err
	}
	state.mu.Lock()
	collected := state.applyEdits
	state.applyEdits = nil
	state.mu.Unlock()
	merged := lsp.WorkspaceEdit{Changes: map[string][]lsp.TextEdit{}}
	for _, edit := range collected {
		changes, ok := edit.Normalize()
		if !ok {
			return WorkspaceChange{}, fmt.Errorf("l'azione richiede operazioni sui file non supportate")
		}
		for uri, edits := range changes {
			merged.Changes[uri] = append(merged.Changes[uri], edits...)
		}
	}
	return m.workspaceChange(state, label, merged)
}

func (m *LSPManager) overlappingDiagnostics(state *lspSession, uri string, requested lsp.Range) []lsp.Diagnostic {
	state.mu.Lock()
	defer state.mu.Unlock()
	result := []lsp.Diagnostic{}
	for _, diagnostic := range state.diagnostics[uri] {
		if diagnostic.Range.End.Line < requested.Start.Line || diagnostic.Range.Start.Line > requested.End.Line {
			continue
		}
		result = append(result, diagnostic)
	}
	return result
}

// workspaceChange applica in memoria gli edit a buffer sincronizzati o file su disco, confinati al progetto.
func (m *LSPManager) workspaceChange(state *lspSession, label string, edit lsp.WorkspaceEdit) (WorkspaceChange, error) {
	changes, ok := edit.Normalize()
	if !ok {
		return WorkspaceChange{}, fmt.Errorf("la modifica richiede operazioni sui file non supportate")
	}
	result := WorkspaceChange{Label: label, Files: make([]FileChange, 0, len(changes))}
	for uri, edits := range changes {
		path := pathFromURI(uri)
		relative := relativeWithin(state.root, path)
		if relative == "" {
			return WorkspaceChange{}, fmt.Errorf("modifica esterna al progetto rifiutata: %s", path)
		}
		text := m.documentText(state, uri, path)
		updated, err := lsp.ApplyEdits(text, edits)
		if err != nil {
			return WorkspaceChange{}, fmt.Errorf("%s: %w", relative, err)
		}
		state.mu.Lock()
		documentID := state.byURI[uri]
		state.mu.Unlock()
		result.Files = append(result.Files, FileChange{URI: uri, Path: path, RelativePath: relative, DocumentID: documentID, Edits: editorEdits(edits), NewContent: updated})
	}
	sort.Slice(result.Files, func(left, right int) bool { return result.Files[left].RelativePath < result.Files[right].RelativePath })
	return result, nil
}

// markupText estrae il testo da una documentazione LSP (stringa o MarkupContent).
func markupText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var markup lsp.MarkupContent
	if json.Unmarshal(raw, &markup) == nil {
		return markup.Value
	}
	return ""
}

// parameterLabel risolve l'etichetta del parametro, espressa come stringa o come offset UTF-16 nella firma.
func parameterLabel(signature string, raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var offsets [2]int
	if json.Unmarshal(raw, &offsets) != nil {
		return ""
	}
	units := utf16.Encode([]rune(signature))
	if offsets[0] < 0 || offsets[1] > len(units) || offsets[0] > offsets[1] {
		return ""
	}
	return string(utf16.Decode(units[offsets[0]:offsets[1]]))
}
