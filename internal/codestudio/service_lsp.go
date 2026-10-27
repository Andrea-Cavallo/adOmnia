package codestudio

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/activity"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/langserver"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

// StartLanguageServer avvia gopls per un progetto autorizzato, usando l'SDK Go selezionato per la sessione.
func (s *Service) StartLanguageServer(sessionID string, settings LanguageServerSettings) (LanguageServerStatus, error) {
	session, options, err := s.languageServerOptions(sessionID, settings)
	if err != nil {
		return s.lsp.Status(SessionID(sessionID), golang.ID), err
	}
	return s.lsp.Start(session, options)
}

// RestartLanguageServer riavvia gopls azzerando il contatore dei crash.
func (s *Service) RestartLanguageServer(sessionID string, settings LanguageServerSettings) (LanguageServerStatus, error) {
	session, options, err := s.languageServerOptions(sessionID, settings)
	if err != nil {
		return s.lsp.Status(SessionID(sessionID), golang.ID), err
	}
	return s.lsp.Restart(session, options)
}

// StopLanguageServer arresta gopls della sessione senza toccare documenti o processi Run.
func (s *Service) StopLanguageServer(sessionID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	s.lsp.Stop(SessionID(sessionID), golang.ID)
	return nil
}

// LanguageServerStatus restituisce lo stato di gopls per la sessione.
func (s *Service) LanguageServerStatus(sessionID string) (LanguageServerStatus, error) {
	if _, err := s.session(sessionID); err != nil {
		return LanguageServerStatus{}, err
	}
	return s.lsp.Status(SessionID(sessionID), golang.ID), nil
}

// LanguageServerLog restituisce le ultime righe di log gopls della sessione.
func (s *Service) LanguageServerLog(sessionID string) ([]string, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	return s.lsp.Log(SessionID(sessionID), golang.ID), nil
}

func (s *Service) languageServerOptions(sessionID string, settings LanguageServerSettings) (Session, LanguageServerOptions, error) {
	if settings.MemoryLimitMiB != 0 && (settings.MemoryLimitMiB < 128 || settings.MemoryLimitMiB > 65536) {
		return Session{}, LanguageServerOptions{}, fmt.Errorf("gopls memory limit must be 0 (default) or 128–65536 MiB")
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Session{}, LanguageServerOptions{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Session{}, LanguageServerOptions{}, fmt.Errorf("explicitly authorize the tools before starting gopls")
	}
	gopls, err := s.DetectGopls(sessionID)
	if err != nil {
		return Session{}, LanguageServerOptions{}, err
	}
	if !gopls.Available {
		return Session{}, LanguageServerOptions{}, errors.New(gopls.Error)
	}
	environment, err := s.languageServerEnvironment(session.ID)
	if err != nil {
		return Session{}, LanguageServerOptions{}, err
	}
	return session, golang.GoplsServerSpec(gopls, environment, settings), nil
}

// UpdateDocumentBuffer sincronizza con gopls il buffer non salvato; una versione obsoleta viene ignorata.
func (s *Service) UpdateDocumentBuffer(sessionID, documentID string, version int, text string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	s.observeDocuments(func(observer DocumentObserver) { observer.DocumentChanged(DocumentID(documentID), version, text) })
	err := s.lsp.UpdateDocument(SessionID(sessionID), DocumentID(documentID), version, text)
	if errors.Is(err, ErrStaleDocumentVersion) {
		return nil
	}
	return err
}

// OpenExternalDocument apre in sola lettura un sorgente dell'SDK Go, della module cache o di una
// replace locale del progetto: il codice delle dipendenze si legge ma non si modifica da qui.
func (s *Service) OpenExternalDocument(sessionID, path string) (OpenDocument, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return OpenDocument{}, err
	}
	// Le sorgenti delle librerie Java (jdt://) sono salvate sotto virtualDocumentsRoot; quelle Go stanno in GOROOT/GOMODCACHE.
	roots := append([]string{langserver.VirtualDocumentsRoot()}, localDependencyRoots(session.Project)...)
	info, detected := s.toolchain.LastDetected(session.ID)
	if detected {
		roots = append(roots, info.GOROOT, info.GOMODCACHE)
	} else if !strings.HasPrefix(filepath.Clean(path), langserver.VirtualDocumentsRoot()) {
		return OpenDocument{}, fmt.Errorf("detect the Go SDK to browse its sources")
	}
	document, err := s.documents.OpenExternalDocument(session, path, roots)
	if err != nil {
		return OpenDocument{}, err
	}
	s.lsp.TrackDocument(session, document.Document, document.Content, true)
	return document, nil
}

// Completion restituisce i suggerimenti per la posizione Monaco indicata.
func (s *Service) Completion(ctx context.Context, sessionID, documentID string, line, column int) (CompletionResult, error) {
	return s.lsp.Completion(ctx, SessionID(sessionID), DocumentID(documentID), line, column)
}

// Hover restituisce la documentazione del simbolo sotto il cursore.
func (s *Service) Hover(ctx context.Context, sessionID, documentID string, line, column int) (HoverResult, error) {
	return s.lsp.Hover(ctx, SessionID(sessionID), DocumentID(documentID), line, column)
}

