package loadtest

import (
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func runLoadTest(t *testing.T, payload string) loadTestResult {
	t.Helper()
	recorder := httptest.NewRecorder()
	loadTestHandler(recorder, httptest.NewRequest(http.MethodPost, "/loadtest", strings.NewReader(payload)))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status %d: %s", recorder.Code, recorder.Body.String())
	}
	var result loadTestResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

// Warmup larger than the request count used to swallow every request: an all-zero report.
func TestWarmupNeverSwallowsEveryRequest(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	defer target.Close()
	result := runLoadTest(t, `{"url":"`+target.URL+`","totalReqs":2,"warmupReqs":5,"concurrency":2}`)
	if result.Successful != 2 || result.AvgMs <= 0 {
		t.Fatalf("want 2 measured requests with a latency, got %+v", result)
	}
}

func TestStaggerSpacesRequestStarts(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	defer target.Close()
	result := runLoadTest(t, `{"url":"`+target.URL+`","totalReqs":2,"concurrency":2,"staggerMs":200}`)
	if len(result.Timeline) != 2 {
		t.Fatalf("timeline %+v", result.Timeline)
	}
	gap := result.Timeline[0].StartMs - result.Timeline[1].StartMs
	if gap < 0 {
		gap = -gap
	}
	if gap < 190 {
		t.Fatalf("starts only %.0f ms apart", gap)
	}
}
