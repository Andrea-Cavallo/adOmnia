package goide

import (
	"context"
	"encoding/json"
	"fmt"

	"adomnia/internal/goide/lsp"
)

const maxRecursionProbes = 300

// semanticTokenTypes e semanticTokenModifiers sono la legenda dichiarata dal client: gopls risponde con indici su quella che annuncia lui.
var (
	semanticTokenTypes = []string{
		"namespace", "type", "class", "enum", "interface", "struct", "typeParameter", "parameter", "variable", "property",
		"enumMember", "event", "function", "method", "macro", "keyword", "modifier", "comment", "string", "number", "regexp", "operator", "label",
	}
	semanticTokenModifiers = []string{
		"declaration", "definition", "readonly", "static", "deprecated", "abstract", "async", "modification", "documentation", "defaultLibrary",
		"format", "interface", "number", "struct", "signature", "pointer", "array", "map", "slice", "chan", "string", "bool", "invalid",
	}
)

type initializeResult struct {
	Capabilities serverCapabilities `json:"capabilities"`
}

type serverCapabilities struct {
	SemanticTokensProvider *struct {
		Legend struct {
			TokenTypes     []string `json:"tokenTypes"`
			TokenModifiers []string `json:"tokenModifiers"`
		} `json:"legend"`
		Full json.RawMessage `json:"full"`
	} `json:"semanticTokensProvider"`
	InlayHintProvider         json.RawMessage `json:"inlayHintProvider"`
	DocumentHighlightProvider json.RawMessage `json:"documentHighlightProvider"`
	CallHierarchyProvider     json.RawMessage `json:"callHierarchyProvider"`
}

// providerEnabled interpreta un provider LSP che può essere booleano o un oggetto di opzioni.
func providerEnabled(raw json.RawMessage) bool {
	return len(raw) > 0 && string(raw) != "false" && string(raw) != "null"
}

func (c serverCapabilities) features() LanguageServerFeatures {
	features := LanguageServerFeatures{
		InlayHints:        providerEnabled(c.InlayHintProvider),
		DocumentHighlight: providerEnabled(c.DocumentHighlightProvider),
		CallHierarchy:     providerEnabled(c.CallHierarchyProvider),
		TokenTypes:        []string{},
		TokenModifiers:    []string{},
	}
	if provider := c.SemanticTokensProvider; provider != nil && providerEnabled(provider.Full) && len(provider.Legend.TokenTypes) > 0 {
		features.SemanticTokens = true
		features.TokenTypes = provider.Legend.TokenTypes
		features.TokenModifiers = provider.Legend.TokenModifiers
	}
	return features
}

func documentParams(document trackedDocument) map[string]any {
	return map[string]any{"textDocument": lsp.TextDocumentIdentifier{URI: document.uri}}
}

// SemanticTokens restituisce i token semantici dell'intero buffer, codificati come da LSP (relativi).
func (m *LSPManager) SemanticTokens(ctx context.Context, sessionID SessionID, documentID DocumentID) (SemanticTokensResult, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return SemanticTokensResult{}, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var tokens *struct {
		Data []uint32 `json:"data"`
	}
	if err := process.conn.Call(ctx, "textDocument/semanticTokens/full", documentParams(document), &tokens); err != nil {
		return SemanticTokensResult{}, err
	}
	result := SemanticTokensResult{Version: document.version, Data: []uint32{}}
	if tokens != nil {
		result.Data = tokens.Data
	}
	return result, nil
}

// InlayHints restituisce i suggerimenti in linea (nomi dei parametri, type parameter dedotti) per un intervallo.
func (m *LSPManager) InlayHints(ctx context.Context, sessionID SessionID, documentID DocumentID, visible EditorRange) (InlayHintsResult, error) {
	if err := validateEditorRange(visible); err != nil {
		return InlayHintsResult{}, err
	}
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return InlayHintsResult{}, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	params := documentParams(document)
	params["range"] = lsp.Range{Start: lspPosition(visible.StartLine, visible.StartColumn), End: lspPosition(visible.EndLine, visible.EndColumn)}
	var hints []struct {
		Position     lsp.Position    `json:"position"`
		Label        json.RawMessage `json:"label"`
		Kind         int             `json:"kind"`
		PaddingLeft  bool            `json:"paddingLeft"`
		PaddingRight bool            `json:"paddingRight"`
	}
	if err := process.conn.Call(ctx, "textDocument/inlayHint", params, &hints); err != nil {
		return InlayHintsResult{}, err
	}
	result := InlayHintsResult{Version: document.version, Hints: make([]InlayHintEntry, 0, len(hints))}
	for _, hint := range hints {
		result.Hints = append(result.Hints, InlayHintEntry{
			Line: hint.Position.Line + 1, Column: hint.Position.Character + 1, Label: inlayLabel(hint.Label),
			Kind: hint.Kind, PaddingLeft: hint.PaddingLeft, PaddingRight: hint.PaddingRight,
		})
	}
	return result, nil
}

