package goide

import (
	"context"
	"errors"
	"fmt"
)

// StartLanguageServer avvia gopls per un progetto autorizzato, usando l'SDK Go selezionato per la sessione.
func (s *Service) StartLanguageServer(sessionID string, settings LanguageServerSettings) (LanguageServerStatus, error) {
	session, options, err := s.languageServerOptions(sessionID, settings)
	if err != nil {
		return s.lsp.Status(SessionID(sessionID)), err
	}
	return s.lsp.Start(session, options)
}

// RestartLanguageServer riavvia gopls azzerando il contatore dei crash.
func (s *Service) RestartLanguageServer(sessionID string, settings LanguageServerSettings) (LanguageServerStatus, error) {
	session, options, err := s.languageServerOptions(sessionID, settings)
	if err != nil {
		return s.lsp.Status(SessionID(sessionID)), err
	}
	return s.lsp.Restart(session, options)
}

// StopLanguageServer arresta gopls della sessione senza toccare documenti o processi Run.
func (s *Service) StopLanguageServer(sessionID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	s.lsp.Stop(SessionID(sessionID))
	return nil
}

// LanguageServerStatus restituisce lo stato di gopls per la sessione.
func (s *Service) LanguageServerStatus(sessionID string) (LanguageServerStatus, error) {
	if _, err := s.session(sessionID); err != nil {
		return LanguageServerStatus{}, err
	}
	return s.lsp.Status(SessionID(sessionID)), nil
}

// LanguageServerLog restituisce le ultime righe di log gopls della sessione.
func (s *Service) LanguageServerLog(sessionID string) ([]string, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	return s.lsp.Log(SessionID(sessionID)), nil
}

func (s *Service) languageServerOptions(sessionID string, settings LanguageServerSettings) (Session, LanguageServerOptions, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Session{}, LanguageServerOptions{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Session{}, LanguageServerOptions{}, fmt.Errorf("autorizza esplicitamente gli strumenti prima di avviare gopls")
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
	return session, LanguageServerOptions{Binary: gopls.Binary, Version: gopls.Version, Environment: environment, Settings: settings}, nil
}

// UpdateDocumentBuffer sincronizza con gopls il buffer non salvato; una versione obsoleta viene ignorata.
func (s *Service) UpdateDocumentBuffer(sessionID, documentID string, version int, text string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	err := s.lsp.UpdateDocument(SessionID(sessionID), DocumentID(documentID), version, text)
	if errors.Is(err, ErrStaleDocumentVersion) {
		return nil
	}
	return err
}

// OpenExternalDocument apre in sola lettura un sorgente dell'SDK Go o della module cache della sessione.
func (s *Service) OpenExternalDocument(sessionID, path string) (OpenDocument, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return OpenDocument{}, err
	}
	info, ok := s.toolchain.LastDetected(session.ID)
	if !ok {
		return OpenDocument{}, fmt.Errorf("rileva il Go SDK per navigare nei suoi sorgenti")
	}
	document, err := s.documents.OpenExternalDocument(session, path, []string{info.GOROOT, info.GOMODCACHE})
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

// FormatDocument restituisce gli edit di formattazione del buffer corrente.
func (s *Service) FormatDocument(ctx context.Context, sessionID, documentID string) (FormatResult, error) {
	edits, version, err := s.lsp.Format(ctx, SessionID(sessionID), DocumentID(documentID))
	return FormatResult{Version: version, Edits: edits}, err
}

// CodeActions elenca le azioni disponibili per l'intervallo selezionato.
func (s *Service) CodeActions(ctx context.Context, sessionID, documentID string, selection EditorRange, only []string) ([]CodeActionEntry, error) {
	return s.lsp.CodeActions(ctx, SessionID(sessionID), DocumentID(documentID), selection, only)
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

// QuickDefinition restituisce il sorgente della dichiarazione del simbolo al cursore, per il popup Quick Definition.
func (s *Service) QuickDefinition(ctx context.Context, sessionID, documentID string, line, column int) (QuickDefinitionResult, error) {
	return s.lsp.QuickDefinition(ctx, SessionID(sessionID), DocumentID(documentID), line, column)
}
