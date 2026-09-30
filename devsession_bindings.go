package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"adomnia/internal/devsession"
	"adomnia/internal/goide"
	"adomnia/internal/nettools"
	"adomnia/internal/storage"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	devSessionBucket      = "devsession"
	devSessionServicesKey = "services"
	maxReadyWait          = 2 * time.Minute
)

// DevSession exposes the Live Development Sessions to the frontend: the Go
// services started from gO, the requests sent to them and what they caused.
type DevSession struct {
	manager  *devsession.Manager
	goIDE    *GoIDE
	desktop  *application.App
	namesMu  sync.Mutex
	names    map[string]string // project root → declared service name
	watchers *brokerWatchers
	proxies  *sqlProxies
}

func NewDevSession(goIDE *GoIDE) *DevSession {
	d := &DevSession{goIDE: goIDE, names: loadServiceNames()}
	d.manager = devsession.NewManager(devsession.Hooks{
		Stack: d.stack,
		Step: func(debugID, action string, threadID int) error {
			return goIDE.service.DebugStep(debugID, action, threadID)
		},
		StopDebug: goIDE.service.StopDebug,
		StopRun:   goIDE.service.StopRun,
		RunPort:   d.runPort,
		ListPorts: listPorts,
		Project:   d.project,
	}, func(event devsession.Event) {
		if d.desktop != nil {
			d.desktop.Event.Emit("devsession:event", event)
		}
	})
	d.watchers = newBrokerWatchers(d.manager)
	d.proxies = newSQLProxies(d.manager)
	goIDE.onServiceEvent(d.handleGoIDEEvent)
	return d
}

func (d *DevSession) attachDesktop(desktop *application.App) { d.desktop = desktop }

func (d *DevSession) handleGoIDEEvent(event goide.EventEnvelope) {
	goSession := string(event.SessionID)
	switch event.Type {
	case "run.started":
		if execution, ok := event.Payload.(goide.Execution); ok {
			d.manager.RunStarted(goSession, string(execution.ID), execution.Kind, execution.Command, execution.PID)
		}
	case "run.output":
		if output, ok := event.Payload.(goide.ProcessOutput); ok {
			d.manager.Output("run", string(output.RunID), output.Stream, output.Text)
		}
	case "run.finished":
		if execution, ok := event.Payload.(goide.Execution); ok {
			d.manager.RunFinished(string(execution.ID), execution.Error)
			d.stopSessionTools("run:" + string(execution.ID))
		}
	case "debug.state":
		if info, ok := event.Payload.(goide.DebugSessionInfo); ok {
			d.manager.DebugState(goSession, string(info.ID), info.State, info.Title, info.StopReason, info.ThreadID, info.Error)
			if info.State == goide.DebugTerminated {
				d.stopSessionTools("debug:" + string(info.ID))
			}
		}
	case "debug.output":
		if output, ok := event.Payload.(goide.DebugOutput); ok && (output.Category == "stdout" || output.Category == "stderr") {
			d.manager.Output("debug", string(output.DebugID), output.Category, output.Text)
		}
	case "session.closed":
		d.manager.GoSessionClosed(goSession)
	}
}

func (d *DevSession) stopSessionTools(sessionID string) {
	d.watchers.stop(sessionID)
	d.proxies.stop(sessionID)
}

func (d *DevSession) stack(debugID string, threadID int) ([]devsession.Frame, error) {
	frames, err := d.goIDE.service.DebugStackTrace(debugID, threadID)
	if err != nil {
		return nil, err
	}
	out := make([]devsession.Frame, 0, len(frames))
	for _, frame := range frames {
		out = append(out, devsession.Frame{Function: frame.Name, File: frame.Path, RelativePath: frame.RelativePath, Line: frame.Line})
	}
	return out, nil
}

func (d *DevSession) runPort(runID string) int {
	request, ok := d.goIDE.service.RunRequestFor(runID)
	if !ok {
		return 0
	}
	port, _ := strconv.Atoi(strings.TrimSpace(request.Environment["PORT"]))
	return port
}

