package codestudio

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
)

// verifySessionPrefix marks the temporary sessions opened on a task workspace to
// start its service. They are never shown, never persisted and always closed.
const verifySessionPrefix = "agent-verify-"

const serviceTapLimit = 16 * 1024

// serviceTap keeps the last bytes printed by a verification service: the evidence
// shows why a service did not start without keeping its whole output.
type serviceTap struct {
	mu   sync.Mutex
	text []byte
	// finished si chiude al primo run.finished: gli eventi arrivano in ordine, quindi
	// dopo di esso tutto l'output del servizio è già stato raccolto.
	finished chan struct{}
	once     sync.Once
}

func newServiceTap() *serviceTap { return &serviceTap{finished: make(chan struct{})} }

func (tap *serviceTap) write(text string) {
	tap.mu.Lock()
	defer tap.mu.Unlock()
	tap.text = append(tap.text, text...)
	if over := len(tap.text) - serviceTapLimit; over > 0 {
		tap.text = append([]byte(nil), tap.text[over:]...)
	}
}

func (tap *serviceTap) String() string {
	tap.mu.Lock()
	defer tap.mu.Unlock()
	return strings.ToValidUTF8(string(tap.text), "")
}

func (s *Service) tapServiceOutput(eventType string, sessionID SessionID, payload any) {
	value, ok := s.serviceTaps.Load(sessionID)
	if !ok {
		return
	}
	tap := value.(*serviceTap)
	switch eventType {
	case "run.output":
		if output, ok := payload.(ProcessOutput); ok {
			tap.write(output.Text)
		}
	case "run.finished":
		tap.once.Do(func() { close(tap.finished) })
	}
}

// persistableSessions drops the temporary verification sessions: a crash during a
// verification must not reopen a hidden session at the next start.
func persistableSessions(sessions []Session) []Session {
	kept := sessions[:0:0]
	for _, session := range sessions {
		if !strings.HasPrefix(session.WorkspaceID, verifySessionPrefix) {
			kept = append(kept, session)
		}
	}
	return kept
}

// launchedService is a run configuration started in a task workspace for one verification.
type launchedService struct {
	service   *Service
	name      string
	sessionID SessionID
	runID     RunID
	command   string
	readyIn   time.Duration
	tap       *serviceTap
}

// startService opens a temporary session on the task workspace, starts the approved
// run configuration and waits until the request's port accepts connections. On
// failure it returns the evidence explaining why, with everything already stopped.
func (verifier *TaskVerifier) startService(ctx context.Context, request agenttask.VerifyRequest, target *url.URL) (*launchedService, agenttask.Evidence) {
	launch := request.Verification.Service
	evidence := agenttask.Evidence{
		Outcome: agenttask.EvidenceNotRun, Environment: "http",
		Command: request.Verification.Method + " " + request.Verification.URL,
	}
	if verifier.service == nil {
		evidence.Log = "starting a run configuration is not available in this build; the request was not sent"
		return nil, evidence
	}
	launched, err := verifier.service.launchTaskService(request.TaskID, request.Workdir, launch)
	if err != nil {
		evidence.Log = fmt.Sprintf("the run configuration %q was not started: %v", launch.Name, err)
		return nil, evidence
	}
	evidence.Outcome = agenttask.EvidenceError
	evidence.Command = fmt.Sprintf("%s → %s", launched.command, evidence.Command)
	if failure := launched.waitReady(ctx, target, time.Duration(launch.ReadyTimeoutSeconds)*time.Second); failure != "" {
		launched.stop()
		// Il servizio è stato davvero avviato e non ha risposto: è un fallimento misurato.
		evidence.Outcome = agenttask.EvidenceFailed
		if ctx.Err() != nil {
			evidence.Outcome = agenttask.EvidenceError
		}
		return nil, launched.annotate(withLog(evidence, failure))
	}
	return launched, evidence
}

func withLog(evidence agenttask.Evidence, text string) agenttask.Evidence {
	evidence.Log = text
	return evidence
}

