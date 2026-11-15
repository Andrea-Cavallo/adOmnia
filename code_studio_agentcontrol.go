package main

import (
	"context"
	"fmt"
	"log"

	"github.com/Andrea-Cavallo/adOmnia/internal/codestudio"
	"github.com/Andrea-Cavallo/adOmnia/internal/database"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agentcontrol"
)

func (g *GoIDE) startAgentControl() {
	router := &agentcontrol.Router{Sessions: g.service.ListSessions, Operations: map[string]agentcontrol.Operation{}}
	router.Operations["ide_open_file"] = agentcontrol.Typed(func(ctx context.Context, session string, args agentcontrol.OpenFileRequest) (any, error) {
		return agentcontrol.OpenFile(ctx, g.service, session, args, func(payload any) { g.desktop.Event.Emit("code-studio:agent-open", payload) })
	})
	router.Operations["ide_test_start"] = agentcontrol.Typed(func(ctx context.Context, session string, request codestudio.TestRunRequest) (any, error) {
		return g.service.StartTests(request)
	})
	router.Operations["ide_test_status"] = agentcontrol.Typed(func(ctx context.Context, session string, args agentcontrol.RunRequest) (any, error) {
		snapshot, err := g.service.GetTestRun(args.RunID)
		if err != nil {
			return nil, err
		}
		if string(snapshot.SessionID) != session {
			return nil, fmt.Errorf("test run is outside this project")
		}
		if args.NodeID != "" {
			return g.service.GetTestOutput(args.RunID, args.NodeID)
		}
		return snapshot, nil
	})
	router.Operations["ide_debug_start"] = func(ctx context.Context, session string, args map[string]any) (any, error) {
		switch args["language"] {
		case "python":
			return agentcontrol.Typed(func(_ context.Context, _ string, request codestudio.PythonDebugRequest) (any, error) {
				return g.service.StartPythonDebug(request)
			})(ctx, session, args)
		case "rust":
			return agentcontrol.Typed(func(_ context.Context, _ string, request codestudio.RustDebugRequest) (any, error) {
				return g.service.StartRustDebug(request)
			})(ctx, session, args)
		case "c", "cpp":
			return agentcontrol.Typed(func(_ context.Context, _ string, request codestudio.NativeDebugRequest) (any, error) {
				return g.service.StartNativeDebug(request)
			})(ctx, session, args)
		case "typescript", "javascript":
			return agentcontrol.Typed(func(_ context.Context, _ string, request codestudio.WebDebugRequest) (any, error) {
				return g.service.StartWebDebug(request)
			})(ctx, session, args)
		case nil, "", "go", "java":
		default:
			return nil, fmt.Errorf("unsupported debugger language %v", args["language"])
		}
		if args["language"] == "java" {
			request, err := agentcontrol.Decode[codestudio.JavaDebugRequest](args)
			if err != nil {
				return nil, err
			}
			return g.service.StartJavaDebug(request)
		}
		request, err := agentcontrol.Decode[codestudio.DebugRequest](args)
		if err != nil {
			return nil, err
		}
		return g.service.StartDebug(request)
	}
	router.Operations["ide_debug"] = agentcontrol.Typed(func(ctx context.Context, session string, args agentcontrol.DebugRequest) (any, error) {
		return agentcontrol.Debug(ctx, g.service, session, args)
	})
	router.Operations["ide_database_query"] = agentcontrol.Typed(func(ctx context.Context, session string, args agentcontrol.QueryRequest) (any, error) {
		return database.AgentQuery(ctx, args.ConnectionID, args.Query, args.Limit)
	})
	router.Operations["ide_database_connections"] = func(context.Context, string, map[string]any) (any, error) { return database.AgentConnections() }
	agentcontrol.RegisterReview(router, g.agentReview)
	g.onServiceEvent(func(event codestudio.EventEnvelope) {
		if event.Type == "run.output" || event.Type == "debug.output" || event.Type == "run.finished" {
			router.Record(string(event.SessionID), event)
		}
	})
	directory, err := agentcontrol.Directory()
	if err == nil {
		g.agentControl, err = agentcontrol.Start(directory, router.Handle)
	}
	if err != nil {
		log.Printf("[agent-control] desktop bridge unavailable: %v", err)
	}
}
