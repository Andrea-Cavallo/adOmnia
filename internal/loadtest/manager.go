package loadtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/devlog"
)

// Events sent to the frontend, routed by runId.
const (
	EventProgress = "loadtest:progress"
	EventFinished = "loadtest:finished"
)

// Finished is the payload of EventFinished: Result, or Error when the run could not start.
type Finished struct {
	RunID  string  `json:"runId"`
	Result *Result `json:"result,omitempty"`
	Error  string  `json:"error,omitempty"`
	// Saved is the run's entry in the history (empty without a history or when saving failed).
	Saved *RunSummary `json:"saved,omitempty"`
}

// ErrBusy is returned while another run is going: two runs on one machine skew each other.
var ErrBusy = errors.New("a load test is already running: stop it or wait for it to finish")

// Manager owns the run in progress. One at a time, by design.
type Manager struct {
	mu      sync.Mutex
	emit    func(event string, payload any)
	running string
	cancel  context.CancelFunc
	done    chan struct{}
	runFn   func(context.Context, Scenario, func(Progress)) (Result, error)
	history *History
}

func NewManager() *Manager { return &Manager{runFn: Run} }

// SetEmitter connects the manager to the desktop event bus.
func (m *Manager) SetEmitter(emit func(event string, payload any)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.emit = emit
}

// SetHistory makes every finished run land in h.
func (m *Manager) SetHistory(h *History) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.history = h
}

// History is where finished runs are saved, or nil.
func (m *Manager) History() *History {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.history
}

// Start validates the scenario and runs it in the background; progress and the result arrive
// as events carrying the returned run id.
func (m *Manager) Start(s Scenario) (string, error) {
	if err := s.Validate(); err != nil {
		return "", err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running != "" {
		return "", ErrBusy
	}
	id := newRunID()
	ctx, cancel := context.WithCancel(context.Background())
	m.running, m.cancel, m.done = id, cancel, make(chan struct{})
	go m.execute(ctx, id, s, m.done)
	return id, nil
}

func (m *Manager) execute(ctx context.Context, id string, s Scenario, done chan struct{}) {
	defer close(done)
	devlog.Info("loadtest", "run started", map[string]any{"runId": id, "executor": s.Workload.Executor, "flow": s.Flow != nil})
	res, err := m.runFn(ctx, s, func(p Progress) {
		p.RunID = id
		m.send(EventProgress, p)
	})
	// Free the slot before announcing the end: a Start right after "finished" must not be busy.
	m.finish(id)
	if err != nil {
		devlog.Err("loadtest", "run failed to start", err, map[string]any{"runId": id})
		m.send(EventFinished, Finished{RunID: id, Error: err.Error()})
		return
	}
	devlog.Info("loadtest", "run finished", map[string]any{"runId": id, "sent": res.TotalRequests, "failed": res.Failed, "p95Ms": res.P95Ms, "aborted": res.Aborted})
	finished := Finished{RunID: id, Result: &res}
	if h := m.History(); h != nil {
		if saved, err := h.Save(id, res); err != nil {
			devlog.Err("loadtest", "run not saved to the history", err, map[string]any{"runId": id})
		} else {
			finished.Saved = &saved
		}
	}
	m.send(EventFinished, finished)
}

func (m *Manager) finish(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running == id {
		m.cancel()
		m.running, m.cancel = "", nil
	}
}

func (m *Manager) send(event string, payload any) {
	m.mu.Lock()
	emit := m.emit
	m.mu.Unlock()
	if emit != nil {
		emit(event, payload)
	}
}

// Stop ends the run: requests in flight are canceled and the partial result is sent as aborted.
// Stopping an id that is not running is a no-op.
func (m *Manager) Stop(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running == id && m.cancel != nil {
		m.cancel()
	}
}

// Running returns the id of the run in progress, or "".
func (m *Manager) Running() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

// Shutdown stops the run in progress and waits for it to release its connections.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	cancel, done := m.cancel, m.done
	m.mu.Unlock()
	if cancel != nil {
		cancel()
		<-done
	}
}

func newRunID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand.Read never fails on supported platforms
	return "lt-" + hex.EncodeToString(b)
}
