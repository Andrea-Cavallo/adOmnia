package agentcontrol

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agentreview"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/workspace"
)

type OpenFileRequest struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}
type RunRequest struct {
	RunID  string `json:"runId"`
	NodeID string `json:"nodeId"`
}
type QueryRequest struct {
	ConnectionID string `json:"connectionId"`
	Query        string `json:"query"`
	Limit        int    `json:"limit"`
}
type documentIDE interface {
	SessionRoot(string) (string, error)
	OpenDocument(string, string) (workspace.OpenDocument, error)
}

func OpenFile(ctx context.Context, ide documentIDE, session string, args OpenFileRequest, emit func(any)) (any, error) {
	root, err := ide.SessionRoot(session)
	if err != nil {
		return nil, err
	}
	if args.Path == "" {
		return nil, errors.New("path is required")
	}
	target := filepath.Join(root, filepath.FromSlash(args.Path))
	if filepath.IsAbs(args.Path) {
		target = args.Path
	}
	relative := project.RelativeWithin(root, target)
	if relative == "" {
		return nil, errors.New("path is outside this project")
	}
	opened, err := ide.OpenDocument(session, relative)
	if err != nil {
		return nil, err
	}
	if args.Line < 1 {
		args.Line = 1
	}
	if args.Column < 1 {
		args.Column = 1
	}
	emit(map[string]any{"kind": "symbol", "id": string(opened.Document.ID), "label": relative, "sessionId": session, "attrs": map[string]string{}, "source": map[string]any{"file": relative, "line": args.Line, "column": args.Column}})
	return map[string]any{"path": relative, "line": args.Line, "column": args.Column, "dispatched": true}, nil
}

type DebugRequest struct {
	Action      string           `json:"action"`
	DebugID     string           `json:"debugId"`
	ThreadID    int              `json:"threadId"`
	FrameID     int              `json:"frameId"`
	Reference   int              `json:"reference"`
	Expression  string           `json:"expression"`
	Path        string           `json:"path"`
	Breakpoints []dap.Breakpoint `json:"breakpoints"`
}
type debugger interface {
	ListDebugSessions(string) ([]dap.DebugSessionInfo, error)
	DebugThreads(string) ([]dap.DebugThread, error)
	DebugStackTrace(string, int) ([]dap.DebugFrame, error)
	DebugScopes(string, int) ([]dap.DebugScope, error)
	DebugVariables(string, int) ([]dap.DebugVariable, error)
	DebugEvaluate(string, string, int, string) (dap.EvaluateResult, error)
	DebugStep(string, string, int) error
	StopDebug(string) error
	SetBreakpoints(string, string, []dap.Breakpoint) ([]dap.BreakpointState, error)
}

func Debug(ctx context.Context, ide debugger, session string, args DebugRequest) (any, error) {
	sessions, err := ide.ListDebugSessions(session)
	if err != nil {
		return nil, err
	}
	if args.Action == "list" {
		return sessions, nil
	}
	if args.Action == "breakpoints" {
		return ide.SetBreakpoints(session, args.Path, args.Breakpoints)
	}
	found := false
	for _, entry := range sessions {
		if string(entry.ID) == args.DebugID {
			found = true
		}
	}
	if !found {
		return nil, errors.New("debug session is outside this project")
	}
	switch args.Action {
	case "threads":
		return ide.DebugThreads(args.DebugID)
	case "stack":
		return ide.DebugStackTrace(args.DebugID, args.ThreadID)
	case "scopes":
		return ide.DebugScopes(args.DebugID, args.FrameID)
	case "variables":
		return ide.DebugVariables(args.DebugID, args.Reference)
	case "evaluate":
		return ide.DebugEvaluate(args.DebugID, args.Expression, args.FrameID, "watch")
	case "stop":
		return map[string]bool{"ok": true}, ide.StopDebug(args.DebugID)
	case "continue", "pause", "next", "stepIn", "stepOut":
		return map[string]bool{"ok": true}, ide.DebugStep(args.DebugID, args.Action, args.ThreadID)
	default:
		return nil, fmt.Errorf("unsupported debug action %q", args.Action)
	}
}
func RegisterReview(router *Router, tracker *agentreview.Tracker) {
	var mu sync.Mutex
	turns := map[string]func(){}
	router.Operations["ide_review_begin"] = func(ctx context.Context, session string, args map[string]any) (any, error) {
		mu.Lock()
		defer mu.Unlock()
		sessions, err := router.Sessions()
		if err != nil {
			return nil, err
		}
		for _, entry := range sessions {
			if string(entry.ID) == session {
				root := entry.Project.RealPath
				if turns[root] != nil {
					return nil, errors.New("an external review turn is already active")
				}
				agent, _ := args["agent"].(string)
				agent = strings.TrimSpace(agent)
				if agent == "" {
					agent = "MCP agent"
				}
				turns[root] = tracker.BeginTurn(root, agent)
				return map[string]bool{"started": true}, nil
			}
		}
		return nil, errors.New("project closed")
	}
	router.Operations["ide_review_end"] = func(ctx context.Context, session string, args map[string]any) (any, error) {
		mu.Lock()
		defer mu.Unlock()
		sessions, err := router.Sessions()
		if err != nil {
			return nil, err
		}
		for _, entry := range sessions {
			if string(entry.ID) == session {
				root := entry.Project.RealPath
				end := turns[root]
				if end == nil {
					return nil, errors.New("no external review turn is active")
				}
				end()
				delete(turns, root)
				review := tracker.Get(root)
				return map[string]any{"files": len(review.Files), "notice": review.Notice}, nil
			}
		}
		return nil, errors.New("project closed")
	}
}
