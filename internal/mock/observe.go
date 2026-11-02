package mock

// Hit is a request the mock server received, as seen by an observer outside the
// package (an Agent Task verification recording what the code under test called).
type Hit struct {
	Method       string `json:"method"`
	Path         string `json:"path"`
	Matched      bool   `json:"matched"`
	EndpointPath string `json:"endpointPath,omitempty"`
	ResponseName string `json:"responseName,omitempty"`
	Reason       string `json:"reason,omitempty"`
	Status       int    `json:"status"`
}

// Running reports whether the mock server is listening, and on which port.
func Running() (bool, int) {
	mockSrvMu.Lock()
	defer mockSrvMu.Unlock()
	return mockSrv != nil, mockSrvPort
}

// HitSequence is a cursor: hits recorded after it are returned by HitsSince.
func HitSequence() int64 {
	return mockHitSeq.Load()
}

// HitsSince returns the hits recorded after cursor, oldest first. The in-memory log
// keeps the last 500 hits; dropped tells how many after cursor were already evicted.
func HitsSince(cursor int64) (hits []Hit, dropped int) {
	mockHitsMu.Lock()
	defer mockHitsMu.Unlock()
	for _, entry := range mockHits {
		if entry.seq <= cursor {
			continue
		}
		hits = append(hits, Hit{
			Method: entry.Method, Path: entry.Path, Matched: entry.Matched, EndpointPath: entry.EndpointPath,
			ResponseName: entry.ResponseName, Reason: entry.Reason, Status: entry.Status,
		})
	}
	if total := mockHitSeq.Load() - cursor; total > int64(len(hits)) {
		dropped = int(total) - len(hits)
	}
	return hits, dropped
}
