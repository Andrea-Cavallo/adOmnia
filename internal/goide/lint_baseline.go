package goide

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// lintBaselineFile è versionabile con il progetto: chi clona vede solo i problemi nuovi.
const lintBaselineFile = ".adomnia/lint-baseline.json"

// lintBaselineEntry identifica un problema senza numero di riga, così resta valido quando il codice
// sopra si sposta; Count gestisce più problemi identici nello stesso file.
type lintBaselineEntry struct {
	File    string `json:"file"`
	Source  string `json:"source"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
	Count   int    `json:"count"`
}

type lintBaseline struct {
	Format  string              `json:"format"`
	Version int                 `json:"version"`
	Issues  []lintBaselineEntry `json:"issues"`
}

func baselineKey(root string, issue lintIssue) lintBaselineEntry {
	return lintBaselineEntry{File: relativeWithin(root, issue.path), Source: issue.source, Code: issue.code, Message: issue.message}
}

// SaveLintBaseline esegue il linter sull'intero progetto e registra i problemi attuali come accettati.
func (s *Service) SaveLintBaseline(ctx context.Context, sessionID string) (int, error) {
	session, _, issues, _, err := s.collectLintIssues(ctx, sessionID, false)
	if err != nil {
		return 0, err
	}
	counts := map[lintBaselineEntry]int{}
	for _, issue := range issues {
		counts[baselineKey(session.Project.RealPath, issue)]++
	}
	baseline := lintBaseline{Format: "adomnia-lint-baseline", Version: 1, Issues: make([]lintBaselineEntry, 0, len(counts))}
	for entry, count := range counts {
		entry.Count = count
		baseline.Issues = append(baseline.Issues, entry)
	}
	sort.Slice(baseline.Issues, func(left, right int) bool {
		a, b := baseline.Issues[left], baseline.Issues[right]
		if a.File != b.File {
			return a.File < b.File
		}
		if a.Source != b.Source {
			return a.Source < b.Source
		}
		return a.Message < b.Message
	})
	data, err := json.MarshalIndent(baseline, "", "  ")
	if err != nil {
		return 0, err
	}
	path := filepath.Join(session.Project.RealPath, filepath.FromSlash(lintBaselineFile))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, fmt.Errorf("cartella .adomnia non scrivibile: %w", err)
	}
	if err := atomicWriteFile(path, append(data, '\n'), 0o644); err != nil {
		return 0, err
	}
	return len(issues), nil
}

// ClearLintBaseline rimuove la baseline: il linter torna a mostrare tutti i problemi.
func (s *Service) ClearLintBaseline(sessionID string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(session.Project.RealPath, filepath.FromSlash(lintBaselineFile)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// applyLintBaseline toglie i problemi già registrati; una baseline illeggibile non nasconde nulla.
func applyLintBaseline(root string, issues []lintIssue) ([]lintIssue, int) {
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(lintBaselineFile)))
	if err != nil {
		return issues, 0
	}
	var baseline lintBaseline
	if json.Unmarshal(data, &baseline) != nil {
		return issues, 0
	}
	remaining := map[lintBaselineEntry]int{}
	for _, entry := range baseline.Issues {
		count := entry.Count
		entry.Count = 0
		remaining[entry] += max(count, 1)
	}
	kept := make([]lintIssue, 0, len(issues))
	hidden := 0
	for _, issue := range issues {
		key := baselineKey(root, issue)
		if remaining[key] > 0 {
			remaining[key]--
			hidden++
			continue
		}
		kept = append(kept, issue)
	}
	return kept, hidden
}