func (s *Service) launchTaskService(taskID, workdir string, launch agenttask.ServiceLaunch) (*launchedService, error) {
	var config RunConfiguration
	if err := json.Unmarshal([]byte(launch.Configuration), &config); err != nil {
		return nil, fmt.Errorf("the saved configuration cannot be read: %w", err)
	}
	if config.Kind == RunKindCompound {
		return nil, errors.New("compound configurations cannot start a verification service yet")
	}
	if secrets := config.RequiredSecrets(); len(secrets) > 0 {
		return nil, fmt.Errorf("it needs secret values (%s) and verifications run unattended", strings.Join(secrets, ", "))
	}
	if err := s.restore(); err != nil {
		return nil, err
	}
	session, err := s.workspace.OpenProject(workdir, verifySessionPrefix+taskID, nil)
	if err != nil {
		return nil, fmt.Errorf("open the task workspace: %w", err)
	}
	// Il binding ha già verificato la fiducia del progetto del task; il worktree,
	// creato da adOmnia da quel progetto, la eredita solo per questa sessione temporanea.
	if session, err = s.workspace.SetToolAuthorization(session.ID, true); err != nil {
		s.closeVerifySession(session.ID)
		return nil, err
	}
	tap := newServiceTap()
	s.serviceTaps.Store(session.ID, tap)
	runRequest, err := s.buildRunRequest(session, config, nil)
	if err == nil {
		var execution Execution
		if execution, err = s.StartRun(runRequest); err == nil {
			return &launchedService{service: s, name: launch.Name, sessionID: session.ID, runID: execution.ID, command: execution.Command, tap: tap}, nil
		}
	}
	s.closeVerifySession(session.ID)
	return nil, err
}

// waitReady polls the request's host:port until it accepts a TCP connection. It
// returns a non-empty reason when the service exited, timed out or was cancelled.
func (launched *launchedService) waitReady(ctx context.Context, target *url.URL, timeout time.Duration) string {
	address := net.JoinHostPort(target.Hostname(), portOf(target))
	started := time.Now()
	deadline := started.Add(timeout)
	for {
		if execution, ok := launched.service.processes.Execution(launched.runID); !ok || execution.Status != "running" {
			return fmt.Sprintf("the service %q stopped before accepting connections on %s", launched.name, address)
		}
		connection, err := net.DialTimeout("tcp", address, 500*time.Millisecond)
		if err == nil {
			_ = connection.Close() // only probing readiness
			launched.readyIn = time.Since(started)
			return ""
		}
		if time.Now().After(deadline) {
			return fmt.Sprintf("the service %q did not accept connections on %s within %s", launched.name, address, timeout)
		}
		select {
		case <-ctx.Done():
			return "verification interrupted: " + ctx.Err().Error()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func portOf(target *url.URL) string {
	if port := target.Port(); port != "" {
		return port
	}
	if target.Scheme == "https" {
		return "443"
	}
	return "80"
}

// annotate adds what the service did to the evidence: what was started, how long it
// took to become ready and the tail of its output.
func (launched *launchedService) annotate(evidence agenttask.Evidence) agenttask.Evidence {
	evidence.Observations = append(evidence.Observations,
		agenttask.Observation{Name: "service", Value: launched.name},
		agenttask.Observation{Name: "serviceCommand", Value: launched.command},
	)
	if launched.readyIn > 0 {
		evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "serviceReadyMs", Value: fmt.Sprintf("%d", launched.readyIn.Milliseconds())})
	}
	output := strings.TrimSpace(launched.tap.String())
	if output == "" {
		output = "(no output collected)"
	}
	evidence.Log = strings.TrimRight(evidence.Log, "\n") + "\n\n--- service output (last " + fmt.Sprintf("%d", serviceTapLimit/1024) + " KiB) ---\n" + output
	return withStackTrace(evidence, launched.tap.String())
}

// stop ends the service and every process of its temporary session, then closes it.
func (launched *launchedService) stop() {
	launched.service.processes.StopSession(launched.sessionID)
	select {
	case <-launched.tap.finished:
	case <-time.After(5 * time.Second):
	}
	launched.service.closeVerifySession(launched.sessionID)
}

func (s *Service) closeVerifySession(id SessionID) {
	s.processes.StopSession(id)
	// ponytail: the process layer already kills the tree on Stop; a process still alive after 5s makes CloseSession fail and is reported by HasAnyActiveRuns.
	for _, execution := range s.processes.List(id) {
		s.processes.WaitStopped(execution.ID, 5*time.Second)
	}
	s.serviceTaps.Delete(id)
	// Best effort: la sessione temporanea non ha buffer né finestre; se restano processi
	// la chiusura fallisce e non viene comunque mai persistita.
	_ = s.CloseSession(string(id))
}
