package goide

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// GetSessionView restituisce il layout e i tab ripristinabili della sessione.
func (s *Service) GetSessionView(sessionID string) (SessionView, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return SessionView{}, err
	}
	s.viewMu.RLock()
	view := s.views[session.ID]
	s.viewMu.RUnlock()
	return view, nil
}

// SaveSessionView registra tab aperti, file attivo e layout della sessione.
// Non salva mai il contenuto dei file: quello vive nello store di recupero.
func (s *Service) SaveSessionView(sessionID string, view SessionView) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	view.OpenPaths = limitPaths(view.OpenPaths, maxRestoredTabs)
	if len(view.Bookmarks) > maxBookmarks {
		view.Bookmarks = view.Bookmarks[:maxBookmarks]
	}
	if len(view.Navigation) > maxNavigationEntries {
		view.Navigation = view.Navigation[len(view.Navigation)-maxNavigationEntries:]
	}
	if view.NavigationIndex < 0 || view.NavigationIndex >= len(view.Navigation) {
		view.NavigationIndex = max(len(view.Navigation)-1, 0)
	}
	s.viewMu.Lock()
	saved := s.views[session.ID]
	view.Breakpoints, view.FunctionBreakpoints, view.StopOnPanic = saved.Breakpoints, saved.FunctionBreakpoints, saved.StopOnPanic
	s.views[session.ID] = view
	s.viewMu.Unlock()
	return s.saveState()
}

const (
	maxRestoredTabs      = 50
	maxBookmarks         = 200
	maxNavigationEntries = 50
)

func limitPaths(paths []string, limit int) []string {
	seen := make(map[string]struct{}, len(paths))
	unique := make([]string, 0, len(paths))
	for _, path := range paths {
		if path == "" {
			continue
		}
		if _, duplicate := seen[path]; duplicate {
			continue
		}
		seen[path] = struct{}{}
		unique = append(unique, path)
		if len(unique) == limit {
			break
		}
	}
	return unique
}

// RememberBuffer conserva fuori processo un buffer non salvato, così che un
// riavvio o un crash non lo perda. Il frontend lo chiama con debounce.
func (s *Service) RememberBuffer(sessionID, relativePath, content, diskToken string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	if _, err := s.documents.ResolveProjectPath(session.Project, relativePath); err != nil {
		return err
	}
	return s.recovery.Remember(session.ID, relativePath, content, diskToken)
}

// ForgetBuffer scarta un buffer dal recupero, dopo un salvataggio o una chiusura.
func (s *Service) ForgetBuffer(sessionID, relativePath string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return s.recovery.Forget(session.ID, relativePath)
}

// ListRecoveredBuffers elenca i buffer non salvati ritrovati per la sessione,
// segnalando quelli il cui file su disco è cambiato o non esiste più. Non
// riapplica nulla: il recupero resta una scelta esplicita dell'utente.
func (s *Service) ListRecoveredBuffers(sessionID string) ([]RecoveredBuffer, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	entries := s.recovery.List(session.ID)
	buffers := make([]RecoveredBuffer, 0, len(entries))
	for _, entry := range entries {
		buffer := RecoveredBuffer{
			SessionID: entry.SessionID, RelativePath: entry.RelativePath,
			Content: entry.Content, SavedAt: entry.SavedAt,
		}
		path, resolveErr := s.documents.ResolveProjectPath(session.Project, entry.RelativePath)
		if resolveErr != nil {
			buffer.Missing = true
			buffers = append(buffers, buffer)
			continue
		}
		if _, _, token, readErr := readTextFile(path); readErr != nil {
			buffer.Missing = true
		} else if entry.DiskToken != "" && entry.DiskToken != token {
			buffer.DiskChanged = true
		}
		buffers = append(buffers, buffer)
	}
	return buffers, nil
}

// PruneMissingSessions rimuove le sessioni la cui cartella non è più
// raggiungibile, conservando le altre e la relativa voce nei progetti recenti.
func (s *Service) PruneMissingSessions() ([]Session, error) {
	if err := s.restore(); err != nil {
		return nil, err
	}
	removed := false
	for _, session := range s.workspace.ListSessions() {
		if info, err := os.Stat(session.Project.RealPath); err == nil && info.IsDir() {
			continue
		}
		// Una cartella sparita non deve lasciare processi orfani: Run, gopls e shell si fermano.
		s.processes.StopSession(session.ID)
		s.lsp.CloseSession(session.ID)
		s.terminal.CloseSession(session.ID)
		s.debug.StopSession(session.ID)
		s.watcher.Stop(session.ID)
		s.documents.CloseSession(session.ID)
		s.toolchain.CloseSession(session.ID)
		s.runConfigs.CloseSession(session.ID)
		s.tests.CloseSession(session.ID)
		_ = s.recovery.ForgetSession(session.ID)
		s.workspace.CloseSession(session.ID)
		s.windows.forget(session.ID)
		s.viewMu.Lock()
		delete(s.views, session.ID)
		s.viewMu.Unlock()
		removed = true
		s.emit("session.unavailable", session.ID, string(session.ID), session.Project.RootPath)
	}
	if removed {
		if err := s.saveState(); err != nil {
			return nil, err
		}
	}
	return s.workspace.ListSessions(), nil
}

