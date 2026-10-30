package codestudio

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
)

type AgentTaskRuntime struct {
	managers map[string]*milk.Manager
}

func NewAgentTaskRuntime(managers map[string]*milk.Manager) *AgentTaskRuntime {
	return &AgentTaskRuntime{managers: managers}
}

// failedStopReasons sono i motivi con cui un agente ACP dichiara di non aver
// portato a termine il compito: il task non deve risultare completato.
func failedStopReasons(reason string) bool {
	switch strings.ToLower(strings.TrimSpace(reason)) {
	case "refusal", "max_tokens", "max_turn_requests", "error":
		return true
	default:
		return false
	}
}

func (runtime *AgentTaskRuntime) Run(ctx context.Context, request agenttask.RunRequest, publish func(agenttask.Event)) error {
	manager := runtime.managers[request.Task.Agent]
	if manager == nil {
		return fmt.Errorf("agent %s is not registered", request.Task.Agent)
	}
	attemptID := request.Attempt.ID
	// Ogni tentativo è una sessione isolata dell'agente: viene dimenticata
	// (e chiusa, se l'agente lo supporta) appena il turno finisce, così le
	// sessioni non si accumulano per tutta la vita del processo.
	defer manager.ForgetScopedSession(request.Task.Root, attemptID)
	pending := map[string]bool{}
	var pendingMu sync.Mutex
	var reportedError string
	var stopReason string
	unsubscribe := manager.AddListener(func(name string, payload any) {
		switch {
		case strings.HasSuffix(name, ".chat"):
			event, ok := payload.(milk.ChatEvent)
			if !ok || event.SessionKey != attemptID {
				return
			}
			converted := agenttask.Event{Kind: event.Kind, Message: event.Reply, SessionID: event.SessionID}
			switch event.Kind {
			case "tool":
				if event.Tool != nil {
					converted.ToolName = event.Tool.Name
					converted.ToolStatus = event.Tool.Status
					converted.Message = event.Tool.RawOutput
				}
			case "plan":
				for _, entry := range event.Plan {
					converted.Plan = append(converted.Plan, agenttask.PlanEntry{Content: entry.Content, Status: entry.Status, Priority: entry.Priority})
				}
			case "route":
				if event.Route != nil {
					converted.Message = event.Route.Agent + " → " + event.Route.Target + ": " + event.Route.Reason
				}
			case "end":
				converted.Message = event.StopReason
				stopReason = event.StopReason
			case "error":
				converted.Message = event.Error
				if reportedError == "" {
					reportedError = event.Error
				}
			}
			publish(converted)
		case strings.HasSuffix(name, ".permission"):
			event, ok := payload.(milk.PermissionEvent)
			if !ok || event.SessionKey != attemptID {
				return
			}
			pendingMu.Lock()
			pending[event.RequestID] = true
			pendingMu.Unlock()
			message := event.Title
			if event.Description != "" {
				message += "\n" + event.Description
			}
			publish(agenttask.Event{Kind: "permission", Message: message, SessionID: event.SessionID, RequestID: event.RequestID})
		case strings.HasSuffix(name, ".permissionResolved"):
			event, ok := payload.(map[string]string)
			if !ok {
				return
			}
			pendingMu.Lock()
			owned := pending[event["requestId"]]
			delete(pending, event["requestId"])
			pendingMu.Unlock()
			if owned {
				publish(agenttask.Event{Kind: "permission_resolved", RequestID: event["requestId"]})
			}
		}
	})
	defer unsubscribe()
	_, err := manager.Prompt(ctx, milk.PromptRequest{
		Token: attemptID, Root: request.Task.Root, SessionKey: attemptID, Message: request.Message,
		TimeLimit: taskTimeLimit(request),
	})
	if err != nil {
		return err
	}
	if reportedError != "" {
		return fmt.Errorf("agent reported an error: %s", reportedError)
	}
	if failedStopReasons(stopReason) {
		return fmt.Errorf("agent stopped before completing the task: %s", stopReason)
	}
	return nil
}

// taskTimeLimit trasforma il limite del task nel limite del turno ACP: senza
// questo il timeout del turno dell'agente (impostazione globale) taglierebbe
// prima il task, con un messaggio che non parla del limite configurato.
func taskTimeLimit(request agenttask.RunRequest) time.Duration {
	minutes := request.Task.Limits.TimeoutMinutes
	if minutes <= 0 {
		return 0
	}
	return time.Duration(minutes) * time.Minute
}
