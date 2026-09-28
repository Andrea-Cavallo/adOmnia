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
		if searchFile(path, relative, matcher, &result) {
			return filepath.SkipAll
		}
		return nil
	})
	if walkErr != nil && ctx.Err() != nil {
		return SearchResult{}, ctx.Err()
	}
	return result, nil
}

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

// searchFile aggiunge i risultati del file e restituisce true quando il limite globale è raggiunto.
func searchFile(path, relative string, matcher *regexp.Regexp, result *SearchResult) bool {
	info, err := os.Stat(path)
	if err != nil || info.Size() > maxSearchFileBytes {
		return false
	}
	data, err := os.ReadFile(path)
	if err != nil || bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return false
	}
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
			result.Matches = append(result.Matches, SearchMatch{
				RelativePath: relative, Line: line,
				Column: utf16Length(text[:bounds[0]]) + 1, EndColumn: utf16Length(text[:bounds[1]]) + 1,
				Preview: previewLine(text),
			})
			if len(result.Matches) >= maxSearchResults {
				result.Truncated = true
				return true
			}
		}
	}
	return false
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
