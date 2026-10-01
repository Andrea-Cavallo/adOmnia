package copilot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"adomnia/internal/goide/lsp"
)

const (
	maxChatMessageBytes   = 64 * 1024
	maxWorkspaceFiles     = 500
	maxWorkspaceOpenBytes = 48 * 1024
	chatRequestTimeout    = 10 * time.Minute
)

// ChatSelection usa posizioni LSP zero-based. Il testo viene ricavato dal buffer sincronizzato,
// mai accettato dal renderer: il filtro segreti resta un solo confine nel backend.
type ChatSelection struct {
	StartLine      int `json:"startLine"`
	StartCharacter int `json:"startCharacter"`
	EndLine        int `json:"endLine"`
	EndCharacter   int `json:"endCharacter"`
}

// ChatRequest descrive un turno Ask. Token è generato dal frontend e collega progress/cancel.
type ChatRequest struct {
	Token            string         `json:"token"`
	ConversationID   string         `json:"conversationId,omitempty"`
	TurnID           string         `json:"turnId,omitempty"`
	Message          string         `json:"message"`
	DocumentID       string         `json:"documentId,omitempty"`
	Selection        *ChatSelection `json:"selection,omitempty"`
	IncludeDocument  bool           `json:"includeDocument"`
	IncludeWorkspace bool           `json:"includeWorkspace"`
}

type ChatResponse struct {
	ConversationID string `json:"conversationId"`
	TurnID         string `json:"turnId,omitempty"`
	Token          string `json:"token"`
	Model          string `json:"model,omitempty"`
}