// inlayLabel accetta sia la stringa sia la forma a parti (InlayHintLabelPart[]).
func inlayLabel(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var parts []struct {
		Value string `json:"value"`
	}
	_ = json.Unmarshal(raw, &parts)
	for _, part := range parts {
		text += part.Value
	}
	return text
}

// DocumentHighlights evidenzia le occorrenze del simbolo al cursore; su func/return gopls restituisce i punti di uscita.
func (m *LSPManager) DocumentHighlights(ctx context.Context, sessionID SessionID, documentID DocumentID, line, column int) (HighlightsResult, error) {
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return HighlightsResult{}, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var highlights []struct {
		Range lsp.Range `json:"range"`
		Kind  int       `json:"kind"`
	}
	if err := process.conn.Call(ctx, "textDocument/documentHighlight", positionParams(document, line, column), &highlights); err != nil {
		return HighlightsResult{}, err
	}
	result := HighlightsResult{Version: document.version, Highlights: make([]HighlightEntry, 0, len(highlights))}
	for _, highlight := range highlights {
		result.Highlights = append(result.Highlights, HighlightEntry{Range: editorRange(highlight.Range), Kind: highlightKind(highlight.Kind)})
	}
	return result, nil
}

func highlightKind(kind int) string {
	switch kind {
	case 2:
		return "read"
	case 3:
		return "write"
	default:
		return "text"
	}
}

type callHierarchyItem struct {
	Name           string          `json:"name"`
	Kind           int             `json:"kind"`
	URI            string          `json:"uri"`
	Range          lsp.Range       `json:"range"`
	SelectionRange lsp.Range       `json:"selectionRange"`
	Data           json.RawMessage `json:"data,omitempty"`
}

func sameCallable(left, right callHierarchyItem) bool {
	return left.URI == right.URI && left.SelectionRange == right.SelectionRange
}

// RecursiveCalls trova le chiamate ricorsive dirette del file tramite call hierarchy di gopls, funzione per funzione.
func (m *LSPManager) RecursiveCalls(ctx context.Context, sessionID SessionID, documentID DocumentID) (RecursiveCallsResult, error) {
	symbols, version, err := m.DocumentSymbols(ctx, sessionID, documentID)
	if err != nil {
		return RecursiveCallsResult{}, err
	}
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return RecursiveCallsResult{}, err
	}
	result := RecursiveCallsResult{Version: version, Calls: []RecursiveCall{}}
	for index, symbol := range callableSymbols(symbols) {
		if index == maxRecursionProbes {
			break
		}
		if err := ctx.Err(); err != nil {
			return RecursiveCallsResult{}, err
		}
		calls, err := recursiveCallsOf(ctx, process, document, symbol)
		if err != nil {
			return RecursiveCallsResult{}, err
		}
		result.Calls = append(result.Calls, calls...)
	}
	return result, nil
}

func callableSymbols(nodes []SymbolNode) []SymbolNode {
	callables := make([]SymbolNode, 0, len(nodes))
	for _, node := range nodes {
		if node.Kind == lspSymbolFunction || node.Kind == lspSymbolMethod {
			callables = append(callables, node)
		}
		callables = append(callables, callableSymbols(node.Children)...)
	}
	return callables
}

const (
	lspSymbolMethod   = 6
	lspSymbolFunction = 12
)

func recursiveCallsOf(ctx context.Context, process *serverProcess, document trackedDocument, symbol SymbolNode) ([]RecursiveCall, error) {
	requestCtx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var items []callHierarchyItem
	if err := process.conn.Call(requestCtx, "textDocument/prepareCallHierarchy", positionParams(document, symbol.SelectionRange.StartLine, symbol.SelectionRange.StartColumn), &items); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	var outgoing []struct {
		To         callHierarchyItem `json:"to"`
		FromRanges []lsp.Range       `json:"fromRanges"`
	}
	if err := process.conn.Call(requestCtx, "callHierarchy/outgoingCalls", map[string]any{"item": items[0]}, &outgoing); err != nil {
		return nil, err
	}
	calls := []RecursiveCall{}
	for _, call := range outgoing {
		if !sameCallable(call.To, items[0]) {
			continue
		}
		for _, from := range call.FromRanges {
			calls = append(calls, RecursiveCall{Function: symbol.Name, Range: editorRange(from)})
		}
	}
	return calls, nil
}

// validateEditorRange rifiuta intervalli invertiti prima di inoltrarli a gopls.
func validateEditorRange(value EditorRange) error {
	if value.StartLine < 1 || value.EndLine < value.StartLine {
		return fmt.Errorf("intervallo non valido")
	}
	return nil
}
