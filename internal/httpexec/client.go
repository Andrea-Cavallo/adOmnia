package httpexec

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"maps"
	"net/http"
	"strings"
	"time"
)

// Client sends the same request many times over one reused transport (load testing). It has
// the configuration Execute would use — TLS, mTLS, PSD2, hosts map, proxy/CA policy, redirects —
// but keeps connections alive, discards the body without buffering it and times in microseconds.
type Client struct {
	base        HTTPExecRequest
	userHeaders map[string]string
	client      *http.Client
	transport   *http.Transport
	timeout     time.Duration
}

// Outcome is one send: Status is 0 when no HTTP response arrived (ErrCode says why).
type Outcome struct {
	Status   int
	Bytes    int64
	Latency  time.Duration
	ErrCode  string
	ErrMsg   string
	Canceled bool // the run was stopped: not a failure of the target
}

// NewClient prepares req for repeated sends with up to maxConns connections per host.
func NewClient(req HTTPExecRequest, maxConns int) (*Client, error) {
	prepared := req
	prepared.Headers = maps.Clone(req.Headers)
	client, transport, execErr := buildClient(&prepared)
	if execErr != nil {
		return nil, errors.New(execErr.Message)
	}
	if maxConns > 0 {
		transport.MaxIdleConnsPerHost = maxConns
		transport.MaxIdleConns = maxConns
	}
	timeout := time.Duration(req.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &Client{base: prepared, userHeaders: maps.Clone(req.Headers), client: client, transport: transport, timeout: timeout}, nil
}

// Send performs one request. A PSD2 request is re-signed every time: Berlin Group headers
// (X-Request-ID, Date, Digest, Signature) must be fresh per call.
func (c *Client) Send(ctx context.Context) Outcome {
	req := c.base
	if req.PSD2 != nil && req.PSD2.Enabled {
		// Start from the user's headers, not the ones signed in NewClient, so every call gets new ones.
		req.Headers = maps.Clone(c.userHeaders)
		// Only the headers matter here: the QWAC is already on the transport.
		// ponytail: reloads QWAC/QSEAL per call; cache the parsed credentials if PSD2 runs get CPU-bound.
		if err := preparePSD2(&req, &tls.Config{}); err != nil {
			return Outcome{ErrCode: "PSD2_ERR", ErrMsg: err.Error()}
		}
	}
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	var body io.Reader
	if req.Body != "" {
		body = strings.NewReader(req.Body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, strings.ToUpper(req.Method), req.URL, body)
	if err != nil {
		return Outcome{ErrCode: "INVALID_URL", ErrMsg: err.Error()}
	}
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := c.client.Do(httpReq)
	if err != nil {
		return failedOutcome(ctx, err, time.Since(start))
	}
	n, err := io.Copy(io.Discard, resp.Body)
	latency := time.Since(start)
	_ = resp.Body.Close() // fully drained above, so the connection goes back to the pool
	if err != nil {
		out := failedOutcome(ctx, err, latency)
		out.Status = resp.StatusCode
		out.ErrCode = "READ_ERR"
		return out
	}
	return Outcome{Status: resp.StatusCode, Bytes: n, Latency: latency}
}

func failedOutcome(ctx context.Context, err error, latency time.Duration) Outcome {
	out := Outcome{Latency: latency, ErrCode: "CONN_ERR", ErrMsg: err.Error()}
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		out.ErrCode, out.ErrMsg = "TIMEOUT", "request timed out"
	case errors.Is(ctx.Err(), context.Canceled):
		out.ErrCode, out.ErrMsg, out.Canceled = "CANCELED", "run stopped", true
	}
	return out
}

// Close releases the pooled connections.
func (c *Client) Close() { c.transport.CloseIdleConnections() }
