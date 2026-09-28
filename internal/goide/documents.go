package goide

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"
)

const (
	MaxDocumentBytes    int64 = 16 * 1024 * 1024
	MaxDirectoryItems         = 1_000
	MaxQuickOpenFiles         = 20_000
	MaxQuickOpenResults       = 100
)

var ignoredProjectDirectories = map[string]struct{}{
	".git": {}, ".idea": {}, ".vscode": {}, "node_modules": {}, "vendor": {},
	"bin": {}, "build": {}, "dist": {}, "coverage": {}, ".cache": {},
}

type documentRecord struct {
	document  Document
	diskToken string
}

type DocumentManager struct {
	mu        sync.RWMutex
	documents map[DocumentID]documentRecord
}

func NewDocumentManager() *DocumentManager {
	return &DocumentManager{documents: make(map[DocumentID]documentRecord)}
}

// ListDirectory legge un solo livello del progetto e mantiene la navigazione confinata alla radice reale.
func (m *DocumentManager) ListDirectory(project Project, relativePath string, includeIgnored bool) ([]FileEntry, error) {
	directory, err := m.resolveDirectory(project, relativePath)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("impossibile leggere la cartella: %w", err)
	}
	result := make([]FileEntry, 0, min(len(entries), MaxDirectoryItems))
	for _, entry := range entries {
		if len(result) >= MaxDirectoryItems {
			break
		}
		ignored := isIgnoredDirectory(entry.Name()) && entry.IsDir()
		if ignored && !includeIgnored {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		rel, relErr := filepath.Rel(project.RealPath, filepath.Join(directory, entry.Name()))
		if relErr != nil {
			continue
		}
		result = append(result, FileEntry{
			Name:         entry.Name(),
			RelativePath: filepath.ToSlash(rel),
			Directory:    entry.IsDir(),
			Ignored:      ignored,
			Size:         info.Size(),
			ModifiedAt:   info.ModTime().UTC(),
			Language:     languageForPath(entry.Name()),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Directory != result[j].Directory {
			return result[i].Directory
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	return result, nil
}

// OpenDocument legge un file testuale e crea un'identità stabile nella sessione indicata.
func (m *DocumentManager) OpenDocument(session Session, relativePath string) (OpenDocument, error) {
	path, err := m.ResolveProjectPath(session.Project, relativePath)
	if err != nil {
		return OpenDocument{}, err
	}
	content, info, token, err := readTextFile(path)
	if err != nil {
		return OpenDocument{}, err
	}
	rel, _ := filepath.Rel(session.Project.RealPath, path)
	documentID := stableDocumentID(session.ID, path)
	document := Document{
		ID:           documentID,
		SessionID:    session.ID,
		URI:          fileURI(path),
		Path:         path,
		RelativePath: filepath.ToSlash(rel),
		Name:         filepath.Base(path),
		Language:     languageForPath(path),
		Version:      1,
	}
	m.mu.Lock()
	if existing, ok := m.documents[documentID]; ok {
		document.Version = existing.document.Version
	}
	m.documents[documentID] = documentRecord{document: document, diskToken: token}
	m.mu.Unlock()
	return OpenDocument{Document: document, Content: content, DiskToken: token, ModifiedAt: info.ModTime().UTC()}, nil
}

// SaveDocument scrive atomicamente un buffer e rifiuta sovrascritture di modifiche esterne non confermate.
func (m *DocumentManager) SaveDocument(session Session, documentID DocumentID, content, expectedDiskToken string, force bool) (OpenDocument, error) {
	if int64(len(content)) > MaxDocumentBytes {
		return OpenDocument{}, fmt.Errorf("documento troppo grande: limite %d byte", MaxDocumentBytes)
	}
	m.mu.RLock()
	record, ok := m.documents[documentID]
	m.mu.RUnlock()
	if !ok || record.document.SessionID != session.ID {
		return OpenDocument{}, fmt.Errorf("documento Go Studio non trovato")
	}
	path, err := m.ResolveProjectPath(session.Project, record.document.Path)
	if err != nil {
		return OpenDocument{}, err
	}
	_, info, currentToken, err := readTextFile(path)
	if err != nil {
		return OpenDocument{}, err
	}
	if !force && expectedDiskToken != "" && currentToken != expectedDiskToken {
		return OpenDocument{}, fmt.Errorf("il file è stato modificato esternamente; ricaricalo, confrontalo o conferma la sovrascrittura")
	}
	if err := atomicWriteFile(path, []byte(content), info.Mode().Perm()); err != nil {
		return OpenDocument{}, err
	}
	savedContent, savedInfo, token, err := readTextFile(path)
	if err != nil {
		return OpenDocument{}, err
	}
	record.document.Version++
	record.document.Dirty = false
	record.diskToken = token
	m.mu.Lock()
	m.documents[documentID] = record
	m.mu.Unlock()
	return OpenDocument{Document: record.document, Content: savedContent, DiskToken: token, ModifiedAt: savedInfo.ModTime().UTC()}, nil
}

// CheckDocument confronta il token noto dal frontend con lo stato corrente del file su disco.
func (m *DocumentManager) CheckDocument(session Session, documentID DocumentID, expectedDiskToken string) (DocumentDiskState, error) {
	m.mu.RLock()
	record, ok := m.documents[documentID]
	m.mu.RUnlock()
	if !ok || record.document.SessionID != session.ID {
		return DocumentDiskState{}, fmt.Errorf("documento Go Studio non trovato")
	}
	path, err := m.ResolveProjectPath(session.Project, record.document.Path)
	if err != nil {
		return DocumentDiskState{}, err
	}
	content, info, token, err := readTextFile(path)
	if err != nil {
		return DocumentDiskState{}, err
	}
	changed := expectedDiskToken != "" && token != expectedDiskToken
	state := DocumentDiskState{DocumentID: documentID, Changed: changed, DiskToken: token, ModifiedAt: info.ModTime().UTC()}
	if changed {
		state.Content = content
	}
	return state, nil
}

// CloseDocument rilascia il documento indicato senza toccare il file su disco.
func (m *DocumentManager) CloseDocument(sessionID SessionID, documentID DocumentID) {
	m.mu.Lock()
	if record, ok := m.documents[documentID]; ok && record.document.SessionID == sessionID {
		delete(m.documents, documentID)
	}
	m.mu.Unlock()
}

// CloseSession rilascia tutti i documenti posseduti dalla sessione.
func (m *DocumentManager) CloseSession(sessionID SessionID) {
	m.mu.Lock()
	for id, record := range m.documents {
		if record.document.SessionID == sessionID {
			delete(m.documents, id)
		}
	}
	m.mu.Unlock()
}

// QuickOpen cerca file per nome e percorso con limiti rigidi e senza seguire directory pesanti.
func (m *DocumentManager) QuickOpen(project Project, query string, limit int) ([]QuickOpenResult, error) {
	if limit <= 0 || limit > MaxQuickOpenResults {
		limit = MaxQuickOpenResults
	}
	needle := strings.ToLower(strings.TrimSpace(query))
	results := make([]QuickOpenResult, 0, limit)
	visited := 0
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
		visited++
		if visited > MaxQuickOpenFiles || len(results) >= limit {
			return filepath.SkipAll
		}
		rel, relErr := filepath.Rel(project.RealPath, path)
		if relErr != nil {
			return nil
		}
		normalized := filepath.ToSlash(rel)
		if needle != "" && !strings.Contains(strings.ToLower(normalized), needle) {
			return nil
		}
		results = append(results, QuickOpenResult{Name: entry.Name(), RelativePath: normalized, Language: languageForPath(path)})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("ricerca file fallita: %w", err)
	}
	return results, nil
}

// ResolveProjectPath convalida un percorso esistente rispetto alla radice reale del progetto.
func (m *DocumentManager) ResolveProjectPath(project Project, candidate string) (string, error) {
	root := project.RealPath
	if root == "" {
		return "", fmt.Errorf("radice reale del progetto non disponibile")
	}
	path := candidate
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, filepath.FromSlash(path))
	}
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", fmt.Errorf("percorso documento non valido: %w", err)
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("impossibile risolvere il documento: %w", err)
	}
	if err := ensureWithinRoot(root, realPath); err != nil {
		return "", err
	}
	info, err := os.Stat(realPath)
	if err != nil {
		return "", fmt.Errorf("impossibile leggere il documento: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("il percorso richiesto è una cartella")
	}
	if info.Size() > MaxDocumentBytes {
		return "", fmt.Errorf("documento troppo grande: limite %d byte", MaxDocumentBytes)
	}
	return realPath, nil
}

func (m *DocumentManager) resolveDirectory(project Project, relativePath string) (string, error) {
	candidate := filepath.FromSlash(relativePath)
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(project.RealPath, candidate)
	}
	abs, err := filepath.Abs(filepath.Clean(candidate))
	if err != nil {
		return "", fmt.Errorf("percorso cartella non valido: %w", err)
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("impossibile risolvere la cartella: %w", err)
	}
	if err := ensureWithinRoot(project.RealPath, realPath); err != nil {
		return "", err
	}
	info, err := os.Stat(realPath)
	if err != nil {
		return "", fmt.Errorf("impossibile leggere la cartella: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("il percorso richiesto non è una cartella")
	}
	return realPath, nil
}

func ensureWithinRoot(root, candidate string) error {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return fmt.Errorf("impossibile verificare il percorso: %w", err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("il percorso richiesto è esterno al progetto")
	}
	return nil
}

func readTextFile(path string) (string, os.FileInfo, string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", nil, "", fmt.Errorf("impossibile leggere il documento: %w", err)
	}
	if info.Size() > MaxDocumentBytes {
		return "", nil, "", fmt.Errorf("documento troppo grande: limite %d byte", MaxDocumentBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", nil, "", fmt.Errorf("impossibile leggere il documento: %w", err)
	}
	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return "", nil, "", fmt.Errorf("il file non è un documento testuale UTF-8")
	}
	return string(data), info, diskToken(data, info), nil
}

