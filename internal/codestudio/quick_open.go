package codestudio

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	ideproject "github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"golang.org/x/sync/singleflight"
)

// fileIndex tiene in memoria l'elenco dei file di ogni progetto per Quick Open: si costruisce alla
// prima ricerca (una sola costruzione per root anche con ricerche concorrenti) e il watcher lo aggiorna a delta.
type fileIndex struct {
	mu     sync.Mutex
	byRoot map[string][]indexedFile
	// generation cresce a ogni modifica o invalidazione: una costruzione partita prima non salva un elenco vecchio.
	generation map[string]uint64
	builds     singleflight.Group
}

type indexedFile struct {
	relative      string
	lowerRelative string
	lowerName     string
	name          string
}

func newIndexedFile(relative string) indexedFile {
	name := relative[strings.LastIndex(relative, "/")+1:]
	return indexedFile{relative: relative, lowerRelative: strings.ToLower(relative), name: name, lowerName: strings.ToLower(name)}
}

// InvalidateFileIndex scarta l'elenco dei file del progetto; la ricerca successiva lo ricostruisce.
func (m *DocumentManager) InvalidateFileIndex(root string) {
	m.files.mu.Lock()
	m.invalidateLocked(root)
	m.files.mu.Unlock()
}

func (m *DocumentManager) invalidateLocked(root string) {
	delete(m.files.byRoot, root)
	m.files.generation[root]++
}

// ApplyFileChanges aggiorna l'indice con i file creati ed eliminati dal batch del watcher, senza rileggere
// il progetto. Cartelle nuove, overflow o indice al limite fanno ricadere sulla ricostruzione.
func (m *DocumentManager) ApplyFileChanges(root string, batch FilesChanged) {
	if batch.Overflow {
		m.InvalidateFileIndex(root)
		return
	}
	removed := map[string]bool{}
	var created []string
	for _, change := range batch.Changes {
		switch change.Kind {
		case FileDeleted:
			removed[change.RelativePath] = true
		case FileCreated:
			// Stat fuori dal lock: una cartella nuova porta con sé un sottoalbero da leggere.
			info, err := os.Stat(change.Path)
			if err != nil {
				continue
			}
			if info.IsDir() {
				m.InvalidateFileIndex(root)
				return
			}
			created = append(created, change.RelativePath)
		}
	}
	m.files.mu.Lock()
	defer m.files.mu.Unlock()
	current, ok := m.files.byRoot[root]
	if !ok {
		// Nessun indice: basta impedire che una costruzione in corso salvi l'elenco di prima.
		m.files.generation[root]++
		return
	}
	if len(removed) == 0 && len(created) == 0 {
		return
	}
	next := applyFileDelta(current, removed, created)
	if len(next) >= MaxQuickOpenFiles {
		m.invalidateLocked(root)
		return
	}
	// Elenco nuovo, mai modificato in place: le ricerche in corso tengono il loro.
	m.files.byRoot[root] = next
	m.files.generation[root]++
}

func applyFileDelta(current []indexedFile, removed map[string]bool, created []string) []indexedFile {
	next := make([]indexedFile, 0, len(current)+len(created))
	present := make(map[string]bool, len(created))
	for _, relative := range created {
		present[relative] = false
	}
	for _, file := range current {
		if removedOrInside(file.relative, removed) {
			continue
		}
		if _, isCreated := present[file.relative]; isCreated {
			present[file.relative] = true
		}
		next = append(next, file)
	}
	for _, relative := range created {
		if !present[relative] && !removed[relative] {
			present[relative] = true
			next = append(next, newIndexedFile(relative))
		}
	}
	return next
}

// removedOrInside è vero se il file è stato eliminato o sta sotto una cartella eliminata o rinominata.
func removedOrInside(relative string, removed map[string]bool) bool {
	if removed[relative] {
		return true
	}
	for index := strings.IndexByte(relative, '/'); index >= 0; index = nextSlash(relative, index) {
		if removed[relative[:index]] {
			return true
		}
	}
	return false
}

func nextSlash(value string, after int) int {
	next := strings.IndexByte(value[after+1:], '/')
	if next < 0 {
		return -1
	}
	return after + 1 + next
}

func (m *DocumentManager) projectFiles(project Project) ([]indexedFile, error) {
	root := project.RealPath
	m.files.mu.Lock()
	cached, ok := m.files.byRoot[root]
	m.files.mu.Unlock()
	if ok {
		return cached, nil
	}
	built, err, _ := m.files.builds.Do(root, func() (any, error) {
		m.files.mu.Lock()
		generation := m.files.generation[root]
		m.files.mu.Unlock()
		started := time.Now()
		files, err := walkProjectFiles(root)
		if err != nil {
			return nil, err
		}
		m.files.mu.Lock()
		if m.files.generation[root] == generation {
			m.files.byRoot[root] = files
		}
		m.files.mu.Unlock()
		if m.onIndexBuilt != nil {
			m.onIndexBuilt(time.Since(started), len(files))
		}
		return files, nil
	})
	if err != nil {
		return nil, err
	}
	return built.([]indexedFile), nil
}

func walkProjectFiles(root string) ([]indexedFile, error) {
	files := make([]indexedFile, 0, 256)
	ignore := ideproject.LoadGitIgnore(root)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if path == root {
			return nil
		}
		if entry.IsDir() {
			if skipWalkDirectory(path, entry.Name()) || gitIgnored(ignore, root, path, true) {
				return filepath.SkipDir
			}
			return nil
		}
		if gitIgnored(ignore, root, path, false) {
			return nil
		}
		if len(files) >= MaxQuickOpenFiles {
			return filepath.SkipAll
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		files = append(files, newIndexedFile(filepath.ToSlash(rel)))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("ricerca file fallita: %w", err)
	}
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
