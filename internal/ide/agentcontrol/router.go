package agentcontrol

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/aipolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/workspace"
)

type Operation func(context.Context, string, map[string]any) (any, error)
type Router struct {
	Sessions   func() ([]workspace.Session, error)
	Operations map[string]Operation
	mu         sync.Mutex
	logs       map[string][]any
}

func canonical(path string) string {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	if real, err := filepath.EvalSymlinks(absolute); err == nil {
		absolute = real
	}
	return filepath.Clean(absolute)
}
func (router *Router) Handle(ctx context.Context, request Request) (any, error) {
	if strings.TrimSpace(request.Project) == "" {
		return nil, errors.New("project is required")
	}
	sessions, err := router.Sessions()
	if err != nil {
		return nil, err
	}
	var found *workspace.Session
	for _, session := range sessions {
		if project.SamePath(canonical(session.Project.RealPath), canonical(request.Project)) {
			if found != nil {
				return nil, errors.New("multiple IDE sessions match the project")
			}
			copy := session
			found = &copy
		}
	}
	if found == nil {
		return nil, errors.New("project is not open in this IDE")
	}
	policy := aipolicy.Load(found.Project.RealPath)
	local, _ := request.Arguments["localProvider"].(bool)
	if !aipolicy.Allows(policy, local) {
		return nil, errors.New("project AI policy does not permit this agent")
	}
	sessionID := string(found.ID)
	if request.Operation == "ide_status" {
		return found, nil
	}
	if request.Operation == "ide_logs" {
		router.mu.Lock()
		defer router.mu.Unlock()
		return append([]any{}, router.logs[sessionID]...), nil
	}
	operation := router.Operations[request.Operation]
	if operation == nil {
		return nil, fmt.Errorf("unsupported IDE operation %q", request.Operation)
	}
	if found.Project.Authorization != workspace.AuthorizationPermitted {
		return nil, errors.New("authorize project tooling in Code Studio first")
	}
	if request.Arguments == nil {
		request.Arguments = map[string]any{}
	}
	// A caller cannot substitute another project's session inside a typed request.
	request.Arguments["sessionId"] = sessionID
	return operation(ctx, sessionID, request.Arguments)
}
func (router *Router) Record(sessionID string, event any) {
	router.mu.Lock()
	defer router.mu.Unlock()
	if router.logs == nil {
		router.logs = map[string][]any{}
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		return
	}
	if len(encoded) > 16384 {
		event = map[string]any{"truncated": true, "text": string(encoded[:16384])}
	}
	rows := append(router.logs[sessionID], event)
	if len(rows) > 100 {
		rows = rows[len(rows)-100:]
	}
	router.logs[sessionID] = rows
}

// Decode is shared by typed desktop adapters; it does not use reflection to invoke methods.
func Decode[T any](args map[string]any) (T, error) {
	var value T
	data, err := json.Marshal(args)
	if err == nil {
		err = json.Unmarshal(data, &value)
	}
	return value, err
}
func Typed[T any](call func(context.Context, string, T) (any, error)) Operation {
	return func(ctx context.Context, session string, args map[string]any) (any, error) {
		request, err := Decode[T](args)
		if err != nil {
			return nil, err
		}
		return call(ctx, session, request)
	}
}
