package goide

// I tipi seguenti usano coordinate Monaco: righe e colonne 1-based, colonne in unità UTF-16.

type LanguageServerState string

const (
	LanguageServerStopped     LanguageServerState = "stopped"
	LanguageServerStarting    LanguageServerState = "starting"
	LanguageServerReady       LanguageServerState = "ready"
	LanguageServerCrashed     LanguageServerState = "crashed"
	LanguageServerUnavailable LanguageServerState = "unavailable"
)

type LanguageServerStatus struct {
	SessionID SessionID           `json:"sessionId"`
	State     LanguageServerState `json:"state"`
	Binary    string              `json:"binary,omitempty"`
	Version   string              `json:"version,omitempty"`
	PID       int                 `json:"pid,omitempty"`
	Restarts  int                 `json:"restarts"`
	Error     string              `json:"error,omitempty"`
	// Features elenca ciò che il gopls in esecuzione supporta davvero: l'editor nasconde il resto.
	Features *LanguageServerFeatures `json:"features,omitempty"`
}

// LanguageServerFeatures descrive le funzioni opzionali annunciate da gopls all'avvio.
type LanguageServerFeatures struct {
	SemanticTokens    bool     `json:"semanticTokens"`
	TokenTypes        []string `json:"tokenTypes"`
	TokenModifiers    []string `json:"tokenModifiers"`
	InlayHints        bool     `json:"inlayHints"`
	DocumentHighlight bool     `json:"documentHighlight"`
	CallHierarchy     bool     `json:"callHierarchy"`
}

type GoplsInfo struct {
	Available  bool   `json:"available"`
	Binary     string `json:"binary,omitempty"`
	Version    string `json:"version,omitempty"`
	Source     string `json:"source,omitempty"`
	ManagedDir string `json:"managedDir,omitempty"`
	Error      string `json:"error,omitempty"`
}

type LanguageServerSettings struct {
	Gofumpt       bool `json:"gofumpt"`
	Staticcheck   bool `json:"staticcheck"`
	Placeholders  bool `json:"placeholders"`
	SemanticLinks bool `json:"semanticLinks"`
}

type EditorRange struct {
	StartLine   int `json:"startLine"`
	StartColumn int `json:"startColumn"`
	EndLine     int `json:"endLine"`
	EndColumn   int `json:"endColumn"`
}

type EditorTextEdit struct {
	Range EditorRange `json:"range"`
	Text  string      `json:"text"`
}

type EditorLocation struct {
	URI          string      `json:"uri"`
	Path         string      `json:"path"`
	RelativePath string      `json:"relativePath,omitempty"`
	External     bool        `json:"external"`
	Range        EditorRange `json:"range"`
	Preview      string      `json:"preview,omitempty"`
	// Usage vale declaration, read, write o import per i risultati di Find Usages.
	Usage string `json:"usage,omitempty"`
}

type EditorDiagnostic struct {
	Range    EditorRange `json:"range"`
	Severity int         `json:"severity"`
	Message  string      `json:"message"`
	Source   string      `json:"source,omitempty"`
	Code     string      `json:"code,omitempty"`
}

type DiagnosticsReport struct {
	URI          string             `json:"uri"`
	Path         string             `json:"path"`
	RelativePath string             `json:"relativePath,omitempty"`
	DocumentID   DocumentID         `json:"documentId,omitempty"`
	Diagnostics  []EditorDiagnostic `json:"diagnostics"`
}

type CompletionEntry struct {
	Label           string           `json:"label"`
	Kind            int              `json:"kind"`
	Detail          string           `json:"detail,omitempty"`
	Documentation   string           `json:"documentation,omitempty"`
	SortText        string           `json:"sortText,omitempty"`
	FilterText      string           `json:"filterText,omitempty"`
	InsertText      string           `json:"insertText"`
	Snippet         bool             `json:"snippet"`
	Range           *EditorRange     `json:"range,omitempty"`
	AdditionalEdits []EditorTextEdit `json:"additionalEdits,omitempty"`
	Preselect       bool             `json:"preselect,omitempty"`
	Deprecated      bool             `json:"deprecated,omitempty"`
}

