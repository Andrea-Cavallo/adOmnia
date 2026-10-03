package lsp

import "encoding/json"

// Position usa coordinate zero-based con colonne in unità di codice UTF-16, come da LSP.
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

type Location struct {
	URI   string `json:"uri"`
	Range Range  `json:"range"`
}

// LocationLink è la forma estesa che alcuni server restituiscono per definition.
type LocationLink struct {
	TargetURI            string `json:"targetUri"`
	TargetRange          Range  `json:"targetRange"`
	TargetSelectionRange Range  `json:"targetSelectionRange"`
}

type TextDocumentIdentifier struct {
	URI string `json:"uri"`
}

type TextDocumentItem struct {
	URI        string `json:"uri"`
	LanguageID string `json:"languageId"`
	Version    int    `json:"version"`
	Text       string `json:"text"`
}

type VersionedTextDocumentIdentifier struct {
	URI     string `json:"uri"`
	Version int    `json:"version"`
}

type TextDocumentPositionParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
}

type TextEdit struct {
	Range   Range  `json:"range"`
	NewText string `json:"newText"`
}

type TextDocumentEdit struct {
	TextDocument VersionedTextDocumentIdentifier `json:"textDocument"`
	Edits        []TextEdit                      `json:"edits"`
}

// WorkspaceEdit accetta sia la forma `changes` sia `documentChanges` (solo edit testuali).
type WorkspaceEdit struct {
	Changes         map[string][]TextEdit `json:"changes,omitempty"`
	DocumentChanges []json.RawMessage     `json:"documentChanges,omitempty"`
}

// Normalize unisce `changes` e `documentChanges` in una mappa URI → edit e restituisce i file da creare.
// Sono accettate solo creazioni di file nuovi (es. "Extract declarations to new file"):
// rename e delete di file sono rifiutati, come le creazioni che sovrascriverebbero.
func (w WorkspaceEdit) Normalize() (map[string][]TextEdit, []string, bool) {
	result := make(map[string][]TextEdit, len(w.Changes))
	for uri, edits := range w.Changes {
		result[uri] = append(result[uri], edits...)
	}
	var created []string
	for _, raw := range w.DocumentChanges {
		var operation struct {
			Kind    string `json:"kind"`
			URI     string `json:"uri"`
			Options struct {
				Overwrite bool `json:"overwrite"`
			} `json:"options"`
		}
		if json.Unmarshal(raw, &operation) == nil && operation.Kind != "" {
			if operation.Kind != "create" || operation.URI == "" || operation.Options.Overwrite {
				return nil, nil, false
			}
			created = append(created, operation.URI)
			if _, ok := result[operation.URI]; !ok {
				result[operation.URI] = nil
			}
			continue
		}
		var edit TextDocumentEdit
		if err := json.Unmarshal(raw, &edit); err != nil {
			return nil, nil, false
		}
		result[edit.TextDocument.URI] = append(result[edit.TextDocument.URI], edit.Edits...)
	}
	return result, created, true
}

type Diagnostic struct {
	Range    Range           `json:"range"`
	Severity int             `json:"severity,omitempty"`
	Code     json.RawMessage `json:"code,omitempty"`
	Source   string          `json:"source,omitempty"`
	Message  string          `json:"message"`
}

type PublishDiagnosticsParams struct {
	URI         string       `json:"uri"`
	Version     *int         `json:"version,omitempty"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

type MarkupContent struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type Hover struct {
	Contents MarkupContent `json:"contents"`
	Range    *Range        `json:"range,omitempty"`
}

type Command struct {
	Title     string            `json:"title"`
	Command   string            `json:"command"`
	Arguments []json.RawMessage `json:"arguments,omitempty"`
}

type CompletionItem struct {
	Label               string          `json:"label"`
	Kind                int             `json:"kind,omitempty"`
	Detail              string          `json:"detail,omitempty"`
	Documentation       json.RawMessage `json:"documentation,omitempty"`
	SortText            string          `json:"sortText,omitempty"`
	FilterText          string          `json:"filterText,omitempty"`
	InsertText          string          `json:"insertText,omitempty"`
	InsertTextFormat    int             `json:"insertTextFormat,omitempty"`
	TextEdit            *TextEdit       `json:"textEdit,omitempty"`
	AdditionalTextEdits []TextEdit      `json:"additionalTextEdits,omitempty"`
	Preselect           bool            `json:"preselect,omitempty"`
	Deprecated          bool            `json:"deprecated,omitempty"`
	Tags                []int           `json:"tags,omitempty"`
}

type CompletionList struct {
	IsIncomplete bool             `json:"isIncomplete"`
	Items        []CompletionItem `json:"items"`
}

type ParameterInformation struct {
	Label         json.RawMessage `json:"label"`
	Documentation json.RawMessage `json:"documentation,omitempty"`
}

type SignatureInformation struct {
	Label           string                 `json:"label"`
	Documentation   json.RawMessage        `json:"documentation,omitempty"`
	Parameters      []ParameterInformation `json:"parameters,omitempty"`
	ActiveParameter *int                   `json:"activeParameter,omitempty"`
}

type SignatureHelp struct {
	Signatures      []SignatureInformation `json:"signatures"`
	ActiveSignature int                    `json:"activeSignature"`
	ActiveParameter int                    `json:"activeParameter"`
}

type DocumentSymbol struct {
	Name           string           `json:"name"`
	Detail         string           `json:"detail,omitempty"`
	Kind           int              `json:"kind"`
	Range          Range            `json:"range"`
	SelectionRange Range            `json:"selectionRange"`
	Children       []DocumentSymbol `json:"children,omitempty"`
}

type SymbolInformation struct {
	Name          string   `json:"name"`
	Kind          int      `json:"kind"`
	Location      Location `json:"location"`
	ContainerName string   `json:"containerName,omitempty"`
}

type CodeAction struct {
	Title       string                   `json:"title"`
	Kind        string                   `json:"kind,omitempty"`
	Diagnostics []Diagnostic             `json:"diagnostics,omitempty"`
	IsPreferred bool                     `json:"isPreferred,omitempty"`
	Disabled    *struct{ Reason string } `json:"disabled,omitempty"`
	Edit        *WorkspaceEdit           `json:"edit,omitempty"`
	Command     *Command                 `json:"command,omitempty"`
	Data        json.RawMessage          `json:"data,omitempty"`
}

type PrepareRenameResult struct {
	Range       Range  `json:"range"`
	Placeholder string `json:"placeholder"`
}

type ApplyWorkspaceEditParams struct {
	Label string        `json:"label,omitempty"`
	Edit  WorkspaceEdit `json:"edit"`
}
