// Package headless runs adOmnia requests without the UI: the pm.* script subset, auth
// (OAuth2 token grants, AWS4 signing, vault references) and the request pipeline shared by
// `adomnia run`, `adomnia stress` and the load testing engine.
package headless

import (
	"context"
	"encoding/json/v2"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
)

// Sender performs one HTTP call and returns the response with the latency it measured.
type Sender func(ctx context.Context, req httpexec.HTTPExecRequest) (httpexec.HTTPExecResponse, time.Duration)

// Options tunes Execute. The zero value sends with httpexec.Execute.
type Options struct {
	JarID string // cookie jar shared by the requests of one iteration
	Send  Sender
	// Adjust edits the built payload before it is sent (transport settings of the app).
	Adjust func(*httpexec.HTTPExecRequest)
	// Validate runs after the scripts and before the assertions; a non-empty message fails.
	Validate func(httpexec.HTTPExecResponse) string
}

// Result is one request through the pipeline. Sent is false when it failed or was skipped
// before reaching the network (script, auth, unresolved URL): it then has no latency.
type Result struct {
	Response httpexec.HTTPExecResponse
	Latency  time.Duration
	Sent     bool
	Skipped  string // why the request was not sent although nothing failed
	Error    string // first failure, empty when the request passed
}

// Execute runs pre-request script, auth, payload build, AWS4 signing, the call, post and test
// scripts, Validate and the assertions, in that order. vars is updated by the scripts.
func Execute(ctx context.Context, req requestcontract.Request, vars map[string]string, opts Options) Result {
	if _, err := RunScript(req.Scripts.Pre, vars, nil); err != nil {
		return Result{Error: err.Error()}
	}
	originalAuth := req.Auth
	prepared, err := PrepareAuth(req, vars)
	if err != nil {
		return Result{Error: err.Error()}
	}
	payload, skip, err := requestcontract.BuildHTTPPayload(prepared, requestcontract.Options{Vars: vars, DefaultTime: 30000})
	if skip != "" {
		return Result{Skipped: skip}
	}
	if err != nil {
		return Result{Error: err.Error()}
	}
	if opts.Adjust != nil {
		opts.Adjust(&payload)
	}
	if originalAuth.Type == "aws4" {
		// Signed last: the signature covers the final URL, headers and body.
		if err := ApplyAWS4(&payload, originalAuth, vars, time.Now()); err != nil {
			return Result{Error: err.Error()}
		}
	}
	payload.CookieJarID = opts.JarID
	send := opts.Send
	if send == nil {
		send = executeOnce
	}
	resp, latency := send(ctx, payload)
	out := Result{Response: resp, Latency: latency, Sent: true}
	if resp.Error != nil {
		out.Error = resp.Error.Message
		return out
	}
	if _, err := RunScript(req.Scripts.Post, vars, &resp); err != nil {
		out.Error = err.Error()
		return out
	}
	if _, err := RunScript(req.Scripts.Tests, vars, &resp); err != nil {
		out.Error = err.Error()
		return out
	}
	if opts.Validate != nil {
		if message := opts.Validate(resp); message != "" {
			out.Error = message
			return out
		}
	}
	if message := requestcontract.EvaluateAssertions(req.Assertions, resp); message != "" {
		out.Error = message
	}
	return out
}

// executeOnce is the plain transport: a new connection per call, like Send in the app.
func executeOnce(_ context.Context, req httpexec.HTTPExecRequest) (httpexec.HTTPExecResponse, time.Duration) {
	started := time.Now()
	raw := httpexec.Execute(mustJSON(req))
	latency := time.Since(started)
	var resp httpexec.HTTPExecResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		resp = httpexec.HTTPExecResponse{Error: &httpexec.HTTPExecError{Code: "DECODE_ERR", Message: err.Error()}}
	}
	return resp, latency
}

func mustJSON(v any) string {
	data, err := jsonutil.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(data)
}