func listPorts() ([]devsession.Port, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	entries, err := nettools.ListListeningPorts(ctx)
	if err != nil {
		return nil, err
	}
	ports := make([]devsession.Port, 0, len(entries))
	for _, entry := range entries {
		ports = append(ports, devsession.Port{Port: entry.Port, PID: entry.PID, Process: entry.Process})
	}
	return ports, nil
}

// project names a gO session: the declared service name or the folder name.
func (d *DevSession) project(goSessionID string) (string, string) {
	root, err := d.goIDE.sessionRoot(goSessionID)
	if err != nil {
		return "service", ""
	}
	d.namesMu.Lock()
	name := d.names[root]
	d.namesMu.Unlock()
	if name == "" {
		name = filepath.Base(root)
	}
	return name, root
}

func loadServiceNames() map[string]string {
	names := map[string]string{}
	if data, err := storage.Get(devSessionBucket, devSessionServicesKey); err == nil && len(data) > 0 {
		_ = json.Unmarshal(data, &names)
	}
	return names
}

// GetSnapshot returns the live sessions and recent request runs.
func (d *DevSession) GetSnapshot() devsession.Snapshot { return d.manager.Snapshot() }

// BeginRequest registers a request about to be sent; an empty id means the
// URL does not point at a live session.
func (d *DevSession) BeginRequest(request devsession.BeginRequest) (devsession.RequestRun, error) {
	return d.manager.Begin(request)
}

// EndRequest records the HTTP outcome of a request run.
func (d *DevSession) EndRequest(runID string, status int, durationMs int64, errText string) (devsession.RequestRun, error) {
	return d.manager.End(runID, status, durationMs, errText)
}

// MatchURL returns the live session serving a local URL, or "".
func (d *DevSession) MatchURL(url string) string { return d.manager.MatchURL(url) }

// Step runs continue / next / stepIn / stepOut / pause on a debugged service.
func (d *DevSession) Step(sessionID, action string) error { return d.manager.Step(sessionID, action) }

// Stop stops a live service (debugger or process).
func (d *DevSession) Stop(sessionID string) error { return d.manager.Stop(sessionID) }

// SetPort fixes the port of a live session by hand.
func (d *DevSession) SetPort(sessionID string, port int) error {
	return d.manager.SetPort(sessionID, port)
}

// WaitReady waits until the service accepts connections on its port.
func (d *DevSession) WaitReady(sessionID string, timeoutMs int) error {
	timeout := time.Duration(timeoutMs) * time.Millisecond
	if timeout <= 0 || timeout > maxReadyWait {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return d.manager.WaitReady(ctx, sessionID)
}

// Logs returns a session's log lines, optionally only a request's.
func (d *DevSession) Logs(sessionID, runID string, limit int) []devsession.LogEntry {
	return d.manager.Logs(sessionID, runID, limit)
}

// Queries returns the SQL statements tied to a request run ("" for all).
func (d *DevSession) Queries(runID string) []devsession.Query { return d.manager.Queries(runID) }

// Messages returns the broker messages tied to a request run ("" for all).
func (d *DevSession) Messages(runID string) []devsession.Message { return d.manager.Messages(runID) }

// SetServiceName declares the service a gO project represents ("users-service").
func (d *DevSession) SetServiceName(goSessionID, name string) error {
	root, err := d.goIDE.sessionRoot(goSessionID)
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	d.namesMu.Lock()
	if name == "" {
		delete(d.names, root)
	} else {
		d.names[root] = name
	}
	data, _ := json.Marshal(d.names)
	d.namesMu.Unlock()
	if err := storage.Put(devSessionBucket, devSessionServicesKey, data); err != nil {
		return err
	}
	service, _ := d.project(goSessionID)
	d.manager.RenameService(goSessionID, service)
	return nil
}

// ProjectServiceName returns the service name of a gO project.
func (d *DevSession) ProjectServiceName(goSessionID string) string {
	service, _ := d.project(goSessionID)
	return service
}
