package httpexec

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// HTTPExecRequest is the payload sent by the frontend to ExecuteHTTP.
type HTTPExecRequest struct {
	Method          string            `json:"method"`
	URL             string            `json:"url"`
	Headers         map[string]string `json:"headers"`
	Body            string            `json:"body"`
	TimeoutMs       int               `json:"timeoutMs"`
	FollowRedirects bool              `json:"followRedirects"`
	SkipTLSVerify   bool              `json:"skipTlsVerify"`
	HostsMap        []HostMapEntry    `json:"hostsMap,omitempty"`
}

// HTTPExecResponse is the result returned by ExecuteHTTP.
type HTTPExecResponse struct {
	Status      int               `json:"status"`
	StatusText  string            `json:"statusText"`
	Headers     map[string]string `json:"headers"`
	Body        string            `json:"body"`
	ContentType string            `json:"contentType"`
	Ms          int64             `json:"ms"`
	Size        int               `json:"size"`
	Error       *HTTPExecError    `json:"error,omitempty"`
}

// HTTPExecError carries a stable code and a human-readable message.
type HTTPExecError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Execute executes an HTTP request via Go's net/http, bypassing browser
// CORS/header/redirect/TLS restrictions.
func Execute(reqJSON string) string {
	var req HTTPExecRequest
	if err := json.Unmarshal([]byte(reqJSON), &req); err != nil {
		return mustJSON(HTTPExecResponse{Error: &HTTPExecError{Code: "PARSE_ERR", Message: err.Error()}})
	}
	return mustJSON(executeHTTPRequest(req))
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func executeHTTPRequest(req HTTPExecRequest) HTTPExecResponse {
	tlsCfg := &tls.Config{InsecureSkipVerify: req.SkipTLSVerify} //nolint:gosec
	transport := &http.Transport{
		TLSClientConfig: tlsCfg,
		DialContext:     buildDialerWithHosts(req.HostsMap),
	}

	client := &http.Client{Transport: transport}
	if !req.FollowRedirects {
		client.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}

	timeoutMs := req.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 30000
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}

	method := strings.ToUpper(req.Method)
	httpReq, err := http.NewRequestWithContext(ctx, method, req.URL, bodyReader)
	if err != nil {
		return HTTPExecResponse{Error: &HTTPExecError{Code: "INVALID_URL", Message: err.Error()}}
	}

	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	start := time.Now()
	httpResp, err := client.Do(httpReq)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		code := "CONN_ERR"
		if ctx.Err() == context.DeadlineExceeded {
			code = "TIMEOUT"
		}
		return HTTPExecResponse{Ms: elapsed, Error: &HTTPExecError{Code: code, Message: err.Error()}}
	}
	defer httpResp.Body.Close()

	limited := io.LimitReader(httpResp.Body, 50<<20) // 50 MB response cap
	bodyBytes, err := io.ReadAll(limited)
	elapsed = time.Since(start).Milliseconds()

	if err != nil {
		return HTTPExecResponse{Ms: elapsed, Error: &HTTPExecError{Code: "READ_ERR", Message: err.Error()}}
	}

	respHeaders := make(map[string]string, len(httpResp.Header))
	for k, vs := range httpResp.Header {
		respHeaders[k] = strings.Join(vs, ", ")
	}

	statusText := strings.TrimPrefix(httpResp.Status, fmt.Sprintf("%d ", httpResp.StatusCode))

	return HTTPExecResponse{
		Status:      httpResp.StatusCode,
		StatusText:  statusText,
		Headers:     respHeaders,
		Body:        string(bodyBytes),
		ContentType: httpResp.Header.Get("Content-Type"),
		Ms:          elapsed,
		Size:        len(bodyBytes),
	}
}
