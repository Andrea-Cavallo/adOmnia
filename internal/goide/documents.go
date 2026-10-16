package goide

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"adomnia/internal/ide/fileio"
	"adomnia/internal/ide/project"
)

const (
	MaxDocumentBytes    int64 = 16 * 1024 * 1024
	MaxDirectoryItems         = 1_000
	MaxQuickOpenFiles         = 20_000
	MaxQuickOpenResults       = 100
)

type documentRecord struct {
	document  Document
	diskToken string
}

type DocumentManager struct {
	mu        sync.RWMutex
	documents map[DocumentID]documentRecord
	files     fileIndex
}

func NewDocumentManager() *DocumentManager {
	return &DocumentManager{documents: make(map[DocumentID]documentRecord), files: fileIndex{byRoot: make(map[string][]indexedFile)}}
}

// ListDirectory legge un solo livello del progetto e mantiene la navigazione confinata alla radice reale.
// Come watcher, ricerca e quick open, rispetta il `.gitignore` della radice oltre alle
// cartelle sempre escluse (`IgnoredDirectory`); "mostra ignorati" li rivela marcati tali.
func (m *DocumentManager) ListDirectory(proj Project, relativePath string, includeIgnored bool) ([]FileEntry, error) {
	directory, err := m.resolveDirectory(proj, relativePath)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("could not read the folder: %w", err)
	}
	ignore := project.LoadGitIgnore(proj.RealPath)
	result := make([]FileEntry, 0, min(len(entries), MaxDirectoryItems))
	for _, entry := range entries {
		if len(result) >= MaxDirectoryItems {
			break
		}
		path := filepath.Join(directory, entry.Name())
		ignored := (isIgnoredDirectory(entry.Name()) && entry.IsDir()) || gitIgnored(ignore, proj.RealPath, path, entry.IsDir())
		// Le cartelle ignorate restano nascoste come già accade per node_modules e build;
		// i file ignorati restano visibili ma marcati (es. .env, spesso in .gitignore).
		if ignored && entry.IsDir() && !includeIgnored {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		rel, relErr := filepath.Rel(proj.RealPath, path)
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
	mediaType, isImage := imageMimeType(path)
	content, dataURL, info, token := "", "", (os.FileInfo)(nil), ""
	if isImage {
		dataURL, token, info, err = readImageFile(path)
	} else {
		content, info, token, err = readTextFile(path)
	}
	if err != nil {
		return OpenDocument{}, err
	}
	rel, _ := filepath.Rel(session.Project.RealPath, path)
	documentID := stableDocumentID(session.ID, path)
	language := languageForPath(path)
	if isImage {
		language = "image"
	}
	document := Document{
		ID:           documentID,
		SessionID:    session.ID,
		URI:          fileURI(path),
		Path:         path,
		RelativePath: filepath.ToSlash(rel),
		Name:         filepath.Base(path),
		Language:     language,
		MediaType:    mediaType,
		Version:      1,
		ReadOnly:     isImage,
	}
	m.mu.Lock()
	if existing, ok := m.documents[documentID]; ok {
		document.Version = existing.document.Version
	}
	m.documents[documentID] = documentRecord{document: document, diskToken: token}
	m.mu.Unlock()
	return OpenDocument{Document: document, Content: content, DiskToken: token, ModifiedAt: info.ModTime().UTC(), DataURL: dataURL}, nil
}

// SaveDocument scrive atomicamente un buffer e rifiuta sovrascritture di modifiche esterne non confermate.
func (m *DocumentManager) SaveDocument(session Session, documentID DocumentID, content, expectedDiskToken string, force bool) (OpenDocument, error) {
	if int64(len(content)) > MaxDocumentBytes {
		return OpenDocument{}, fmt.Errorf("document too large: limit %d bytes", MaxDocumentBytes)
	}
	m.mu.RLock()
	record, ok := m.documents[documentID]
	m.mu.RUnlock()
	if !ok || record.document.SessionID != session.ID {
		return OpenDocument{}, fmt.Errorf("Go Studio document not found")
	}
	if record.document.ReadOnly {
		return OpenDocument{}, fmt.Errorf("SDK and module cache sources are read-only")
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
		return OpenDocument{}, fmt.Errorf("the file was modified externally; reload it, compare it or confirm the overwrite")
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
		return DocumentDiskState{}, fmt.Errorf("Go Studio document not found")
	}
	if record.document.ReadOnly {
		return DocumentDiskState{DocumentID: documentID, DiskToken: expectedDiskToken}, nil
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

// OpenExternalDocument apre in sola lettura un file dell'SDK Go o della module cache, confinato alle radici consentite.
func (m *DocumentManager) OpenExternalDocument(session Session, path string, allowedRoots []string) (OpenDocument, error) {
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return OpenDocument{}, fmt.Errorf("invalid path: %w", err)
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return OpenDocument{}, fmt.Errorf("could not resolve the file: %w", err)
	}
	if !withinAnyRoot(realPath, allowedRoots) {
		return OpenDocument{}, fmt.Errorf("the file does not belong to the project, the Go SDK or the module cache")
	}
	mediaType, isImage := imageMimeType(realPath)
	content, dataURL, info, token := "", "", (os.FileInfo)(nil), ""
	if isImage {
		dataURL, token, info, err = readImageFile(realPath)
	} else {
		content, info, token, err = readTextFile(realPath)
	}
	if err != nil {
		return OpenDocument{}, err
	}
	language := languageForPath(realPath)
	if isImage {
		language = "image"
	}
	document := Document{
		ID: stableDocumentID(session.ID, realPath), SessionID: session.ID, URI: fileURI(realPath), Path: realPath,
		RelativePath: filepath.ToSlash(realPath), Name: filepath.Base(realPath), Language: language,
		MediaType: mediaType, Version: 1, ReadOnly: true, External: true,
	}
	m.mu.Lock()
	m.documents[document.ID] = documentRecord{document: document, diskToken: token}
	m.mu.Unlock()
	return OpenDocument{Document: document, Content: content, DiskToken: token, ModifiedAt: info.ModTime().UTC(), DataURL: dataURL}, nil
}

func withinAnyRoot(path string, roots []string) bool {
	for _, root := range roots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		resolved, err := filepath.EvalSymlinks(root)
		if err != nil {
			continue
		}
		if ensureWithinRoot(resolved, path) == nil {
			return true
		}
	}
	return false
}

// CloseDocument rilascia il documento indicato senza toccare il file su disco.
// Get restituisce un documento aperto della sessione.
func (m *DocumentManager) Get(sessionID SessionID, documentID DocumentID) (Document, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	record, ok := m.documents[documentID]
	if !ok || record.document.SessionID != sessionID {
		return Document{}, false
	}
	return record.document, true
}

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

// ResolveProjectPath convalida un percorso esistente rispetto alla radice reale del progetto.
func (m *DocumentManager) ResolveProjectPath(project Project, candidate string) (string, error) {
	return m.resolveProjectPathLimit(project, candidate, MaxDocumentBytes)
}

func (m *DocumentManager) resolveProjectPathLimit(project Project, candidate string, limit int64) (string, error) {
	root := project.RealPath
	if root == "" {
		return "", fmt.Errorf("real project root unavailable")
	}
	path := candidate
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, filepath.FromSlash(path))
	}
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", fmt.Errorf("invalid document path: %w", err)
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("could not resolve the document: %w", err)
	}
	if err := ensureWithinRoot(root, realPath); err != nil {
		return "", err
	}
	info, err := os.Stat(realPath)
	if err != nil {
		return "", fmt.Errorf("could not read the document: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("the requested path is a folder")
	}
	if info.Size() > limit {
		return "", fmt.Errorf("document too large: limit %d bytes", limit)
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
		return "", fmt.Errorf("invalid folder path: %w", err)
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("could not resolve the folder: %w", err)
	}
	if err := ensureWithinRoot(project.RealPath, realPath); err != nil {
		return "", err
	}
	info, err := os.Stat(realPath)
	if err != nil {
		return "", fmt.Errorf("could not read the folder: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("the requested path is not a folder")
	}
	return realPath, nil
}

func ensureWithinRoot(root, candidate string) error {
	return project.EnsureWithin(root, candidate)
}

// imageMimeType restituisce il MIME di un'immagine supportata dall'anteprima, se il percorso ne ha l'estensione.
func imageMimeType(path string) (string, bool) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png", true
	case ".jpg", ".jpeg":
		return "image/jpeg", true
	case ".gif":
		return "image/gif", true
	case ".webp":
		return "image/webp", true
	case ".bmp":
		return "image/bmp", true
	case ".ico":
		return "image/x-icon", true
	case ".avif":
		return "image/avif", true
	case ".svg":
		return "image/svg+xml", true
	default:
		return "", false
	}
}