func atomicWriteFile(path string, data []byte, mode os.FileMode) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".adomnia-save-*")
	if err != nil {
		return fmt.Errorf("impossibile preparare il salvataggio: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
		temporary.Close()
		return fmt.Errorf("impossibile conservare i permessi del file: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return fmt.Errorf("scrittura del documento fallita: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sincronizzazione del documento fallita: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("chiusura del documento temporaneo fallita: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("sostituzione atomica del documento fallita: %w", err)
	}
	return nil
}

func stableDocumentID(sessionID SessionID, path string) DocumentID {
	sum := sha256.Sum256([]byte(string(sessionID) + "\x00" + filepath.Clean(path)))
	return DocumentID("document-" + hex.EncodeToString(sum[:12]))
}

func diskToken(data []byte, info os.FileInfo) string {
	hash := sha256.Sum256(data)
	return fmt.Sprintf("%d-%d-%s", info.ModTime().UnixNano(), info.Size(), hex.EncodeToString(hash[:8]))
}

func fileURI(path string) string {
	normalized := filepath.ToSlash(path)
	if len(normalized) >= 2 && normalized[1] == ':' {
		normalized = "/" + normalized
	}
	return (&url.URL{Scheme: "file", Path: normalized}).String()
}

func languageForPath(path string) string {
	base := strings.ToLower(filepath.Base(path))
	switch base {
	case "go.mod", "go.work", "go.sum":
		return "go"
	case ".env":
		return "dotenv"
	}
	switch strings.ToLower(filepath.Ext(base)) {
	case ".go":
		return "go"
	case ".json", ".jsonc":
		return "json"
	case ".yaml", ".yml":
		return "yaml"
	case ".md", ".markdown":
		return "markdown"
	default:
		return "plaintext"
	}
}

func isIgnoredDirectory(name string) bool {
	_, ignored := ignoredProjectDirectories[strings.ToLower(name)]
	return ignored
}
