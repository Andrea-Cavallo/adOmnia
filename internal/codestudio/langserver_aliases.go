package codestudio

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/langserver"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// Language server types live in internal/ide/langserver; the aliases keep the GoIDE bindings and callers unchanged.
type (
	CodeActionEntry        = langserver.CodeActionEntry
	CompletionEntry        = langserver.CompletionEntry
	CompletionResult       = langserver.CompletionResult
	DiagnosticFix          = langserver.DiagnosticFix
	DiagnosticsReport      = langserver.DiagnosticsReport
	DocumentSymbolsResult  = langserver.DocumentSymbolsResult
	EditorDiagnostic       = langserver.EditorDiagnostic
	EditorLocation         = langserver.EditorLocation
	EditorRange            = langserver.EditorRange
	EditorTextEdit         = langserver.EditorTextEdit
	FileChange             = langserver.FileChange
	FormatResult           = langserver.FormatResult
	HierarchyItem          = langserver.HierarchyItem
	HighlightEntry         = langserver.HighlightEntry
	HighlightsResult       = langserver.HighlightsResult
	HoverResult            = langserver.HoverResult
	ImplementationMarker   = langserver.ImplementationMarker
	InlayHintEntry         = langserver.InlayHintEntry
	InlayHintsResult       = langserver.InlayHintsResult
	LanguageServerFeatures = langserver.LanguageServerFeatures
	LanguageServerMessage  = langserver.LanguageServerMessage
	LanguageServerOptions  = langserver.LanguageServerOptions
	LanguageServerProgress = langserver.LanguageServerProgress
	LanguageServerState    = langserver.LanguageServerState
	LanguageServerStatus   = langserver.LanguageServerStatus
	LSPManager             = langserver.LSPManager
	QuickDefinitionResult  = langserver.QuickDefinitionResult
	RecursiveCall          = langserver.RecursiveCall
	RecursiveCallsResult   = langserver.RecursiveCallsResult
	RenameTarget           = langserver.RenameTarget
	SemanticTokensResult   = langserver.SemanticTokensResult
	SignatureEntry         = langserver.SignatureEntry
	SignatureParameter     = langserver.SignatureParameter
	SignatureResult        = langserver.SignatureResult
	SymbolNode             = langserver.SymbolNode
	WorkspaceChange        = langserver.WorkspaceChange
	WorkspaceSymbol        = langserver.WorkspaceSymbol
)

const (
	LanguageServerStopped     = langserver.LanguageServerStopped
	LanguageServerStarting    = langserver.LanguageServerStarting
	LanguageServerReady       = langserver.LanguageServerReady
	LanguageServerCrashed     = langserver.LanguageServerCrashed
	LanguageServerUnavailable = langserver.LanguageServerUnavailable
	MaxPendingLSPRequests     = langserver.MaxPendingLSPRequests
)

var ErrStaleDocumentVersion = langserver.ErrStaleDocumentVersion

func NewLSPManager(languages *language.Registry) *LSPManager {
	return langserver.NewLSPManager(languages)
}
func relativeWithin(root, path string) string { return project.RelativeWithin(root, path) }