// SignatureHelp restituisce la firma della chiamata in corso.
func (s *Service) SignatureHelp(ctx context.Context, sessionID, documentID string, line, column int) (SignatureResult, error) {
	return s.lsp.SignatureHelp(ctx, SessionID(sessionID), DocumentID(documentID), line, column)
}

// Locations esegue definition, typeDefinition, implementation o references.
func (s *Service) Locations(ctx context.Context, sessionID, documentID, kind string, line, column int) ([]EditorLocation, error) {
	return s.lsp.Locations(ctx, SessionID(sessionID), DocumentID(documentID), kind, line, column)
}

// DocumentSymbols restituisce la struttura del file e la versione a cui si riferisce.
func (s *Service) DocumentSymbols(ctx context.Context, sessionID, documentID string) (DocumentSymbolsResult, error) {
	symbols, version, err := s.lsp.DocumentSymbols(ctx, SessionID(sessionID), DocumentID(documentID))
	return DocumentSymbolsResult{Version: version, Symbols: symbols}, err
}

// WorkspaceSymbols cerca simboli nel workspace della sessione.
func (s *Service) WorkspaceSymbols(ctx context.Context, sessionID, query string) ([]WorkspaceSymbol, error) {
	return s.lsp.WorkspaceSymbols(ctx, SessionID(sessionID), query)
}

// PrepareRename verifica il simbolo da rinominare.
func (s *Service) PrepareRename(ctx context.Context, sessionID, documentID string, line, column int) (RenameTarget, error) {
	return s.lsp.PrepareRename(ctx, SessionID(sessionID), DocumentID(documentID), line, column)
}

// Rename calcola l'anteprima del rename semantico senza scrivere file.
func (s *Service) Rename(ctx context.Context, sessionID, documentID string, line, column int, newName string) (WorkspaceChange, error) {
	return s.lsp.Rename(ctx, SessionID(sessionID), DocumentID(documentID), line, column, newName)
}

// FormatDocument restituisce gli edit di formattazione del buffer corrente. Se il language server
// non offre la formattazione (basedpyright), usa lo strumento dichiarato dall'adapter (Ruff per
// Python) sullo stesso buffer: un solo percorso per l'azione manuale e il format-on-save.
func (s *Service) FormatDocument(ctx context.Context, sessionID, documentID string) (FormatResult, error) {
	edits, version, err := s.lsp.Format(ctx, SessionID(sessionID), DocumentID(documentID))
	if err == nil && len(edits) > 0 {
		return FormatResult{Version: version, Edits: edits}, nil
	}
	if fallback, fallbackErr := s.formatWithLanguageTool(ctx, sessionID, documentID); fallbackErr == nil {
		return fallback, nil
	}
	return FormatResult{Version: version, Edits: edits}, err
}

// CodeActions elenca le azioni disponibili per l'intervallo selezionato.
func (s *Service) CodeActions(ctx context.Context, sessionID, documentID string, selection EditorRange, only []string) ([]CodeActionEntry, error) {
	return s.lsp.CodeActions(ctx, SessionID(sessionID), DocumentID(documentID), selection, only)
}

// ChangeSignature calcola la modifica di firma e chiamate (anteprima, niente viene scritto).
func (s *Service) ChangeSignature(ctx context.Context, sessionID, documentID string, caret EditorRange, params, results []int) (WorkspaceChange, error) {
	return s.lsp.ChangeSignature(ctx, SessionID(sessionID), DocumentID(documentID), caret, params, results)
}

// ResolveCodeAction calcola l'anteprima delle modifiche dell'azione scelta.
func (s *Service) ResolveCodeAction(ctx context.Context, sessionID, actionID string) (WorkspaceChange, error) {
	return s.lsp.ResolveCodeAction(ctx, SessionID(sessionID), actionID)
}

// OrganizeImports calcola l'ordinamento e la pulizia degli import del file.
func (s *Service) OrganizeImports(ctx context.Context, sessionID, documentID string) (WorkspaceChange, error) {
	actions, err := s.lsp.CodeActions(ctx, SessionID(sessionID), DocumentID(documentID), EditorRange{StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 1}, []string{"source.organizeImports"})
	if err != nil {
		return WorkspaceChange{}, err
	}
	if len(actions) == 0 {
		return WorkspaceChange{Label: "Organize imports", Files: []FileChange{}}, nil
	}
	return s.lsp.ResolveCodeAction(ctx, SessionID(sessionID), actions[0].ID)
}

// SemanticTokens restituisce i token semantici del buffer, da decodificare con la legenda in LanguageServerStatus.Features.
func (s *Service) SemanticTokens(ctx context.Context, sessionID, documentID string) (SemanticTokensResult, error) {
	return s.lsp.SemanticTokens(ctx, SessionID(sessionID), DocumentID(documentID))
}

// InlayHints restituisce i suggerimenti in linea per l'intervallo visibile dell'editor.
func (s *Service) InlayHints(ctx context.Context, sessionID, documentID string, visible EditorRange) (InlayHintsResult, error) {
	return s.lsp.InlayHints(ctx, SessionID(sessionID), DocumentID(documentID), visible)
}

