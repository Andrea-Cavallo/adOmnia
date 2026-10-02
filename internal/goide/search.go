package goide

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	maxSearchResults     = 2_000
	maxSearchFileBytes   = 2 * 1024 * 1024
	maxSearchFiles       = 50_000
	maxSearchPreviewRune = 240
)

type SearchQuery struct {
	SessionID     SessionID `json:"sessionId"`
	Pattern       string    `json:"pattern"`
	Regex         bool      `json:"regex"`
	CaseSensitive bool      `json:"caseSensitive"`
	WholeWord     bool      `json:"wholeWord"`
	Include       []string  `json:"include"`
	Exclude       []string  `json:"exclude"`
}

type SearchMatch struct {
	RelativePath string `json:"relativePath"`
	Line         int    `json:"line"`
	Column       int    `json:"column"`
	EndColumn    int    `json:"endColumn"`
	Preview      string `json:"preview"`
}

type SearchResult struct {
	Matches      []SearchMatch `json:"matches"`
	FilesScanned int           `json:"filesScanned"`
	Truncated    bool          `json:"truncated"`
}

// searchWorkers limita le letture parallele: abbastanza per nascondere la latenza del disco.
const searchWorkers = 8

// SearchProject cerca testo nei file del progetto rispettando cancellazione, limiti ed esclusioni.
func (s *Service) SearchProject(ctx context.Context, query SearchQuery) (SearchResult, error) {
	session, err := s.session(string(query.SessionID))
	if err != nil {
		return SearchResult{}, err
	}
	matcher, err := compileSearch(query)
	if err != nil {
		return SearchResult{}, err
	}
	result := SearchResult{Matches: []SearchMatch{}}
	candidates := []searchCandidate{}
	root := session.Project.RealPath
	walkErr := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		relative := filepath.ToSlash(strings.TrimPrefix(strings.TrimPrefix(path, root), string(filepath.Separator)))
		if entry.IsDir() {
			if path != root && (isIgnoredDirectory(entry.Name()) || matchesAny(query.Exclude, relative, entry.Name())) {
				return filepath.SkipDir
			}
			return nil
		}
		if matchesAny(query.Exclude, relative, entry.Name()) || (len(query.Include) > 0 && !matchesAny(query.Include, relative, entry.Name())) {
			return nil
		}
		result.FilesScanned++
		if result.FilesScanned > maxSearchFiles {
			result.Truncated = true
			return filepath.SkipAll
		}
		info, err := entry.Info()
		if err != nil || info.Size() > maxSearchFileBytes {
			return nil
		}
		candidates = append(candidates, searchCandidate{path: path, relative: relative})
		return nil
	})
	if walkErr != nil && ctx.Err() != nil {
		return SearchResult{}, ctx.Err()
	}
	// Leggere i file in parallelo conta soprattutto su Windows, dove aprire un file costa più che cercarci.
	perFile := make([][]SearchMatch, len(candidates))
	next := make(chan int)
	var workers sync.WaitGroup
	for worker := 0; worker < min(searchWorkers, max(1, len(candidates))); worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range next {
				if ctx.Err() == nil {
					perFile[index] = searchFile(candidates[index].path, candidates[index].relative, matcher)
				}
			}
		}()
	}
	for index := range candidates {
		next <- index
	}
	close(next)
	workers.Wait()
	if ctx.Err() != nil {
		return SearchResult{}, ctx.Err()
	}
	for _, matches := range perFile {
		for _, match := range matches {
			if len(result.Matches) >= maxSearchResults {
				result.Truncated = true
				return result, nil
			}
			result.Matches = append(result.Matches, match)
		}
	}
	return result, nil
}

type searchCandidate struct{ path, relative string }

func compileSearch(query SearchQuery) (*regexp.Regexp, error) {
	pattern := query.Pattern
	if strings.TrimSpace(pattern) == "" {
		return nil, fmt.Errorf("inserisci un testo da cercare")
	}
	if !query.Regex {
		pattern = regexp.QuoteMeta(pattern)
	}
	if query.WholeWord {
		pattern = `\b(?:` + pattern + `)\b`
	}
	if !query.CaseSensitive {
		pattern = "(?i)" + pattern
	}
	compiled, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("espressione regolare non valida: %w", err)
	}
	return compiled, nil
}

func matchesAny(patterns []string, relative, name string) bool {
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		if ok, _ := filepath.Match(pattern, name); ok {
			return true
		}
		if ok, _ := filepath.Match(pattern, relative); ok {
			return true
		}
		if strings.HasSuffix(pattern, "/**") && strings.HasPrefix(relative+"/", strings.TrimSuffix(pattern, "**")) {
			return true
		}
	}
	return false
}

// searchFile restituisce le occorrenze di un file (al più maxSearchResults).
func searchFile(path, relative string, matcher *regexp.Regexp) []SearchMatch {
	data, err := os.ReadFile(path)
	// Il controllo sull'intero file evita lo scanner riga per riga nella grande maggioranza dei file senza occorrenze.
	if err != nil || !matcher.Match(data) || bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return nil
	}
	matches := []SearchMatch{}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 64*1024), maxSearchFileBytes)
	line := 0
	for scanner.Scan() {
		line++
		text := scanner.Text()
		for _, bounds := range matcher.FindAllStringIndex(text, -1) {
			if bounds[0] == bounds[1] {
				continue
			}
			matches = append(matches, SearchMatch{
				RelativePath: relative, Line: line,
				Column: utf16Length(text[:bounds[0]]) + 1, EndColumn: utf16Length(text[:bounds[1]]) + 1,
				Preview: previewLine(text),
			})
			if len(matches) > maxSearchResults {
				return matches
			}
		}
	}
	return matches
}

func utf16Length(text string) int {
	return len(utf16.Encode([]rune(text)))
}

func previewLine(text string) string {
	trimmed := strings.TrimRight(text, "\r")
	if utf8.RuneCountInString(trimmed) <= maxSearchPreviewRune {
		return trimmed
	}
	return string([]rune(trimmed)[:maxSearchPreviewRune]) + "…"
}