// readImageFile legge un'immagine come data URL base64, con lo stesso limite dei documenti testuali.
func readImageFile(path string) (string, string, os.FileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", "", nil, fmt.Errorf("could not read the image: %w", err)
	}
	if info.IsDir() {
		return "", "", nil, fmt.Errorf("the path is a folder")
	}
	if info.Size() > MaxDocumentBytes {
		return "", "", nil, fmt.Errorf("image too large: limit %d bytes", MaxDocumentBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", nil, fmt.Errorf("could not read the image: %w", err)
	}
	mime, ok := imageMimeType(path)
	if !ok {
		mime = "application/octet-stream"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), diskToken(data, info), info, nil
}

func readTextFile(path string) (string, os.FileInfo, string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", nil, "", fmt.Errorf("could not read the document: %w", err)
	}
	if info.Size() > MaxDocumentBytes {
		return "", nil, "", fmt.Errorf("document too large: limit %d bytes", MaxDocumentBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", nil, "", fmt.Errorf("could not read the document: %w", err)
	}
	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return "", nil, "", fmt.Errorf("the file is not a UTF-8 text document")
	}
	return string(data), info, diskToken(data, info), nil
}

// atomicWriteFile salva tramite il core condiviso (file temporaneo + rename con retry su Windows).
func atomicWriteFile(path string, data []byte, mode os.FileMode) error {
	return fileio.AtomicWriteFile(path, data, mode)
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

// languageByExtension mappa le estensioni sugli id dei linguaggi Monaco già
// inclusi nel bundle: solo colorazione, nessun language server oltre a gopls.
var languageByExtension = map[string]string{
	".go": "go", ".s": "goasm",
	".json": "json", ".jsonc": "json", ".yaml": "yaml", ".yml": "yaml",
	".md": "markdown", ".markdown": "markdown", ".mmd": "mermaid", ".mermaid": "mermaid",
	".html": "html", ".htm": "html", ".tmpl": "html", ".gohtml": "html",
	".css": "css", ".scss": "scss", ".less": "less",
	".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
	".ts": "typescript", ".tsx": "typescript", ".mts": "typescript",
	".xml": "xml", ".xsd": "xml", ".wsdl": "xml", ".svg": "xml",
	".sql": "sql", ".proto": "proto", ".graphql": "graphql", ".gql": "graphql",
	".sh": "shell", ".bash": "shell", ".zsh": "shell",
	".ps1": "powershell", ".psm1": "powershell", ".bat": "bat", ".cmd": "bat",
	".ini": "ini", ".toml": "ini", ".cfg": "ini", ".conf": "ini", ".properties": "ini",
	".py": "python", ".rs": "rust", ".java": "java", ".kt": "kotlin",
	".c": "cpp", ".h": "cpp", ".cpp": "cpp", ".hpp": "cpp",
	".tf": "hcl", ".hcl": "hcl", ".lua": "lua", ".rb": "ruby", ".php": "php",
	".dockerfile": "dockerfile", ".mk": "makefile",
}

func languageForPath(path string) string {
	base := strings.ToLower(filepath.Base(path))
	switch {
	case base == "go.mod" || base == "go.work":
		return "go"
	case base == "go.sum" || base == "go.work.sum":
		return "gosum"
	case base == ".env" || strings.HasPrefix(base, ".env."):
		return "ini"
	case base == "dockerfile" || strings.HasPrefix(base, "dockerfile.") || strings.HasSuffix(base, ".dockerfile") || base == "containerfile":
		return "dockerfile"
	case base == "makefile" || base == "gnumakefile" || strings.HasSuffix(base, ".mk"):
		return "makefile"
	}
	if language, ok := languageByExtension[filepath.Ext(base)]; ok {
		return language
	}
	return "plaintext"
}

func isIgnoredDirectory(name string) bool {
	return project.IgnoredDirectory(name)
}