// ChatEvent è un delta streaming già normalizzato per il renderer.
type ChatEvent struct {
	Token          string `json:"token"`
	Kind           string `json:"kind"`
	Reply          string `json:"reply,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	TurnID         string `json:"turnId,omitempty"`
	Title          string `json:"title,omitempty"`
	Error          string `json:"error,omitempty"`
}

type chatModel struct {
	ID            string   `json:"id"`
	Scopes        []string `json:"scopes"`
	IsChatDefault bool     `json:"isChatDefault"`
}

type chatProgressEnvelope struct {
	Token string          `json:"token"`
	Value json.RawMessage `json:"value"`
}

type chatProgressValue struct {
	Kind            string `json:"kind"`
	Reply           string `json:"reply"`
	ConversationID  string `json:"conversationId"`
	TurnID          string `json:"turnId"`
	SuggestedTitle  string `json:"suggestedTitle"`
	EditAgentRounds []struct {
		Reply string `json:"reply"`
	} `json:"editAgentRounds"`
	Result *struct {
		Error json.RawMessage `json:"error"`
	} `json:"result"`
}

type chatOperation struct {
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.Mutex
	ended  bool
}

func (operation *chatOperation) finish() bool {
	operation.mu.Lock()
	defer operation.mu.Unlock()
	if operation.ended {
		return false
	}
	operation.ended = true
	close(operation.done)
	return true
}

func (operation *chatOperation) active() bool {
	operation.mu.Lock()
	defer operation.mu.Unlock()
	return !operation.ended
}

// Chat invia un turno Ask. La chiamata resta cancellabile e i delta arrivano come copilot.chat.
func (m *Manager) Chat(parent context.Context, request ChatRequest) (ChatResponse, error) {
	request.Token = strings.TrimSpace(request.Token)
	request.Message = strings.TrimSpace(request.Message)
	if request.Token == "" || request.Message == "" {
		return ChatResponse{}, errors.New("chat token and message are required")
	}
	if len(request.Message) > maxChatMessageBytes {
		return ChatResponse{}, fmt.Errorf("chat message exceeds %d KiB", maxChatMessageBytes/1024)
	}
	if m.Status().State != StateReady {
		return ChatResponse{}, errors.New("GitHub Copilot is not ready; sign in first")
	}
	conn, err := m.connection()
	if err != nil {
		return ChatResponse{}, err
	}

	ctx, cancel := context.WithTimeout(parent, chatRequestTimeout)
	operation := &chatOperation{cancel: cancel, done: make(chan struct{})}
	m.mu.Lock()
	if _, exists := m.chatOperations[request.Token]; exists {
		m.mu.Unlock()
		cancel()
		return ChatResponse{}, errors.New("chat token is already active")
	}
	m.chatOperations[request.Token] = operation
	m.mu.Unlock()
	defer func() {
		cancel()
		m.mu.Lock()
		delete(m.chatOperations, request.Token)
		m.mu.Unlock()
	}()

	message, doc, folders, err := m.chatContext(request)
	if err != nil {
		return ChatResponse{}, err
	}
	model, err := m.defaultChatModel(conn)
	if err != nil {
		return ChatResponse{}, err
	}
	params := map[string]any{
		"workDoneToken":    request.Token,
		"source":           "panel",
		"workspaceFolders": folders,
	}
	if model != "" {
		params["model"] = model
		params["modelInfo"] = map[string]string{"id": model}
	}
	if doc != nil {
		params["doc"] = doc
		params["textDocument"] = doc
	}

	method := "conversation/turn"
	if request.ConversationID == "" {
		method = "conversation/create"
		params["turns"] = []map[string]string{{"request": message, "response": "", "turnId": ""}}
		params["capabilities"] = map[string]any{"skills": []string{"current-editor"}, "allSkills": false}
	} else {
		params["conversationId"] = request.ConversationID
		params["message"] = message
		if request.TurnID != "" {
			params["turnId"] = request.TurnID
		}
	}

	var response ChatResponse
	if err := conn.Call(ctx, method, params, &response); err != nil {
		if lsp.IsCancelled(err) {
			return ChatResponse{}, context.Canceled
		}
		return ChatResponse{}, friendlyError(err, m.Status().Profile)
	}
	response.Token = request.Token
	response.Model = model
	select {
	case <-operation.done:
	case <-ctx.Done():
		return ChatResponse{}, ctx.Err()
	}
	return response, nil
}

// CancelChat annulla la richiesta JSON-RPC: Conn invia $/cancelRequest con l'id corretto.
func (m *Manager) CancelChat(token string) bool {
	m.mu.Lock()
	operation := m.chatOperations[token]
	m.mu.Unlock()
	if operation == nil || !operation.finish() {
		return false
	}
	operation.cancel()
	m.publish("copilot.chat", ChatEvent{Token: token, Kind: "end", Error: "Cancelled"})
	return true
}

// DestroyChat libera la conversazione nel Language Server. È best effort: una nuova chat non deve bloccarsi.
func (m *Manager) DestroyChat(conversationID string) {
	if strings.TrimSpace(conversationID) == "" {
		return
	}
	conn, err := m.connection()
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	_ = conn.Call(ctx, "conversation/destroy", map[string]string{"conversationId": conversationID}, nil)
}

func (m *Manager) defaultChatModel(conn *lsp.Conn) (string, error) {
	m.mu.Lock()
	if m.chatModelResolved {
		model := m.chatModel
		m.mu.Unlock()
		return model, nil
	}
	m.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var models []chatModel
	if err := conn.Call(ctx, "copilot/models", map[string]any{}, &models); err != nil {
		return "", fmt.Errorf("cannot resolve a Copilot chat model: %w", err)
	}
	filtered := make([]chatModel, 0, len(models))
	for _, model := range models {
		for _, scope := range model.Scopes {
			if scope == "chat-panel" {
				filtered = append(filtered, model)
				break
			}
		}
	}
	selected := ""
	for _, model := range filtered {
		if model.IsChatDefault {
			selected = model.ID
			break
		}
	}
	if selected == "" {
		for _, model := range filtered {
			if model.ID == "auto" {
				selected = model.ID
				break
			}
		}
	}
	if selected == "" && len(filtered) > 0 {
		selected = filtered[0].ID
	}
	if selected == "" {
		return "", errors.New("no Copilot chat model is available for this account")
	}
	m.mu.Lock()
	m.chatModel = selected
	m.chatModelResolved = true
	m.mu.Unlock()
	return selected, nil
}

func (m *Manager) chatContext(request ChatRequest) (string, map[string]any, []map[string]string, error) {
	m.mu.Lock()
	tracked := m.trackedLocked(request.DocumentID)
	var current *document
	if tracked != nil {
		copy := *tracked
		current = &copy
	}
	root := m.root
	m.mu.Unlock()
	if current != nil {
		root = current.root
	}
	folders := []map[string]string{}
	if request.IncludeWorkspace && root != "" {
		folders = append(folders, map[string]string{
			"uri":  fileURI(root),
			"name": filepath.Base(root),
		})
	}

	parts := []string{request.Message}
	var doc map[string]any
	if request.IncludeDocument && current != nil {
		doc = contextDoc(*current, request.Selection)
		parts = append(parts, "\n<adomnia_current_file path=\""+current.relativePath+"\">\n"+boundedText(current.text, maxWorkspaceOpenBytes)+"\n</adomnia_current_file>")
	}
	if request.Selection != nil {
		if current == nil {
			return "", nil, nil, errors.New("the selected code is no longer open")
		}
		selected, ok := selectionText(current.text, *request.Selection)
		if !ok {
			return "", nil, nil, errors.New("the selected code changed; select it again")
		}
		parts = append(parts, fmt.Sprintf("\n<adomnia_selection path=\"%s\" lines=\"%d-%d\">\n%s\n</adomnia_selection>", current.relativePath, request.Selection.StartLine+1, request.Selection.EndLine+1, selected))
	}
	if request.IncludeWorkspace && root != "" {
		parts = append(parts, buildWorkspaceManifest(root))
	}
	return strings.Join(parts, "\n"), doc, folders, nil
}

func contextDoc(doc document, selection *ChatSelection) map[string]any {
	position := map[string]int{"line": 0, "character": 0}
	if selection != nil {
		position = map[string]int{"line": selection.EndLine, "character": selection.EndCharacter}
	}
	return map[string]any{
		"version": doc.version, "tabSize": 4, "indentSize": 4, "insertSpaces": true,
		"path": doc.path, "uri": doc.uri, "relativePath": doc.relativePath,
		"languageId": doc.languageID, "position": position, "source": boundedText(doc.text, maxWorkspaceOpenBytes),
	}
}

func (m *Manager) currentEditorContext() any {
	m.mu.Lock()
	tracked := m.documents[m.focusedURI]
	if tracked == nil {
		m.mu.Unlock()
		return nil
	}
	copy := *tracked
	m.mu.Unlock()
	return contextDoc(copy, nil)
}

func (m *Manager) handleChatProgress(raw json.RawMessage) {
	var envelope chatProgressEnvelope
	if json.Unmarshal(raw, &envelope) != nil || envelope.Token == "" {
		return
	}
	m.mu.Lock()
	operation := m.chatOperations[envelope.Token]
	m.mu.Unlock()
	if operation == nil || !operation.active() {
		return
	}
	var value chatProgressValue
	if json.Unmarshal(envelope.Value, &value) != nil {
		return
	}
	reply := value.Reply
	if reply == "" && len(value.EditAgentRounds) > 0 {
		reply = value.EditAgentRounds[len(value.EditAgentRounds)-1].Reply
	}
	event := ChatEvent{Token: envelope.Token, Kind: value.Kind, Reply: reply, ConversationID: value.ConversationID, TurnID: value.TurnID, Title: value.SuggestedTitle}
	if value.Result != nil && len(value.Result.Error) > 0 && string(value.Result.Error) != "null" {
		var message string
		if json.Unmarshal(value.Result.Error, &message) != nil {
			var structured struct {
				Message string `json:"message"`
			}
			if json.Unmarshal(value.Result.Error, &structured) == nil {
				message = structured.Message
			}
		}
		event.Error = message
	}
	if value.Kind == "end" && !operation.finish() {
		return
	}
	m.publish("copilot.chat", event)
}

func buildWorkspaceManifest(root string) string {
	filter := LoadContextFilter(root)
	paths := make([]string, 0, 128)
	limitReached := errors.New("workspace manifest limit reached")
	err := filepath.WalkDir(root, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		relative, err := filepath.Rel(root, filePath)
		if err != nil || relative == "." {
			return nil
		}
		relative = filepath.ToSlash(relative)
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", "node_modules", "vendor", "dist", "build", ".idea", ".vscode":
				return filepath.SkipDir
			}
			if filter.Excluded(relative) {
				return filepath.SkipDir
			}
			return nil
		}
		if filter.Excluded(relative) || len(paths) >= maxWorkspaceFiles {
			return nil
		}
		info, err := entry.Info()
		if err == nil && info.Size() <= maxDocumentBytes {
			paths = append(paths, relative)
			if len(paths) == maxWorkspaceFiles {
				return limitReached
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, limitReached) {
		return "\n<adomnia_workspace_manifest unavailable=\"true\" />"
	}
	sort.Strings(paths)
	var builder strings.Builder
	builder.WriteString("\n<adomnia_workspace_manifest>\n")
	builder.WriteString(strings.Join(paths, "\n"))
	builder.WriteString("\n</adomnia_workspace_manifest>")
	return builder.String()
}

func selectionText(text string, selection ChatSelection) (string, bool) {
	lines := strings.Split(text, "\n")
	if selection.StartLine < 0 || selection.EndLine < selection.StartLine || selection.EndLine >= len(lines) {
		return "", false
	}
	selected := append([]string(nil), lines[selection.StartLine:selection.EndLine+1]...)
	start := byteOffsetForUTF16(selected[0], selection.StartCharacter)
	end := byteOffsetForUTF16(selected[len(selected)-1], selection.EndCharacter)
	if start < 0 || end < 0 || (len(selected) == 1 && end < start) {
		return "", false
	}
	if len(selected) == 1 {
		return selected[0][start:end], true
	}
	selected[0] = selected[0][start:]
	selected[len(selected)-1] = selected[len(selected)-1][:end]
	return strings.Join(selected, "\n"), true
}

func byteOffsetForUTF16(line string, units int) int {
	if units < 0 {
		return -1
	}
	used := 0
	for index, runeValue := range line {
		if used == units {
			return index
		}
		if runeValue > 0xffff {
			used += 2
		} else {
			used++
		}
		if used > units {
			return -1
		}
	}
	if used == units {
		return len(line)
	}
	return -1
}

func boundedText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	for limit > 0 && text[limit]&0xc0 == 0x80 {
		limit--
	}
	return text[:limit] + "\n… [truncated by adOmnia]"
}
