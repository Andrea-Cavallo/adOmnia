package milk

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"time"
)

// handler riceve notifiche e richieste di milk e le traduce in eventi adOmnia.
type handler struct {
	manager *Manager
}

// HandleNotification elabora session/update e le notifiche estese _milk/*.
func (h *handler) HandleNotification(method string, params json.RawMessage) {
	switch method {
	case "session/update":
		h.handleSessionUpdate(params)
	case "_milk/route":
		h.handleRoute(params)
	case "_milk/warning":
		h.handleWarning(params)
	}
}

func (h *handler) handleSessionUpdate(params json.RawMessage) {
	var notification struct {
		SessionID string          `json:"sessionId"`
		Update    json.RawMessage `json:"update"`
	}
	if json.Unmarshal(params, &notification) != nil {
		return
	}
	var discriminator struct {
		SessionUpdate string `json:"sessionUpdate"`
	}
	if json.Unmarshal(notification.Update, &discriminator) != nil {
		return
	}
	token := h.manager.tokenForSession(notification.SessionID)
	if token == "" {
		return
	}
	root := h.manager.rootForSession(notification.SessionID)
	switch discriminator.SessionUpdate {
	case "state_update":
		var update struct {
			State      string `json:"state"`
			StopReason string `json:"stopReason"`
		}
		if json.Unmarshal(notification.Update, &update) != nil {
			return
		}
		switch update.State {
		case "running":
			h.manager.publish("chat", ChatEvent{Token: token, Root: root, SessionID: notification.SessionID, Kind: "begin"})
		case "idle":
			h.manager.publish("chat", ChatEvent{Token: token, Root: root, SessionID: notification.SessionID, Kind: "end", StopReason: update.StopReason})
		}
	case "agent_message_chunk", "agent_thought_chunk":
		kind := "text"
		if discriminator.SessionUpdate == "agent_thought_chunk" {
			kind = "thought"
		}
		var update struct {
			Content struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if json.Unmarshal(notification.Update, &update) != nil {
			return
		}
		if update.Content.Text != "" {
			h.manager.publish("chat", ChatEvent{Token: token, Root: root, SessionID: notification.SessionID, Kind: kind, Reply: update.Content.Text})
		}
	case "tool_call", "tool_call_update":
		// milk manda name; ACP v1 manda title ("Read `main.go`"), più leggibile.
		var update struct {
			ToolCallID string          `json:"toolCallId"`
			Name       string          `json:"name"`
			Title      string          `json:"title"`
			Status     string          `json:"status"`
			RawOutput  json.RawMessage `json:"rawOutput"`
		}
		if json.Unmarshal(notification.Update, &update) != nil {
			return
		}
		name := update.Title
		if name == "" {
			name = update.Name
		}
		tool := &ToolUpdate{ToolCallID: update.ToolCallID, Name: name, Status: update.Status, RawOutput: summarizeRaw(update.RawOutput)}
		h.manager.publish("chat", ChatEvent{Token: token, Root: root, SessionID: notification.SessionID, Kind: "tool", Tool: tool})
	case "tool_call_content_chunk":
		var update struct {
			ToolCallID string `json:"toolCallId"`
			Content    struct {
				Type    string `json:"type"`
				Content *struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"content"`
		}
		if json.Unmarshal(notification.Update, &update) != nil {
			return
		}
		output := ""
		if update.Content.Content != nil {
			output = update.Content.Content.Text
		}
		tool := &ToolUpdate{ToolCallID: update.ToolCallID, Status: "in_progress", RawOutput: output}
		h.manager.publish("chat", ChatEvent{Token: token, Root: root, SessionID: notification.SessionID, Kind: "tool", Tool: tool})
	}
}

func (h *handler) handleRoute(params json.RawMessage) {
	var route struct {
		Agent  string `json:"agent"`
		Target string `json:"target"`
		Reason string `json:"reason"`
	}
	if json.Unmarshal(params, &route) != nil {
		return
	}
	token := h.manager.soleToken()
	if token == "" {
		return
	}
	h.manager.publish("chat", ChatEvent{Token: token, Kind: "route", Route: &RouteInfo{Agent: route.Agent, Target: route.Target, Reason: route.Reason}})
}

func (h *handler) handleWarning(params json.RawMessage) {
	var warning struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(params, &warning) != nil {
		return
	}
	token := h.manager.soleToken()
	if token == "" {
		return
	}
	h.manager.publish("chat", ChatEvent{Token: token, Kind: "warning", Reply: warning.Message})
}

// HandleRequest risponde a session/request_permission; gli altri metodi sono non supportati.
func (h *handler) HandleRequest(ctx context.Context, method string, params json.RawMessage) (any, error) {
	if method != "session/request_permission" {
		return nil, ErrMethodNotFound
	}
	var request struct {
		SessionID   string `json:"sessionId"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Options     []struct {
			OptionID string `json:"optionId"`
			Name     string `json:"name"`
			Kind     string `json:"kind"`
		} `json:"options"`
		Subject *struct {
			ToolCall struct {
				ToolCallID string `json:"toolCallId"`
			} `json:"toolCall"`
		} `json:"subject"`
		// v1 porta il tool call in un campo dedicato, non in subject.
		ToolCall *struct {
			ToolCallID string `json:"toolCallId"`
			Title      string `json:"title"`
		} `json:"toolCall"`
	}
	if json.Unmarshal(params, &request) != nil {
		return nil, ErrMethodNotFound
	}
	allowID, denyID := permissionOptionIDs(request.Options)
	if h.manager.skipPermissions() {
		return permissionResponse(allowID), nil
	}

	requestID := newRequestID()
	toolCallID := ""
	if request.Subject != nil {
		toolCallID = request.Subject.ToolCall.ToolCallID
	} else if request.ToolCall != nil {
		toolCallID = request.ToolCall.ToolCallID
		if request.Title == "" {
			request.Title = request.ToolCall.Title
		}
	}
	options := make([]PermissionOption, 0, len(request.Options))
	for _, option := range request.Options {
		options = append(options, PermissionOption{OptionID: option.OptionID, Name: option.Name, Kind: option.Kind})
	}
	perm := &permission{ch: make(chan bool, 1)}
	h.manager.mu.Lock()
	h.manager.pending[requestID] = perm
	h.manager.mu.Unlock()
	defer func() {
		// Risposta, timeout o annullamento: la richiesta non è più attiva.
		h.manager.mu.Lock()
		delete(h.manager.pending, requestID)
		h.manager.mu.Unlock()
		h.manager.publish("permissionResolved", map[string]string{"requestId": requestID})
	}()
	h.manager.publish("permission", PermissionEvent{
		RequestID: requestID, SessionID: request.SessionID, ToolCallID: toolCallID,
		Title: request.Title, Description: request.Description, Options: options,
	})

	timeout := time.NewTimer(permissionTimeout)
	defer timeout.Stop()
	select {
	case allow := <-perm.ch:
		if allow {
			return permissionResponse(allowID), nil
		}
		return permissionResponse(denyID), nil
	case <-ctx.Done():
		return permissionResponse(denyID), nil
	case <-timeout.C:
		return permissionResponse(denyID), nil
	}
}

func permissionOptionIDs(options []struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
}) (allowID, denyID string) {
	for _, option := range options {
		switch option.Kind {
		case "allow_once", "allow_always":
			if allowID == "" {
				allowID = option.OptionID
			}
		case "reject_once", "reject_always":
			if denyID == "" {
				denyID = option.OptionID
			}
		}
	}
	// Senza un'opzione del tipo giusto la risposta è "cancelled" (optionId vuoto):
	// un id inventato non sarebbe riconosciuto da milk.
	return allowID, denyID
}

func permissionResponse(optionID string) map[string]any {
	if optionID == "" {
		return map[string]any{"outcome": map[string]any{"outcome": "cancelled"}}
	}
	return map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": optionID}}
}

// tokenForSession restituisce il token del turno attivo per una sessione.
func (m *Manager) tokenForSession(sessionID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.turns[sessionID]
}

func (m *Manager) rootForSession(sessionID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rootBySession[sessionID]
}

// soleToken restituisce l'unico turno attivo, o "" se non è unico.
func (m *Manager) soleToken() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.turns) != 1 {
		return ""
	}
	for _, token := range m.turns {
		return token
	}
	return ""
}

func newRequestID() string {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return time.Now().Format("perm-150405.000000000")
	}
	return hex.EncodeToString(raw)
}

// summarizeRaw normalizza un rawOutput arbitrario (stringa o oggetto) in testo
// leggibile, senza mai fallire la decodifica dell'evento.
func summarizeRaw(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return string(raw)
	}
	if text, ok := value.(string); ok {
		return text
	}
	data, err := json.Marshal(value)
	if err != nil {
		return string(raw)
	}
	return string(data)
}
