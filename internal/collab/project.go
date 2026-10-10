package collab

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	ideproject "adomnia/internal/ide/project"
	"gopkg.in/yaml.v3"
)

const EventProject = "project"
const eventProjectRequest = "project.request"
const eventProjectResponse = "project.response"

type ProjectInfo struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	SourceSessionID string `json:"sourceSessionId,omitempty"`
}
type ProjectEntry struct {
	Path      string `json:"path"`
	Directory bool   `json:"directory"`
}
type ProjectFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}
type sharedProject struct {
	info ProjectInfo
	root string
}
type projectRequest struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Path      string `json:"path"`
	Tree      bool   `json:"tree"`
}
type projectResponse struct {
	ID      string         `json:"id"`
	Entries []ProjectEntry `json:"entries,omitempty"`
	File    ProjectFile    `json:"file"`
	Error   string         `json:"error,omitempty"`
}

// Code cannot be redacted without changing program semantics: known secret files
// and credential material are refused, with no opt-in for project transfer.
var codeCredential = regexp.MustCompile(`(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|vault:[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|sk_live_[A-Za-z0-9]{16,}|(?:password|passwd|api_key|apikey|client_secret|access_token)\s*[:=]\s*["'][^"'\s]{4,}["'])`)

func privateProjectPath(path string) bool {
	for _, part := range strings.Split(filepath.ToSlash(path), "/") {
		lower := strings.ToLower(part)
		if ideproject.IgnoredDirectory(lower) || lower == ".env" || strings.HasPrefix(lower, ".env.") || lower == ".ssh" || lower == ".aws" || lower == ".adomnia" || lower == "credentials" || lower == "credentials.json" || lower == "id_rsa" || lower == "id_ed25519" {
			return true
		}
		switch strings.ToLower(filepath.Ext(part)) {
		case ".key", ".pem", ".crt", ".cer", ".pfx", ".p12", ".jks", ".db", ".sqlite", ".sqlite3":
			return true
		}
	}
	return false
}

