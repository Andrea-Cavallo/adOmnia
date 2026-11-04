package httpexec

import (
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

func runBatch(t *testing.T, batch BatchRequest) BatchResponse {
	t.Helper()
	data, err := jsonutil.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	var response BatchResponse
	if err := json.Unmarshal([]byte(ExecuteBatch(string(data))), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

// TestBatchSendsDifferentBodiesInParallel proves both halves of the feature at
// once: every request carries its own body and they really run concurrently
// (each one waits for the others, which only ends if they overlap).
func TestBatchSendsDifferentBodiesInParallel(t *testing.T) {
	const count = 3
	var arrived sync.WaitGroup
	arrived.Add(count)
	bodies := map[string]string{}
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body strings.Builder
		buf := make([]byte, 64)
		for {
			read, err := r.Body.Read(buf)
			body.Write(buf[:read])
			if err != nil {
				break
			}
		}
		mu.Lock()
		bodies[r.URL.Query().Get("slot")] = body.String()
		mu.Unlock()
		arrived.Done()
		done := make(chan struct{})
		go func() { arrived.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("batch requests did not overlap: they ran sequentially")
		}
	}))
	defer server.Close()

	requests := make([]HTTPExecRequest, count)
	for index := range requests {
		requests[index] = HTTPExecRequest{
			Method:    "POST",
			URL:       server.URL + "/echo?slot=" + string(rune('a'+index)),
			Headers:   map[string]string{},
			Body:      "payload-" + string(rune('a'+index)),
			TimeoutMs: 3000,
		}
	}
	response := runBatch(t, BatchRequest{Requests: requests, Concurrency: count})
	if response.Error != nil {
		t.Fatalf("batch error: %+v", response.Error)
	}
	if len(response.Results) != count || response.Concurrency != count {
		t.Fatalf("results=%d concurrency=%d, want %d", len(response.Results), response.Concurrency, count)
	}
	for index, item := range response.Results {
		if item.Index != index {
			t.Fatalf("result %d has index %d: order was not preserved", index, item.Index)
		}
		if item.Response.Error != nil || item.Response.Status != http.StatusOK {
			t.Fatalf("result %d: %+v", index, item.Response)
		}
	}
	for index := range requests {
		slot := string(rune('a' + index))
		if got := bodies[slot]; got != "payload-"+slot {
			t.Fatalf("slot %s received %q", slot, got)
		}
	}
}

// TestBatchExpandsOneRequestOverBodies covers the "same request, different
// bodies" shortcut and its cancellable per-variant ids.
func TestBatchExpandsOneRequestOverBodies(t *testing.T) {
	var mu sync.Mutex
	received := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body strings.Builder
		buf := make([]byte, 256)
		for {
			read, err := r.Body.Read(buf)
			body.Write(buf[:read])
			if err != nil {
				break
			}
		}
		mu.Lock()
		received = append(received, r.Header.Get("X-Variant")+"|"+body.String())
		mu.Unlock()
	}))
	defer server.Close()

	base := HTTPExecRequest{
		ID:        "variants",
		Method:    "PUT",
		URL:       server.URL,
		Headers:   map[string]string{"X-Variant": "shared", "Content-Type": "application/json"},
		Body:      `{"v":0}`,
		TimeoutMs: 3000,
	}
	response := runBatch(t, BatchRequest{Request: &base, Bodies: []string{`{"v":1}`, `{"v":2}`}, Concurrency: 2})
	if response.Error != nil {
		t.Fatalf("batch error: %+v", response.Error)
	}
	if len(response.Results) != 2 {
		t.Fatalf("results=%d, want 2", len(response.Results))
	}
	mu.Lock()
	got := append([]string(nil), received...)
	mu.Unlock()
	sort.Strings(got)
	want := []string{`shared|{"v":1}`, `shared|{"v":2}`}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("bodies = %v, want %v", got, want)
	}
	// The base request is reused, so its own body must not have been mutated.
	if base.Body != `{"v":0}` || base.ID != "variants" || len(base.Headers) != 2 {
		t.Fatalf("base request was mutated: %+v", base)
	}
}

