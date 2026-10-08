package goide

import (
	"adomnia/internal/plugins"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
)

type extensionHost struct {
	mu        sync.Mutex
	manager   *plugins.PluginManager
	languages map[string]plugins.Contribution
}

// SetExtensionManager attaches the optional plugin host; the IDE core stays independent.
func (s *Service) SetExtensionManager(manager *plugins.PluginManager) {
	s.extensions.mu.Lock()
	s.extensions.manager = manager
	s.extensions.mu.Unlock()
}

type pluginLanguage struct{ contribution plugins.Contribution }

func (p pluginLanguage) ID() string   { return p.contribution.ID }
func (p pluginLanguage) Name() string { return p.contribution.Title }
func (p pluginLanguage) DocumentLanguageID(path string) (string, bool) {
	for _, ext := range p.contribution.Extensions {
		if strings.EqualFold(filepath.Ext(path), ext) {
			return p.ID(), true
		}
	}
	return "", false
}

// IDEContributions reconciles live enabled extensions; removed/changed servers are stopped.
func (s *Service) IDEContributions() []plugins.Contribution {
	s.extensions.mu.Lock()
	defer s.extensions.mu.Unlock()
	if s.extensions.manager == nil {
		return []plugins.Contribution{}
	}
	items := s.extensions.manager.GetContributions()
	next := map[string]plugins.Contribution{}
	for _, c := range items {
		if c.Kind == "language" {
			if _, exists := next[c.ID]; !exists {
				next[c.ID] = c
			}
		}
	}
	for id, old := range s.extensions.languages {
		if fresh, exists := next[id]; exists && reflect.DeepEqual(old, fresh) {
			continue
		}
		for _, session := range s.workspace.ListSessions() {
			s.lsp.Stop(session.ID, id)
		}
		s.workspace.languages.Unregister(id)
	}
	for _, c := range items {
		id := c.ID
		if c.Kind != "language" || next[id].PluginID != c.PluginID {
			continue
		}
		if old, exists := s.extensions.languages[id]; exists && reflect.DeepEqual(old, c) {
			continue
		}
		if err := s.workspace.languages.Register(pluginLanguage{c}); err != nil {
			delete(next, id)
		}
	}
	s.extensions.languages = next
	visible := make([]plugins.Contribution, 0, len(items))
	for _, c := range items {
		if c.Kind != "language" || next[c.ID].PluginID == c.PluginID {
			visible = append(visible, c)
		}
	}
	return visible
}

func (s *Service) resolveProjectTemplate(id string) ([]fs.FS, ProjectTemplate, error) {
	if !strings.HasPrefix(id, "plugin:") {
		return resolveProjectTemplate(id)
	}
	for _, c := range s.IDEContributions() {
		if c.Kind != "template" || id != "plugin:"+c.PluginID+":"+c.ID {
			continue
		}
		s.extensions.mu.Lock()
		manager := s.extensions.manager
		s.extensions.mu.Unlock()
		source, err := plugins.ResolveIDETemplateFS(manager, c.PluginID, c.ID)
		return []fs.FS{source}, ProjectTemplate{ID: id, Name: c.Title, Custom: true}, err
	}
	return nil, ProjectTemplate{}, fmt.Errorf("plugin template unavailable")
}

type IDEExtensionRequest struct {
	SessionID  string `json:"sessionId"`
	PluginID   string `json:"pluginId"`
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	DocumentID string `json:"documentId"`
	Text       string `json:"text"`
	Selection  any    `json:"selection,omitempty"`
}

// InvokeIDEExtension delivers a bounded IDE context to a declared sandboxed action.
func (s *Service) InvokeIDEExtension(request IDEExtensionRequest) (plugins.ExecResult, error) {
	session, err := s.session(request.SessionID)
	if err != nil {
		return plugins.ExecResult{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return plugins.ExecResult{}, fmt.Errorf("trust the project before running extensions")
	}
	if len(request.Text) > 1<<20 {
		return plugins.ExecResult{}, fmt.Errorf("extension input exceeds 1 MiB")
	}
	args := map[string]interface{}{"apiVersion": 1, "sessionId": request.SessionID, "projectRoot": session.Project.RealPath, "text": request.Text, "selection": request.Selection}
	if request.DocumentID != "" {
		document, ok := s.documents.Get(session.ID, DocumentID(request.DocumentID))
		if !ok {
			return plugins.ExecResult{}, fmt.Errorf("document does not belong to the session")
		}
		if document.External || document.ReadOnly {
			return plugins.ExecResult{}, fmt.Errorf("external/read-only documents are not extension inputs")
		}
		args["relativePath"] = document.RelativePath
	}
	for _, c := range s.IDEContributions() {
		if c.PluginID == request.PluginID && c.ID == request.ID && c.Kind == request.Kind && (c.Kind == "command" || c.Kind == "codeAction" || c.Kind == "analyzer") {
			s.extensions.mu.Lock()
			manager := s.extensions.manager
			s.extensions.mu.Unlock()
			return manager.ExecuteAction(c.PluginID, c.Action, args), nil
		}
	}
	return plugins.ExecResult{}, fmt.Errorf("extension action unavailable")
}

func (s *Service) StartExtensionLanguageServer(sessionID, languageID string) (LanguageServerStatus, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return LanguageServerStatus{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return LanguageServerStatus{}, fmt.Errorf("trust the project before starting a language server")
	}
	for _, c := range s.IDEContributions() {
		if c.Kind != "language" || c.ID != languageID || c.Server == nil {
			continue
		}
		binary, err := exec.LookPath(c.Server.Command)
		if err != nil {
			return LanguageServerStatus{}, err
		}
		s.documents.mu.RLock()
		documents := []Document{}
		for _, record := range s.documents.documents {
			if record.document.SessionID == session.ID && !record.document.External && !record.document.ReadOnly {
				documents = append(documents, record.document)
			}
		}
		s.documents.mu.RUnlock()
		for _, document := range documents {
			if owner, _, ok := s.workspace.languages.ForPath(document.Path); ok && owner.ID() == languageID {
				if content, err := os.ReadFile(document.Path); err == nil {
					s.lsp.TrackDocument(session, document, string(content), false)
				}
			}
		}
		return s.lsp.Start(session, LanguageServerOptions{Language: c.ID, Name: c.Title, Binary: binary, Arguments: c.Server.Arguments})
	}
	return LanguageServerStatus{}, fmt.Errorf("extension language server unavailable")
}

func (s *Service) ExtensionLanguageStatus(sessionID, languageID string) (LanguageServerStatus, error) {
	if _, err := s.session(sessionID); err != nil {
		return LanguageServerStatus{}, err
	}
	s.IDEContributions()
	return s.lsp.Status(SessionID(sessionID), languageID), nil
}

func (s *Service) StopExtensionLanguageServer(sessionID, languageID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	if languageID == "go" {
		return fmt.Errorf("use the built-in Go server controls")
	}
	s.lsp.Stop(SessionID(sessionID), languageID)
	return nil
}

// RemoteSourceFiles returns the complete indexed source set, never a truncated guess.
func (s *Service) RemoteSourceFiles(sessionID string) ([]string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	files, err := s.documents.projectFiles(session.Project)
	if err != nil {
		return nil, err
	}
	if len(files) >= MaxQuickOpenFiles {
		return nil, fmt.Errorf("source index is incomplete; narrow the project before linking remote logs")
	}
	paths := []string{}
	for _, file := range files {
		if strings.HasSuffix(file.relative, ".go") {
			paths = append(paths, file.relative)
		}
	}
	return paths, nil
}