// DocumentHighlights evidenzia le occorrenze del simbolo al cursore e i punti di uscita di una funzione.
func (s *Service) DocumentHighlights(ctx context.Context, sessionID, documentID string, line, column int) (HighlightsResult, error) {
	return s.lsp.DocumentHighlights(ctx, SessionID(sessionID), DocumentID(documentID), line, column)
}

// RecursiveCalls restituisce le chiamate ricorsive dirette del file, da marcare nel gutter.
func (s *Service) RecursiveCalls(ctx context.Context, sessionID, documentID string) (RecursiveCallsResult, error) {
	return s.lsp.RecursiveCalls(ctx, SessionID(sessionID), DocumentID(documentID))
}

// PrepareHierarchy apre Call Hierarchy (kind "call") o Type Hierarchy (kind "type") sul simbolo al cursore.
func (s *Service) PrepareHierarchy(ctx context.Context, sessionID, documentID, kind string, line, column int) ([]HierarchyItem, error) {
	return s.lsp.PrepareHierarchy(ctx, SessionID(sessionID), DocumentID(documentID), kind, line, column)
}

// ExpandHierarchy carica chiamanti/chiamati o supertipi/sottotipi di un nodo.
func (s *Service) ExpandHierarchy(ctx context.Context, sessionID, direction, token string) ([]HierarchyItem, error) {
	return s.lsp.ExpandHierarchy(ctx, SessionID(sessionID), direction, token)
}

// QuickDefinition restituisce il sorgente della dichiarazione del simbolo al cursore, per il popup Quick Definition.
func (s *Service) QuickDefinition(ctx context.Context, sessionID, documentID string, line, column int) (QuickDefinitionResult, error) {
	return s.lsp.QuickDefinition(ctx, SessionID(sessionID), DocumentID(documentID), line, column)
}

// Public user actions pin a server; automatic editor starts use the existing
// lifecycle entry points and never remove an explicit pin.
func (s *Service) StartLanguageServerFromUser(sessionID string, settings LanguageServerSettings) (LanguageServerStatus, error) {
	if err := s.ProtectLanguageServer(sessionID, golang.ID); err != nil {
		return LanguageServerStatus{}, err
	}
	return s.StartLanguageServer(sessionID, settings)
}
func (s *Service) RestartLanguageServerFromUser(sessionID string, settings LanguageServerSettings) (LanguageServerStatus, error) {
	if err := s.ProtectLanguageServer(sessionID, golang.ID); err != nil {
		return LanguageServerStatus{}, err
	}
	return s.RestartLanguageServer(sessionID, settings)
}

func (s *Service) HierarchyPreview(sessionID, token string) (QuickDefinitionResult, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return QuickDefinitionResult{}, err
	}
	uri, err := langserver.HierarchyTokenURI(token)
	if err != nil {
		return QuickDefinitionResult{}, err
	}
	path, err := filepath.EvalSymlinks(langserver.PathFromURI(uri))
	if err != nil {
		return QuickDefinitionResult{}, fmt.Errorf("could not resolve hierarchy source: %w", err)
	}
	roots := append([]string{session.Project.RootPath, langserver.VirtualDocumentsRoot()}, localDependencyRoots(session.Project)...)
	if info, ok := s.toolchain.LastDetected(session.ID); ok {
		roots = append(roots, info.GOROOT, info.GOMODCACHE)
	}
	if !withinAnyRoot(path, roots) {
		return QuickDefinitionResult{}, fmt.Errorf("hierarchy source is outside the permitted source roots")
	}
	return s.lsp.HierarchyPreview(SessionID(sessionID), token)
}

// EnableMemoryBudget is called by the desktop composition root before sessions
// start. The controller samples only while at least one server is running.
func (s *Service) EnableMemoryBudget(target uint64) { s.lsp.EnableMemoryBudget(target) }

// SetActivityManager is called by the desktop composition root before starting sessions.
func (s *Service) SetActivityManager(manager *activity.Manager) {
	if manager != nil {
		s.lsp.SetActivityManager(manager)
	}
}

// ProtectLanguageServer records explicit user intent without launching a process.
// The pin survives automatic restarts and is cleared by an explicit stop/close.
func (s *Service) ProtectLanguageServer(sessionID, languageID string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return s.lsp.Protect(session, languageID)
}

// ImplementationMarkers calcola in un solo passaggio i marcatori del gutter del documento (icone I↑ e I↓).
func (s *Service) ImplementationMarkers(ctx context.Context, sessionID, documentID string) ([]ImplementationMarker, error) {
	relativePath := ""
	var semantics language.ImplementationMarkers
	if document, ok := s.documents.Get(SessionID(sessionID), DocumentID(documentID)); ok {
		relativePath = document.RelativePath
		if adapter, ok := s.workspace.languages.Get(document.Language); ok {
			semantics, _ = adapter.(language.ImplementationMarkers)
		}
	}
	return s.lsp.ImplementationMarkers(ctx, SessionID(sessionID), DocumentID(documentID), relativePath, semantics)
}
