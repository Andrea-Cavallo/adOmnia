package devsession

import (
	"sync"
	"time"

	"adomnia/internal/browser"
	"adomnia/internal/proxy"
)

const maxBrowserRuns = 500

// trafficSources ties requests that reach a live Go service from the
// Interceptor or from a page under Browser Debug to its session, like the
// requests sent from the API workspace.
type trafficSources struct {
	manager *Manager
	mu      sync.Mutex
	browser map[string]browserRun
}

type browserRun struct {
	runID   string
	started time.Time
}

// AttachTrafficSources makes the Interceptor and Browser Debug report the
// requests they see to the manager.
func AttachTrafficSources(manager *Manager) {
	sources := &trafficSources{manager: manager, browser: map[string]browserRun{}}
	proxy.SetTrafficObserver(sources)
	browser.SetNetworkObserver(sources.observeBrowser)
}

// Started implements proxy.TrafficObserver: the forwarded request carries the
// session's correlation id, so the service's logs tie back to it.
func (s *trafficSources) Started(method, url string) (map[string]string, func(int, string)) {
	run, err := s.manager.Begin(BeginRequest{Method: method, URL: url, Name: "Interceptor"})
	if err != nil || run.ID == "" {
		return nil, nil
	}
	started := time.Now()
	return map[string]string{CorrelationHeader: run.CorrelationID}, func(status int, errText string) {
		_, _ = s.manager.End(run.ID, status, time.Since(started).Milliseconds(), errText)
	}
}

func (s *trafficSources) observeBrowser(observation browser.NetworkObservation) {
	switch observation.Kind {
	case "started":
		run, err := s.manager.Begin(BeginRequest{Method: observation.Method, URL: observation.URL, Name: "Browser Debug"})
		if err != nil || run.ID == "" {
			return
		}
		s.mu.Lock()
		// CDP reuses the request id across redirects: the previous hop is over.
		if previous, ok := s.browser[observation.RequestID]; ok {
			go func() {
				_, _ = s.manager.End(previous.runID, 0, time.Since(previous.started).Milliseconds(), "redirected")
			}()
		}
		if len(s.browser) >= maxBrowserRuns {
			s.browser = map[string]browserRun{} // ponytail: a page that never answers; drop the lot
		}
		s.browser[observation.RequestID] = browserRun{runID: run.ID, started: time.Now()}
		s.mu.Unlock()
	case "responded", "failed":
		s.mu.Lock()
		tracked, ok := s.browser[observation.RequestID]
		delete(s.browser, observation.RequestID)
		s.mu.Unlock()
		if ok {
			_, _ = s.manager.End(tracked.runID, observation.Status, time.Since(tracked.started).Milliseconds(), observation.Error)
		}
	}
}
