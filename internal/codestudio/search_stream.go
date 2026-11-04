package codestudio

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// Streaming search: the frontend starts a job, receives `search.matches` events while ripgrep is
// still scanning and a final `search.done` (or `search.error`). The synchronous SearchProject
// stays for compatibility and for the replace preview.

// SearchStreamInfo is the handle the UI keeps to cancel the job and to ignore stale events.
type SearchStreamInfo struct {
	ID     string `json:"id"`
	Engine string `json:"engine"`
}

// SearchBatch is one progressive chunk of results.
type SearchBatch struct {
	SearchID     string        `json:"searchId"`
	Matches      []SearchMatch `json:"matches"`
	FilesScanned int           `json:"filesScanned"`
	Truncated    bool          `json:"truncated"`
}

// SearchDone closes a job: the UI stops the spinner even when there were no matches.
type SearchDone struct {
	SearchID     string `json:"searchId"`
	Matches      int    `json:"matches"`
	FilesScanned int    `json:"filesScanned"`
	Truncated    bool   `json:"truncated"`
	ElapsedMs    int64  `json:"elapsedMs"`
	Engine       string `json:"engine"`
}

// SearchFailure is a real error (exit code 2, unreadable root, invalid pattern), not "no matches".
type SearchFailure struct {
	SearchID string `json:"searchId"`
	Message  string `json:"message"`
}

// StartProjectSearch avvia la ricerca in background e restituisce subito l'identificativo del job.
func (s *Service) StartProjectSearch(query SearchQuery) (SearchStreamInfo, error) {
	session, err := s.session(string(query.SessionID))
	if err != nil {
		return SearchStreamInfo{}, err
	}
	if _, err := compileSearch(query); err != nil {
		return SearchStreamInfo{}, err
	}
	binary, hasRipgrep := RipgrepBinary(s.toolsRoot)
	engine := "go"
	if hasRipgrep {
		engine = "ripgrep"
	}
	id, err := newSearchID()
	if err != nil {
		return SearchStreamInfo{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.searchesMu.Lock()
	if s.searches == nil {
		s.searches = map[string]context.CancelFunc{}
	}
	s.searches[id] = cancel
	s.searchesMu.Unlock()
	root := session.Project.RealPath
	sessionID := session.ID
	go func() {
		defer func() {
			cancel()
			s.searchesMu.Lock()
			delete(s.searches, id)
			s.searchesMu.Unlock()
		}()
		started := time.Now()
		total, scanned, truncated := 0, 0, false
		if hasRipgrep {
			err := s.ripgrepStream(ctx, binary, root, query, streamBatchSize, false, func(matches []SearchMatch, filesScanned int, isTruncated bool) bool {
				if ctx.Err() != nil {
					return false
				}
				total += len(matches)
				if filesScanned > scanned {
					scanned = filesScanned
				}
				truncated = truncated || isTruncated
				s.emit("search.matches", sessionID, id, SearchBatch{SearchID: id, Matches: matches, FilesScanned: scanned, Truncated: truncated})
				return true
			})
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				s.emit("search.error", sessionID, id, SearchFailure{SearchID: id, Message: err.Error()})
				return
			}
		} else {
			result, err := s.SearchProject(ctx, query)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				s.emit("search.error", sessionID, id, SearchFailure{SearchID: id, Message: err.Error()})
				return
			}
			total, scanned, truncated = len(result.Matches), result.FilesScanned, result.Truncated
			if total > 0 {
				s.emit("search.matches", sessionID, id, SearchBatch{SearchID: id, Matches: result.Matches, FilesScanned: scanned, Truncated: truncated})
			}
		}
		if ctx.Err() != nil {
			return
		}
		s.emit("search.done", sessionID, id, SearchDone{
			SearchID: id, Matches: total, FilesScanned: scanned, Truncated: truncated,
			ElapsedMs: time.Since(started).Milliseconds(), Engine: engine,
		})
	}()
	return SearchStreamInfo{ID: id, Engine: engine}, nil
}

// CancelProjectSearch ferma il job (se esiste) e ignora gli eventi che erano già in volo.
func (s *Service) CancelProjectSearch(id string) {
	s.searchesMu.Lock()
	cancel := s.searches[id]
	delete(s.searches, id)
	s.searchesMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func newSearchID() (string, error) {
	var buffer [12]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return "", fmt.Errorf("search id: %w", err)
	}
	return hex.EncodeToString(buffer[:]), nil
}
