package httpexec

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"sync"
	"time"
)

const (
	// defaultBatchConcurrency overlaps enough latency to feel instant without
	// opening dozens of sockets for a handful of requests.
	defaultBatchConcurrency = 4
	// maxBatchConcurrency bounds the sockets one call may open at once.
	maxBatchConcurrency = 64
	// maxBatchRequests bounds one call: every item keeps its whole response in
	// memory until the batch returns.
	maxBatchRequests = 500
)

// BatchRequest is the payload of ExecuteBatch: either independent requests,
// each with its own body, or one base request expanded over a list of bodies.
type BatchRequest struct {
	// Requests are sent as they are; each may carry its own method, body and id.
	Requests []HTTPExecRequest `json:"requests,omitempty"`
	// Request is the base request used together with Bodies.
	Request *HTTPExecRequest `json:"request,omitempty"`
	// Bodies replaces the base request body once per item (`request` + `bodies`).
	Bodies []string `json:"bodies,omitempty"`
	// Concurrency is how many requests are in flight at once (default 4, max 64).
	Concurrency int `json:"concurrency,omitempty"`
	// TimeoutMs caps the whole batch; 0 leaves each request with its own timeout.
	TimeoutMs int `json:"timeoutMs,omitempty"`
}

// BatchItemResponse is one result: Index is the position in the input, so a
// caller can pair responses with requests even though they finish out of order.
type BatchItemResponse struct {
	Index    int              `json:"index"`
	Response HTTPExecResponse `json:"response"`
}

// BatchResponse is the result of a batch. Error is set only when the batch
// itself could not run (bad payload, no requests, too many): a failing request
// stays inside its BatchItemResponse.
type BatchResponse struct {
	Results     []BatchItemResponse `json:"results"`
	Concurrency int                 `json:"concurrency"`
	Ms          int64               `json:"ms"`
	Error       *HTTPExecError      `json:"error,omitempty"`
}

// ExecuteBatch sends a batch of requests in parallel and returns its JSON
// result.
func ExecuteBatch(batchJSON string) string {
	return ExecuteBatchWithHooks(batchJSON, nil)
}

// ExecuteBatchWithHooks runs a batch with plugin transformations applied to
// every request and response, exactly like ExecuteWithHooks does for one call.
func ExecuteBatchWithHooks(batchJSON string, transform func(eventType, payloadJSON string) (string, error)) string {
	var batch BatchRequest
	if err := json.Unmarshal([]byte(batchJSON), &batch); err != nil {
		return mustJSON(BatchResponse{Error: &HTTPExecError{Code: "PARSE_ERR", Message: err.Error()}})
	}
	return mustJSON(executeBatch(batch, transform))
}

func executeBatch(batch BatchRequest, transform hookTransform) BatchResponse {
	requests, err := batch.expand()
	if err != nil {
		return BatchResponse{Error: &HTTPExecError{Code: "BATCH_ERR", Message: err.Error()}}
	}

	workers := batch.workerCount(len(requests))
	ctx := context.Background()
	cancel := context.CancelFunc(func() {})
	if batch.TimeoutMs > 0 {
		ctx, cancel = context.WithTimeout(ctx, time.Duration(batch.TimeoutMs)*time.Millisecond)
	}
	defer cancel()

	start := time.Now()
	results := make([]BatchItemResponse, len(requests))
	limit := make(chan struct{}, workers)
	var wg sync.WaitGroup
	for index := range requests {
		wg.Add(1)
		go func(index int, request HTTPExecRequest) {
			defer wg.Done()
			limit <- struct{}{}
			defer func() { <-limit }()
			results[index] = BatchItemResponse{Index: index, Response: executeWithTransform(ctx, request, transform)}
		}(index, requests[index])
	}
	wg.Wait()

	return BatchResponse{Results: results, Concurrency: workers, Ms: time.Since(start).Milliseconds()}
}

// expand turns the payload into the list of requests to send, cloning the base
// request for every body so the items never share mutable state.
func (b BatchRequest) expand() ([]HTTPExecRequest, error) {
	switch {
	case len(b.Requests) > 0 && b.Request != nil:
		return nil, fmt.Errorf("send either requests or request+bodies, not both")
	case len(b.Requests) > 0:
		if len(b.Requests) > maxBatchRequests {
			return nil, fmt.Errorf("at most %d requests per batch, got %d", maxBatchRequests, len(b.Requests))
		}
		return b.Requests, nil
	case b.Request == nil:
		return nil, fmt.Errorf("batch has no requests")
	case len(b.Bodies) == 0:
		return nil, fmt.Errorf("request needs at least one body; use requests for unrelated calls")
	case len(b.Bodies) > maxBatchRequests:
		return nil, fmt.Errorf("at most %d bodies per batch, got %d", maxBatchRequests, len(b.Bodies))
	}

	out := make([]HTTPExecRequest, len(b.Bodies))
	for index, body := range b.Bodies {
		item := *b.Request
		item.Body = body
		item.Headers = cloneHeaders(b.Request.Headers)
		if item.ID != "" {
			// Deterministic ids let the caller cancel one variant with CancelHTTP.
			item.ID = fmt.Sprintf("%s-%d", item.ID, index+1)
		}
		out[index] = item
	}
	return out, nil
}

// workerCount clamps the requested concurrency to the batch size and the limits.
func (b BatchRequest) workerCount(total int) int {
	workers := b.Concurrency
	if workers <= 0 {
		workers = defaultBatchConcurrency
	}
	if workers > maxBatchConcurrency {
		workers = maxBatchConcurrency
	}
	if workers > total {
		workers = total
	}
	if workers < 1 {
		workers = 1
	}
	return workers
}

func cloneHeaders(headers map[string]string) map[string]string {
	if headers == nil {
		return nil
	}
	cloned := make(map[string]string, len(headers))
	for key, value := range headers {
		cloned[key] = value
	}
	return cloned
}