func projectPath(root, relative string) (string, error) {
	if relative == "" || filepath.IsAbs(relative) || strings.Contains(relative, ":") || strings.Contains(relative, "\x00") || privateProjectPath(relative) {
		return "", errors.New("file escluso dalla condivisione")
	}
	candidate := filepath.Join(root, filepath.FromSlash(relative))
	if ideproject.EnsureWithin(root, candidate) != nil {
		return "", errors.New("path fuori dal progetto")
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil || ideproject.EnsureWithin(root, resolved) != nil {
		return "", errors.New("file non disponibile nel progetto")
	}
	resolvedRelative, err := filepath.Rel(root, resolved)
	if err != nil || privateProjectPath(resolvedRelative) {
		return "", errors.New("destinazione privata esclusa dalla condivisione")
	}
	return resolved, nil
}

func hasProjectCredentials(path string, data []byte) bool {
	if codeCredential.Match(data) {
		return true
	}
	var decoded any
	switch strings.ToLower(filepath.Ext(path)) {
	case ".json":
		if json.Unmarshal(data, &decoded) != nil {
			return false
		}
	case ".yaml", ".yml":
		if yaml.Unmarshal(data, &decoded) != nil {
			return false
		}
	default:
		return false
	}
	encoded, err := json.Marshal(decoded)
	if err != nil {
		return true
	}
	_, paths, err := Redact(encoded)
	return err != nil || len(paths) > 0
}

func (m *Manager) ShareProject(root string, sessionIDs ...string) (ProjectInfo, error) {
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		return ProjectInfo{}, errors.New("progetto non disponibile")
	}
	real, err = filepath.Abs(real)
	if err != nil {
		return ProjectInfo{}, err
	}
	stat, err := os.Stat(real)
	if err != nil || !stat.IsDir() {
		return ProjectInfo{}, errors.New("progetto non valido")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.mode != ModeHost {
		return ProjectInfo{}, errNotHost
	}
	if m.project != nil {
		return ProjectInfo{}, errors.New("chiudi la sessione per cambiare progetto condiviso")
	}
	info := ProjectInfo{ID: randomToken(8), Name: filepath.Base(real)}
	if len(sessionIDs) > 0 {
		info.SourceSessionID = sessionIDs[0]
	}
	m.project = &sharedProject{info: info, root: real}
	m.projectInfo = &info
	e := m.nextLocked(Event{Type: EventProject, From: m.self.ID, Payload: mustJSON(info)})
	for _, p := range m.peers {
		p.enqueue(e)
	}
	audit("project.shared", m.sessionID, m.self.ID, m.self.Role, "")
	return info, nil
}

func (m *Manager) ValidateProjectDocument(path, content string) error {
	m.mu.Lock()
	p := m.project
	host := m.mode == ModeHost
	m.mu.Unlock()
	if !host || p == nil {
		return errNotHost
	}
	if r := readProject(p, projectRequest{ProjectID: p.info.ID, Path: path}); r.Error != "" {
		return errors.New(r.Error)
	}
	if len(content) > maxDocumentUpdate || !utf8.ValidString(content) || hasProjectCredentials(path, []byte(content)) {
		return errors.New("contenuto escluso dalla condivisione")
	}
	return nil
}

func readProject(p *sharedProject, q projectRequest) projectResponse {
	result := projectResponse{ID: q.ID}
	if p == nil || q.ProjectID != p.info.ID {
		result.Error = "progetto non condiviso"
		return result
	}
	if q.Tree {
		entries := []ProjectEntry{}
		err := filepath.WalkDir(p.root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if path == p.root {
				return nil
			}
			relative, _ := filepath.Rel(p.root, path)
			// Exclude symlinks completely from discovery; explicit reads still revalidate them.
			if privateProjectPath(relative) || d.Type()&os.ModeSymlink != 0 {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if len(entries) >= 5000 {
				return errors.New("progetto troppo grande: massimo 5000 elementi")
			}
			entries = append(entries, ProjectEntry{Path: filepath.ToSlash(relative), Directory: d.IsDir()})
			return nil
		})
		if err != nil {
			result.Error = "albero progetto non disponibile o oltre il limite"
		} else {
			result.Entries = entries
		}
		return result
	}
	path, err := projectPath(p.root, q.Path)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	f, err := os.Open(path)
	if err != nil {
		result.Error = "file non disponibile"
		return result
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > maxDocumentUpdate {
		result.Error = "file escluso: tipo o dimensione non supportati"
		return result
	}
	data, err := io.ReadAll(io.LimitReader(f, maxDocumentUpdate+1))
	if err != nil || len(data) > maxDocumentUpdate || !utf8.Valid(data) || strings.ContainsRune(string(data), 0) {
		result.Error = "file binario o troppo grande"
		return result
	}
	if hasProjectCredentials(path, data) {
		result.Error = "file escluso: contiene materiale credenziale"
		return result
	}
	result.File = ProjectFile{Path: filepath.ToSlash(q.Path), Content: string(data)}
	return result
}

func (m *Manager) projectQuery(path string, tree bool) (projectResponse, error) {
	m.mu.Lock()
	if m.projectInfo == nil {
		m.mu.Unlock()
		return projectResponse{}, errors.New("nessun progetto condiviso")
	}
	q := projectRequest{ID: randomToken(8), ProjectID: m.projectInfo.ID, Path: path, Tree: tree}
	if m.mode == ModeHost {
		p := m.project
		m.mu.Unlock()
		r := readProject(p, q)
		if r.Error != "" {
			return r, errors.New(r.Error)
		}
		return r, nil
	}
	if m.mode != ModeGuest || m.host == nil {
		m.mu.Unlock()
		return projectResponse{}, errors.New("connessione non disponibile")
	}
	if m.pendingProjects == nil {
		m.pendingProjects = map[string]chan projectResponse{}
	}
	if len(m.pendingProjects) >= 16 {
		m.mu.Unlock()
		return projectResponse{}, errors.New("troppe letture simultanee")
	}
	done := make(chan projectResponse, 1)
	m.pendingProjects[q.ID] = done
	p := m.host
	m.mu.Unlock()
	defer func() { m.mu.Lock(); delete(m.pendingProjects, q.ID); m.mu.Unlock() }()
	if !p.enqueue(Event{Type: eventProjectRequest, Payload: mustJSON(q)}) {
		return projectResponse{}, errors.New("connessione persa")
	}
	select {
	case r := <-done:
		if r.Error != "" {
			return r, errors.New(r.Error)
		}
		return r, nil
	case <-p.done:
		return projectResponse{}, errors.New("sessione chiusa")
	case <-time.After(10 * time.Second):
		return projectResponse{}, errors.New("lettura progetto scaduta")
	}
}

func (m *Manager) ProjectTree() ([]ProjectEntry, error) {
	r, err := m.projectQuery("", true)
	return r.Entries, err
}
func (m *Manager) ReadProjectFile(path string) (ProjectFile, error) {
	r, err := m.projectQuery(path, false)
	return r.File, err
}

func (m *Manager) serveProject(from string, payload json.RawMessage) {
	var q projectRequest
	if json.Unmarshal(payload, &q) != nil || len(q.ID) > 128 || q.ID == "" || len(q.Path) > 4096 {
		return
	}
	m.mu.Lock()
	p := m.peers[from]
	project := m.project
	session := m.sessionID
	m.mu.Unlock()
	if p == nil {
		return
	}
	response := readProject(project, q)
	// Revalidate after filesystem IO: no publication after revocation/session replacement.
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.mode != ModeHost || m.sessionID != session || m.peers[from] != p {
		return
	}
	p.enqueue(m.nextLocked(Event{Type: eventProjectResponse, From: m.self.ID, Payload: mustJSON(response)}))
}
