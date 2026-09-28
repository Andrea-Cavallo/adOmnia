package goide

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// fileIndex tiene in memoria l'elenco dei file di ogni progetto per Quick Open: si costruisce alla
// prima ricerca e si invalida quando il watcher segnala file creati o eliminati.
type fileIndex struct {
	mu     sync.Mutex
	byRoot map[string][]indexedFile
}

type indexedFile struct {
	relative      string
	lowerRelative string
	lowerName     string
	name          string
}

// InvalidateFileIndex scarta l'elenco dei file del progetto; la ricerca successiva lo ricostruisce.
func (m *DocumentManager) InvalidateFileIndex(root string) {
	m.files.mu.Lock()
	delete(m.files.byRoot, root)
	m.files.mu.Unlock()
}

func (m *DocumentManager) projectFiles(project Project) ([]indexedFile, error) {
	m.files.mu.Lock()
	cached, ok := m.files.byRoot[project.RealPath]
	m.files.mu.Unlock()
	if ok {
		return cached, nil
	}
	files := make([]indexedFile, 0, 256)
	err := filepath.WalkDir(project.RealPath, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if path == project.RealPath {
			return nil
		}
		if entry.IsDir() {
			if isIgnoredDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if len(files) >= MaxQuickOpenFiles {
			return filepath.SkipAll
		}
		rel, relErr := filepath.Rel(project.RealPath, path)
		if relErr != nil {
			return nil
		}
		relative := filepath.ToSlash(rel)
		files = append(files, indexedFile{relative: relative, lowerRelative: strings.ToLower(relative), name: entry.Name(), lowerName: strings.ToLower(entry.Name())})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("ricerca file fallita: %w", err)
	}
	m.files.mu.Lock()
	m.files.byRoot[project.RealPath] = files
	m.files.mu.Unlock()
	return files, nil
}

// QuickOpen cerca file per nome e percorso: prima il nome esatto o il suo prefisso, poi le
// sottostringhe, infine le sottosequenze (es. "p250file7" trova pkg/p250/file7.go).
func (m *DocumentManager) QuickOpen(project Project, query string, limit int) ([]QuickOpenResult, error) {
	if limit <= 0 || limit > MaxQuickOpenResults {
		limit = MaxQuickOpenResults
	}
	files, err := m.projectFiles(project)
	if err != nil {
		return nil, err
	}
	needle := strings.ToLower(strings.TrimSpace(query))
	type scored struct {
		file  indexedFile
		score int
	}
	matches := make([]scored, 0, limit)
	for _, file := range files {
		if score, ok := quickOpenScore(needle, file); ok {
			matches = append(matches, scored{file: file, score: score})
		}
	}
	sort.SliceStable(matches, func(left, right int) bool {
		if matches[left].score != matches[right].score {
			return matches[left].score > matches[right].score
		}
		return len(matches[left].file.relative) < len(matches[right].file.relative)
	})
	results := make([]QuickOpenResult, 0, min(limit, len(matches)))
	for _, match := range matches[:min(limit, len(matches))] {
		results = append(results, QuickOpenResult{Name: match.file.name, RelativePath: match.file.relative, Language: languageForPath(match.file.name)})
	}
	return results, nil
}

func quickOpenScore(needle string, file indexedFile) (int, bool) {
	switch {
	case needle == "":
		return 0, true
	case file.lowerName == needle:
		return 1000, true
	case strings.HasPrefix(file.lowerName, needle):
		return 800, true
	case strings.Contains(file.lowerName, needle):
		return 600, true
	case strings.HasSuffix(file.lowerRelative, needle):
		return 500, true
	case strings.Contains(file.lowerRelative, needle):
		return 400, true
	}
	span, ok := subsequenceSpan(needle, file.lowerRelative)
	if !ok {
		return 0, false
	}
	// Sottosequenze compatte (lettere vicine) valgono di più di quelle sparse.
	return 200 - min(150, span-len(needle)), true
}

// subsequenceSpan restituisce la lunghezza del tratto che contiene i caratteri di needle in ordine.
func subsequenceSpan(needle, haystack string) (int, bool) {
	start, cursor := -1, 0
	for _, character := range needle {
		index := strings.IndexRune(haystack[cursor:], character)
		if index < 0 {
			return 0, false
		}
		if start < 0 {
			start = cursor + index
		}
		cursor += index + len(string(character))
	}
	return cursor - start, true
}
