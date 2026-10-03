package testing

import (
	"adomnia/internal/ide/run"
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"
)

type Snapshot struct {
	Metadata   json.RawMessage `json:"-"`
	RunID      run.RunID       `json:"runId"`
	SessionID  run.SessionID   `json:"sessionId"`
	Request    json.RawMessage `json:"request"`
	Command    string          `json:"command"`
	Status     string          `json:"status"`
	Summary    TestSummary     `json:"summary"`
	Results    []TestResult    `json:"results"`
	Overflow   bool            `json:"overflow,omitempty"`
	StartedAt  time.Time       `json:"startedAt"`
	FinishedAt *time.Time      `json:"finishedAt,omitempty"`
}

// Hooks enrich neutral results inside the run lock. They must not call Manager.
type Hooks struct {
	Metadata func() json.RawMessage
	Line     func([]byte)
	Results  func([]TestResult)
	Finish   func(run.Execution)
	Publish  func(Snapshot)
}
type testRun struct {
	publication     sync.Mutex
	mu              sync.Mutex
	snapshot        Snapshot
	tree            *Tree
	parser          EventParser
	hooks           Hooks
	pending         []byte
	dirty, finished bool
}
type Manager struct {
	mu   sync.Mutex
	runs map[run.RunID]*testRun
}

func NewManager() *Manager { return &Manager{runs: make(map[run.RunID]*testRun)} }

func (m *Manager) Start(processes *run.ProcessManager, spec run.CommandSpec, parser EventParser, request json.RawMessage, hooks Hooks) (Snapshot, error) {
	if parser == nil {
		return Snapshot{}, fmt.Errorf("parser dei test non disponibile")
	}
	r := &testRun{tree: NewTree(), parser: parser, hooks: hooks, snapshot: Snapshot{SessionID: spec.SessionID, Request: append(json.RawMessage(nil), request...), Status: TestRunning, StartedAt: time.Now().UTC(), Results: []TestResult{}}}
	ready, stop := make(chan struct{}), make(chan struct{})
	spec.OutputTap = func(stream string, data []byte) {
		if stream != "stdout" {
			return
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		r.pending = append(r.pending, data...)
		for {
			i := bytes.IndexByte(r.pending, '\n')
			if i < 0 {
				break
			}
			r.line(r.pending[:i])
			r.pending = r.pending[i+1:]
		}
		if len(r.pending) > 1<<20 {
			r.pending = nil
		}
	}
	spec.OnExit = func(e run.Execution) {
		<-ready
		close(stop)
		r.publication.Lock()
		defer r.publication.Unlock()
		r.mu.Lock()
		if len(r.pending) > 0 {
			r.line(r.pending)
			r.pending = nil
		}
		r.finished = true
		r.snapshot.Status = e.Status
		if e.Status == "exited" || e.Status == "failed" {
			r.snapshot.Status = "finished"
		}
		end := time.Now().UTC()
		if e.FinishedAt != nil {
			end = e.FinishedAt.UTC()
		}
		r.snapshot.FinishedAt = &end
		if hooks.Finish != nil {
			hooks.Finish(e)
		}
		s := r.snapshotLocked(false)
		r.mu.Unlock()
		m.mu.Lock()
		m.pruneLocked()
		m.mu.Unlock()
		if hooks.Publish != nil {
			hooks.Publish(s)
		}
	}
	e, err := processes.Start(spec)
	if err != nil {
		return Snapshot{}, err
	}
	r.mu.Lock()
	r.snapshot.RunID = e.ID
	r.snapshot.Command = e.Command
	initial := r.snapshotLocked(false)
	r.mu.Unlock()
	m.mu.Lock()
	m.runs[e.ID] = r
	m.pruneLocked()
	m.mu.Unlock()
	close(ready)
	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				r.publication.Lock()
				r.mu.Lock()
				dirty := r.dirty && !r.finished
				r.dirty = false
				s := r.snapshotLocked(false)
				r.mu.Unlock()
				if dirty && hooks.Publish != nil {
					hooks.Publish(s)
				}
				r.publication.Unlock()
			}
		}
	}()
	return initial, nil
}
func (r *testRun) line(line []byte) {
	if event, ok := r.parser.Parse(line); ok {
		r.tree.Apply(event)
		r.dirty = true
	}
	if r.hooks.Line != nil {
		r.hooks.Line(line)
	}
}
func (r *testRun) snapshotLocked(output bool) Snapshot {
	s := r.snapshot
	if r.hooks.Metadata != nil {
		s.Metadata = append(json.RawMessage(nil), r.hooks.Metadata()...)
	}
	s.Request = append(json.RawMessage(nil), s.Request...)
	if s.FinishedAt != nil {
		copy := *s.FinishedAt
		s.FinishedAt = &copy
	}
	s.Results, s.Summary = r.tree.Snapshot()
	if r.hooks.Results != nil {
		r.hooks.Results(s.Results)
	}
	if !output {
		for i := range s.Results {
			s.Results[i].Output = ""
		}
	}
	s.Overflow = r.tree.Overflowed()
	return s
}
func (m *Manager) pruneLocked() {
	for len(m.runs) > 20 {
		var oldest *testRun
		var key run.RunID
		for id, r := range m.runs {
			r.mu.Lock()
			finished := r.finished
			r.mu.Unlock()
			if finished && (oldest == nil || r.snapshot.StartedAt.Before(oldest.snapshot.StartedAt)) {
				oldest, key = r, id
			}
		}
		if oldest == nil {
			return
		}
		delete(m.runs, key)
	}
}
func (m *Manager) Snapshot(id run.RunID) (Snapshot, error) {
	m.mu.Lock()
	r := m.runs[id]
	m.mu.Unlock()
	if r == nil {
		return Snapshot{}, fmt.Errorf("esecuzione di test non trovata")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshotLocked(true), nil
}
func (m *Manager) Output(id run.RunID, nodeID string) (string, error) {
	m.mu.Lock()
	r := m.runs[id]
	m.mu.Unlock()
	if r == nil {
		return "", fmt.Errorf("esecuzione di test non trovata")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	n, ok := r.tree.Node(nodeID)
	if !ok {
		return "", fmt.Errorf("test non trovato")
	}
	return n.Output, nil
}
func (m *Manager) List(session run.SessionID) []Snapshot {
	m.mu.Lock()
	ids := make([]run.RunID, 0)
	for id, r := range m.runs {
		if r.snapshot.SessionID == session {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	out := make([]Snapshot, 0, len(ids))
	for _, id := range ids {
		if s, err := m.Snapshot(id); err == nil {
			for i := range s.Results {
				s.Results[i].Output = ""
			}
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out
}
func (m *Manager) CloseSession(id run.SessionID) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, r := range m.runs {
		if r.snapshot.SessionID == id {
			delete(m.runs, key)
		}
	}
}
