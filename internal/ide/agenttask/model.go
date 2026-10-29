// Package agenttask gestisce task eseguiti da agenti esterni senza dipendere da un provider concreto.
package agenttask

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

const CurrentVersion = 1

type Intent string

const (
	IntentImplementation Intent = "implementation"
	IntentBugfix         Intent = "bugfix"
	IntentAnalysis       Intent = "analysis"
)

type Status string

const (
	StatusDraft             Status = "draft"
	StatusRunning           Status = "running"
	StatusWaitingPermission Status = "waiting_permission"
	StatusStopping          Status = "stopping"
	StatusCompleted         Status = "completed"
	StatusFailed            Status = "failed"
	StatusStopped           Status = "stopped"
	StatusNeedsIntervention Status = "needs_intervention"
)

type Limits struct {
	TimeoutMinutes  int `json:"timeoutMinutes"`
	MaxContextBytes int `json:"maxContextBytes"`
}

type ContextReceipt struct {
	Bytes           int  `json:"bytes"`
	Sources         int  `json:"sources"`
	Excluded        int  `json:"excluded"`
	Truncated       bool `json:"truncated"`
	IncludesUnsaved bool `json:"includesUnsaved"`
}

type PlanEntry struct {
	Content  string `json:"content"`
	Status   string `json:"status"`
	Priority string `json:"priority,omitempty"`
}

type Event struct {
	ID         string      `json:"id"`
	TaskID     string      `json:"taskId"`
	AttemptID  string      `json:"attemptId"`
	Timestamp  time.Time   `json:"timestamp"`
	Kind       string      `json:"kind"`
	Message    string      `json:"message,omitempty"`
	SessionID  string      `json:"sessionId,omitempty"`
	RequestID  string      `json:"requestId,omitempty"`
	ToolName   string      `json:"toolName,omitempty"`
	ToolStatus string      `json:"toolStatus,omitempty"`
	Plan       []PlanEntry `json:"plan,omitempty"`
}

type Attempt struct {
	ID         string         `json:"id"`
	Status     Status         `json:"status"`
	SessionID  string         `json:"sessionId,omitempty"`
	NewSession bool           `json:"newSession"`
	Context    ContextReceipt `json:"context"`
	// Prompt è il messaggio approvato nell'anteprima, troncato e redatto:
	// senza di esso l'export non permette di ricostruire cosa è stato inviato.
	Prompt string `json:"prompt,omitempty"`
	StartedAt  time.Time      `json:"startedAt"`
	EndedAt    *time.Time     `json:"endedAt,omitempty"`
	Error      string         `json:"error,omitempty"`
	Events     []Event        `json:"events"`
}

type Task struct {
	ID              string         `json:"id"`
	Root            string         `json:"root"`
	UnitID          string         `json:"unitId,omitempty"`
	Intent          Intent         `json:"intent"`
	Objective       string         `json:"objective"`
	Criteria        []string       `json:"criteria"`
	Paths           []string       `json:"paths"`
	Dependencies    []string       `json:"dependencies"`
	Agent           string         `json:"agent"`
	Limits          Limits         `json:"limits"`
	Status          Status         `json:"status"`
	ActiveAttemptID string         `json:"activeAttemptId,omitempty"`
	LastContext     ContextReceipt `json:"lastContext"`
	CreatedAt       time.Time      `json:"createdAt"`
	UpdatedAt       time.Time      `json:"updatedAt"`
	Attempts        []Attempt      `json:"attempts"`
}

type Draft struct {
	Root         string   `json:"root"`
	UnitID       string   `json:"unitId,omitempty"`
	Intent       Intent   `json:"intent"`
	Objective    string   `json:"objective"`
	Criteria     []string `json:"criteria"`
	Paths        []string `json:"paths"`
	Dependencies []string `json:"dependencies"`
	Agent        string   `json:"agent"`
	Limits       Limits   `json:"limits"`
}

type Snapshot struct {
	Version int    `json:"version"`
	Tasks   []Task `json:"tasks"`
}

