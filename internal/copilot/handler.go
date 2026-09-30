package copilot

import (
	"context"
	"encoding/json"

	"adomnia/internal/goide/lsp"
)

// handler riceve notifiche e richieste del Copilot Language Server; ignora quelle di processi superati.
type handler struct {
	manager *Manager
	process *process
}

type serverStatus struct {
	Busy    bool   `json:"busy"`
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

func (h *handler) HandleNotification(method string, params json.RawMessage) {
	if !h.manager.isCurrent(h.process) {
		return
	}
	switch method {
	case "didChangeStatus":
		var status serverStatus
		if json.Unmarshal(params, &status) == nil {
			h.manager.applyServerStatus(status)
		}
	case "window/logMessage":
		var message Message
		if json.Unmarshal(params, &message) == nil {
			h.manager.appendLog(message.Message)
		}
	case "window/showMessage":
		var message Message
		if json.Unmarshal(params, &message) == nil {
			h.manager.appendLog(message.Message)
			h.manager.publish("copilot.message", message)
		}
	}
}

func (h *handler) HandleRequest(_ context.Context, method string, params json.RawMessage) (any, error) {
	switch method {
	case "window/showDocument":
		var request struct {
			URI      string `json:"uri"`
			External bool   `json:"external"`
		}
		if json.Unmarshal(params, &request) != nil {
			return map[string]bool{"success": false}, nil
		}
		return map[string]bool{"success": h.manager.openExternal(request.URI)}, nil
	case "window/showMessageRequest":
		// Avvisi di account e licenza: li mostriamo come notifica con i link d'azione; la risposta
		// nulla equivale a "chiuso", come prevede LSP.
		var request struct {
			Type    int    `json:"type"`
			Message string `json:"message"`
			Actions []struct {
				Title string `json:"title"`
			} `json:"actions"`
		}
		if json.Unmarshal(params, &request) == nil {
			message := Message{Type: request.Type, Message: request.Message}
			for _, action := range request.Actions {
				message.Actions = append(message.Actions, action.Title)
			}
			h.manager.publish("copilot.message", message)
		}
		return nil, nil
	case "workspace/configuration":
		var request struct {
			Items []json.RawMessage `json:"items"`
		}
		_ = json.Unmarshal(params, &request)
		h.manager.mu.Lock()
		configuration := serverConfiguration(h.manager.settings, h.manager.profile)
		h.manager.mu.Unlock()
		result := make([]any, len(request.Items))
		for index := range result {
			result[index] = configuration
		}
		return result, nil
	case "workspace/workspaceFolders":
		h.manager.mu.Lock()
		defer h.manager.mu.Unlock()
		return h.manager.workspaceFoldersLocked(), nil
	case "window/workDoneProgress/create", "client/registerCapability", "client/unregisterCapability":
		return nil, nil
	}
	return nil, lsp.ErrMethodNotFound
}

// applyServerStatus usa didChangeStatus per busy e avvisi; l'autenticazione la conferma checkStatus.
func (m *Manager) applyServerStatus(status serverStatus) {
	m.setStatus(func(current *Status) {
		current.Busy = status.Busy
		switch status.Kind {
		case "Error":
			if current.State == StateReady || current.State == StateStarting || current.State == StateWarning {
				current.State = StateSignedOut
			}
			current.Message = status.Message
		case "Warning":
			if current.State == StateReady {
				current.State = StateWarning
			}
			current.Message = status.Message
		case "Normal":
			if current.State == StateWarning {
				current.State = StateReady
				current.Message = ""
			}
		}
	})
	if status.Kind == "Normal" || status.Kind == "Error" {
		m.scheduleCheckStatus()
	}
}