// FindSessionsForPath elenca le altre sessioni che hanno lo stesso file reale
// nel proprio albero, così da poter avvisare l'utente di un possibile conflitto.
func (s *Service) FindSessionsForPath(sessionID, relativePath string) ([]Session, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	path, err := s.documents.ResolveProjectPath(session.Project, relativePath)
	if err != nil {
		return nil, err
	}
	matches := make([]Session, 0, 2)
	for _, other := range s.workspace.ListSessions() {
		if other.ID == session.ID {
			continue
		}
		relative, relErr := filepath.Rel(other.Project.RealPath, path)
		if relErr != nil || filepath.IsAbs(relative) {
			continue
		}
		if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			continue
		}
		matches = append(matches, other)
	}
	return matches, nil
}

// ConfigureRecoveryStore collega lo store persistente dei buffer di recupero.
func (s *Service) ConfigureRecoveryStore(store Store) error {
	return s.recovery.Configure(store)
}

// CreateFiles crea nel progetto file nuovi (New File, Move to New File): tutti o nessuno, mai sovrascrivendo.
func (s *Service) CreateFiles(sessionID string, files []NewFile) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return s.documents.CreateFiles(session.Project, files)
}

// CreateDirectory crea una cartella nel progetto.
func (s *Service) CreateDirectory(sessionID, relativePath string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return s.documents.CreateDirectory(session.Project, relativePath)
}

// MovePath rinomina o sposta un file o una cartella del progetto.
func (s *Service) MovePath(sessionID, from, to string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return s.documents.MovePath(session.Project, from, to)
}

// DuplicatePath copia un file o una cartella del progetto.
func (s *Service) DuplicatePath(sessionID, from, to string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return s.documents.DuplicatePath(session.Project, from, to)
}

// DeletePath elimina un file o una cartella; il testo dei file resta nella local history.
func (s *Service) DeletePath(sessionID, relativePath string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return s.documents.DeletePath(session.Project, relativePath, func(rel, content string) {
		_ = s.history.Record(session.ID, rel, content, "Before delete")
	})
}

// RevealPath mostra un elemento del progetto nel file manager ("" = radice).
func (s *Service) RevealPath(sessionID, relativePath string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	return s.documents.RevealPath(session.Project, relativePath)
}

// ConfigureHistoryStore collega lo store persistente della local history.
func (s *Service) ConfigureHistoryStore(store Store) error {
	if store == nil {
		return fmt.Errorf("store della local history non valido")
	}
	s.history = NewLocalHistory(store)
	return nil
}

// recordOriginalBeforeSave conserva il contenuto su disco prima del primo salvataggio del file:
// così anche la versione di partenza resta ripristinabile.
func (s *Service) recordOriginalBeforeSave(session Session, documentID DocumentID) {
	document, ok := s.documents.Get(session.ID, documentID)
	if !ok || s.history.Has(session.ID, document.RelativePath) {
		return
	}
	path, err := s.documents.ResolveProjectPath(session.Project, document.RelativePath)
	if err != nil {
		return
	}
	if text, _, _, err := readTextFile(path); err == nil {
		_ = s.history.Record(session.ID, document.RelativePath, text, "Before first save")
	}
}

// ListLocalHistory elenca le versioni salvate di un file, dalla più recente.
func (s *Service) ListLocalHistory(sessionID, relativePath string) ([]HistoryRevision, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return s.history.List(session.ID, relativePath)
}

// LocalHistoryContent restituisce il testo di una versione della local history.
func (s *Service) LocalHistoryContent(sessionID, relativePath, revisionID string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	return s.history.Content(session.ID, relativePath, revisionID)
}

// WatcherStatus indica se il progetto è osservato per intero o solo in parte.
func (s *Service) WatcherStatus(sessionID string) (WatcherStatus, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return WatcherStatus{}, err
	}
	return s.watcher.Status(session.ID), nil
}