// TestBatchIsolatesFailingRequests keeps one unreachable URL from hiding the
// healthy responses.
func TestBatchIsolatesFailingRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	response := runBatch(t, BatchRequest{Requests: []HTTPExecRequest{
		{Method: "GET", URL: "://not a url", Headers: map[string]string{}, TimeoutMs: 500},
		{Method: "GET", URL: server.URL, Headers: map[string]string{}, TimeoutMs: 3000},
	}, Concurrency: 2})
	if response.Error != nil {
		t.Fatalf("batch error: %+v", response.Error)
	}
	if response.Results[0].Response.Error == nil {
		t.Fatal("the invalid URL must fail")
	}
	if response.Results[1].Response.Error != nil || response.Results[1].Response.Status != http.StatusCreated {
		t.Fatalf("healthy request was affected: %+v", response.Results[1].Response)
	}
}

// TestBatchClampsConcurrency keeps the worker pool inside its bounds.
func TestBatchClampsConcurrency(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer server.Close()

	requests := make([]HTTPExecRequest, 3)
	for index := range requests {
		requests[index] = HTTPExecRequest{Method: "GET", URL: server.URL, Headers: map[string]string{}, TimeoutMs: 3000}
	}
	if got := runBatch(t, BatchRequest{Requests: requests, Concurrency: 999}).Concurrency; got != 3 {
		t.Fatalf("concurrency = %d, want the batch size 3", got)
	}
	larger := make([]HTTPExecRequest, defaultBatchConcurrency+2)
	for index := range larger {
		larger[index] = requests[0]
	}
	if got := runBatch(t, BatchRequest{Requests: larger}).Concurrency; got != defaultBatchConcurrency {
		t.Fatalf("concurrency = %d, want the default %d", got, defaultBatchConcurrency)
	}
}

func TestBatchRejectsInvalidPayloads(t *testing.T) {
	cases := map[string]BatchRequest{
		"empty":         {},
		"bodies alone":  {Bodies: []string{"x"}},
		"both flavours": {Requests: []HTTPExecRequest{{Method: "GET", URL: "https://example.test"}}, Request: &HTTPExecRequest{}},
		"request alone": {Request: &HTTPExecRequest{Method: "GET", URL: "https://example.test"}},
	}
	for name, batch := range cases {
		data, err := jsonutil.Marshal(batch)
		if err != nil {
			t.Fatal(err)
		}
		var response BatchResponse
		if err := json.Unmarshal([]byte(ExecuteBatch(string(data))), &response); err != nil {
			t.Fatal(err)
		}
		if response.Error == nil || response.Error.Code != "BATCH_ERR" {
			t.Fatalf("%s: error = %+v, want BATCH_ERR", name, response.Error)
		}
	}
}

// TestBatchHonoursBatchTimeout proves the batch-level deadline reaches the
// in-flight requests.
func TestBatchHonoursBatchTimeout(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		time.Sleep(300 * time.Millisecond)
	}))
	defer server.Close()

	start := time.Now()
	response := runBatch(t, BatchRequest{
		Requests: []HTTPExecRequest{
			{Method: "GET", URL: server.URL, Headers: map[string]string{}, TimeoutMs: 5000},
			{Method: "GET", URL: server.URL, Headers: map[string]string{}, TimeoutMs: 5000},
		},
		Concurrency: 2,
		TimeoutMs:   50,
	})
	if response.Error != nil {
		t.Fatalf("batch error: %+v", response.Error)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("batch deadline was ignored: %s", elapsed)
	}
	for index, item := range response.Results {
		if item.Response.Error == nil || item.Response.Error.Code != "TIMEOUT" {
			t.Fatalf("result %d: %+v, want TIMEOUT", index, item.Response.Error)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want 2", calls.Load())
	}
}