type CompletionResult struct {
	Version    int               `json:"version"`
	Incomplete bool              `json:"incomplete"`
	Items      []CompletionEntry `json:"items"`
}

type HoverResult struct {
	Version  int          `json:"version"`
	Markdown string       `json:"markdown"`
	Range    *EditorRange `json:"range,omitempty"`
}

type SignatureParameter struct {
	Label         string `json:"label"`
	Documentation string `json:"documentation,omitempty"`
}

type SignatureEntry struct {
	Label         string               `json:"label"`
	Documentation string               `json:"documentation,omitempty"`
	Parameters    []SignatureParameter `json:"parameters"`
}

type SignatureResult struct {
	Version         int              `json:"version"`
	Signatures      []SignatureEntry `json:"signatures"`
	ActiveSignature int              `json:"activeSignature"`
	ActiveParameter int              `json:"activeParameter"`
}

type SymbolNode struct {
	Name           string       `json:"name"`
	Detail         string       `json:"detail,omitempty"`
	Kind           int          `json:"kind"`
	Range          EditorRange  `json:"range"`
	SelectionRange EditorRange  `json:"selectionRange"`
	Children       []SymbolNode `json:"children,omitempty"`
}

type WorkspaceSymbol struct {
	Name      string         `json:"name"`
	Kind      int            `json:"kind"`
	Container string         `json:"container,omitempty"`
	Location  EditorLocation `json:"location"`
}

type FileChange struct {
	URI          string           `json:"uri"`
	Path         string           `json:"path"`
	RelativePath string           `json:"relativePath"`
	DocumentID   DocumentID       `json:"documentId,omitempty"`
	Edits        []EditorTextEdit `json:"edits"`
	NewContent   string           `json:"newContent"`
}

type WorkspaceChange struct {
	Label string       `json:"label,omitempty"`
	Files []FileChange `json:"files"`
}

type CodeActionEntry struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Kind      string `json:"kind,omitempty"`
	Preferred bool   `json:"preferred,omitempty"`
	Disabled  string `json:"disabled,omitempty"`
}

type RenameTarget struct {
	Version     int         `json:"version"`
	Range       EditorRange `json:"range"`
	Placeholder string      `json:"placeholder"`
}

type LanguageServerProgress struct {
	Token      string `json:"token"`
	Kind       string `json:"kind"`
	Title      string `json:"title,omitempty"`
	Message    string `json:"message,omitempty"`
	Percentage *int   `json:"percentage,omitempty"`
}

type LanguageServerMessage struct {
	Type    int    `json:"type"`
	Message string `json:"message"`
}

type DocumentSymbolsResult struct {
	Version int          `json:"version"`
	Symbols []SymbolNode `json:"symbols"`
}

type FormatResult struct {
	Version int              `json:"version"`
	Edits   []EditorTextEdit `json:"edits"`
}

type SemanticTokensResult struct {
	Version int      `json:"version"`
	Data    []uint32 `json:"data"`
}

type InlayHintEntry struct {
	Line         int    `json:"line"`
	Column       int    `json:"column"`
	Label        string `json:"label"`
	Kind         int    `json:"kind"`
	PaddingLeft  bool   `json:"paddingLeft"`
	PaddingRight bool   `json:"paddingRight"`
}

type InlayHintsResult struct {
	Version int              `json:"version"`
	Hints   []InlayHintEntry `json:"hints"`
}

type HighlightEntry struct {
	Range EditorRange `json:"range"`
	// Kind è text, read o write.
	Kind string `json:"kind"`
}

type HighlightsResult struct {
	Version    int              `json:"version"`
	Highlights []HighlightEntry `json:"highlights"`
}

type RecursiveCall struct {
	Function string      `json:"function"`
	Range    EditorRange `json:"range"`
}

type RecursiveCallsResult struct {
	Version int             `json:"version"`
	Calls   []RecursiveCall `json:"calls"`
}