func NewTask(draft Draft, now time.Time) (Task, error) {
	normalized, err := normalizeDraft(draft)
	if err != nil {
		return Task{}, err
	}
	return Task{
		ID: newID("task"), Root: normalized.Root, UnitID: normalized.UnitID,
		Intent: normalized.Intent, Objective: normalized.Objective,
		Criteria: normalized.Criteria, Paths: normalized.Paths, Dependencies: normalized.Dependencies,
		Agent: normalized.Agent, Limits: normalized.Limits, Status: StatusDraft,
		CreatedAt: now.UTC(), UpdatedAt: now.UTC(), Attempts: []Attempt{},
	}, nil
}

func normalizeDraft(draft Draft) (Draft, error) {
	draft.Root = strings.TrimSpace(draft.Root)
	draft.UnitID = strings.TrimSpace(draft.UnitID)
	draft.Objective = strings.TrimSpace(draft.Objective)
	draft.Agent = strings.TrimSpace(draft.Agent)
	if draft.Root == "" {
		return Draft{}, errors.New("project root is required")
	}
	if draft.Objective == "" {
		return Draft{}, errors.New("task objective is required")
	}
	if draft.Agent == "" {
		return Draft{}, errors.New("agent is required")
	}
	switch draft.Intent {
	case IntentImplementation, IntentBugfix, IntentAnalysis:
	default:
		return Draft{}, errors.New("intent must be implementation, bugfix or analysis")
	}
	if draft.Root != "" {
		draft.Root = filepath.Clean(draft.Root)
	}
	if draft.Limits.TimeoutMinutes == 0 {
		draft.Limits.TimeoutMinutes = 30
	}
	if draft.Limits.MaxContextBytes == 0 {
		draft.Limits.MaxContextBytes = 128 * 1024
	}
	if draft.Limits.TimeoutMinutes < 1 || draft.Limits.TimeoutMinutes > 240 {
		return Draft{}, errors.New("timeout must be between 1 and 240 minutes")
	}
	if draft.Limits.MaxContextBytes < 1024 || draft.Limits.MaxContextBytes > 256*1024 {
		return Draft{}, errors.New("context limit must be between 1 and 256 KiB")
	}
	var err error
	if draft.Criteria, err = cleanList(draft.Criteria, false); err != nil {
		return Draft{}, fmt.Errorf("invalid completion criteria: %w", err)
	}
	if draft.Paths, err = cleanList(draft.Paths, false); err != nil {
		return Draft{}, fmt.Errorf("invalid paths: %w", err)
	}
	if draft.Dependencies, err = cleanList(draft.Dependencies, true); err != nil {
		return Draft{}, fmt.Errorf("invalid dependencies: %w", err)
	}
	return draft, nil
}

func cleanList(values []string, allowEmpty bool) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			if allowEmpty {
				continue
			}
			return nil, errors.New("empty entries are not allowed")
		}
		if len(value) > 32*1024 {
			return nil, errors.New("an entry exceeds 32 KiB")
		}
		if !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	return result, nil
}

func (task Task) Active() bool {
	switch task.Status {
	case StatusRunning, StatusWaitingPermission, StatusStopping:
		return true
	default:
		return false
	}
}

func (task Task) Validate() error {
	_, err := normalizeDraft(Draft{
		Root: task.Root, UnitID: task.UnitID, Intent: task.Intent, Objective: task.Objective,
		Criteria: task.Criteria, Paths: task.Paths, Dependencies: task.Dependencies,
		Agent: task.Agent, Limits: task.Limits,
	})
	if task.ID == "" {
		return errors.New("task ID is required")
	}
	return err
}

func cloneTask(task Task) Task {
	clone := task
	clone.Criteria = append([]string(nil), task.Criteria...)
	clone.Paths = append([]string(nil), task.Paths...)
	clone.Dependencies = append([]string(nil), task.Dependencies...)
	clone.Attempts = make([]Attempt, len(task.Attempts))
	for index, attempt := range task.Attempts {
		clone.Attempts[index] = attempt
		clone.Attempts[index].Events = make([]Event, len(attempt.Events))
		for eventIndex, event := range attempt.Events {
			clone.Attempts[index].Events[eventIndex] = event
			clone.Attempts[index].Events[eventIndex].Plan = append([]PlanEntry(nil), event.Plan...)
		}
		if attempt.EndedAt != nil {
			ended := *attempt.EndedAt
			clone.Attempts[index].EndedAt = &ended
		}
	}
	return clone
}

func newID(prefix string) string {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err == nil {
		return prefix + "-" + hex.EncodeToString(data)
	}
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}
