package devsession

import "fmt"

const MaxCapturedGoroutines = 128
const maxGoroutineCaptures = 8

func cloneGoroutineCaptures(captures []GoroutineCapture) []GoroutineCapture {
	out := append([]GoroutineCapture(nil), captures...)
	for i := range out {
		out[i].Goroutines = append([]CapturedGoroutine(nil), out[i].Goroutines...)
		for j := range out[i].Goroutines {
			out[i].Goroutines[j].Stack = append([]Frame(nil), out[i].Goroutines[j].Stack...)
		}
	}
	return out
}

// Snapshot the stopped process; reject results after resume or another debugger stop.
func (m *Manager) CaptureGoroutines(runID, sessionID string) (RequestRun, error) {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	run := m.runs[runID]
	if !ok || run == nil || !runIncludes(run, sessionID) || session.State != StatePaused || session.Pause == nil {
		m.mu.Unlock()
		return RequestRun{}, fmt.Errorf("pause a participating service before capturing its goroutines")
	}
	if m.hooks.Threads == nil || m.hooks.Stack == nil {
		m.mu.Unlock()
		return RequestRun{}, fmt.Errorf("goroutine capture unavailable")
	}
	debugID := session.ResourceID
	gen := m.debugGen[sessionID]
	capture := GoroutineCapture{SessionID: sessionID, At: m.now(), StoppedThreadID: session.Pause.ThreadID, Goroutines: []CapturedGoroutine{}}
	m.mu.Unlock()
	threads, err := m.hooks.Threads(debugID)
	if err != nil {
		capture.Error = err.Error()
	} else {
		capture.Total = len(threads)
		capture.Truncated = len(threads) > MaxCapturedGoroutines
		if capture.Truncated {
			threads = threads[:MaxCapturedGoroutines]
		}
		for _, thread := range threads {
			m.mu.Lock()
			current := m.sessions[sessionID]
			valid := current != nil && current.State == StatePaused && m.debugGen[sessionID] == gen
			m.mu.Unlock()
			if !valid {
				return RequestRun{}, fmt.Errorf("the service resumed while capturing goroutines")
			}
			frames, e := m.hooks.Stack(debugID, thread.ID)
			item := CapturedGoroutine{Thread: thread, Stack: frames}
			if e != nil {
				item.Error = e.Error()
			}
			capture.Goroutines = append(capture.Goroutines, item)
		}
	}
	m.mu.Lock()
	session = m.sessions[sessionID]
	run = m.runs[runID]
	if run == nil || session == nil || session.State != StatePaused || m.debugGen[sessionID] != gen {
		m.mu.Unlock()
		return RequestRun{}, fmt.Errorf("goroutine capture is stale")
	}
	run.GoroutineCaptures = append(run.GoroutineCaptures, capture)
	if len(run.GoroutineCaptures) > maxGoroutineCaptures {
		run.GoroutineCaptures = run.GoroutineCaptures[len(run.GoroutineCaptures)-maxGoroutineCaptures:]
	}
	out := cloneRun(run)
	m.mu.Unlock()
	m.publish([]Event{{Type: "request.updated", SessionID: sessionID, Payload: out}})
	return out, nil
}
