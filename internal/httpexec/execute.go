package httpexec

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// inFlight tracks cancel functions for running requests, keyed by the
// frontend-supplied request id, so a request can be aborted mid-flight.
var inFlight sync.Map // map[string]context.CancelFunc

// Cancel aborts an in-flight request by id. No-op if the id is unknown.
func Cancel(id string) {
	if id == "" {
		return
	}
	if v, ok := inFlight.Load(id); ok {
		if cancel, ok := v.(context.CancelFunc); ok {
			cancel()
		}
	}
}

// HTTPExecRequest is the payload sent by the frontend to ExecuteHTTP.
type HTTPExecRequest struct {
	ID                   string            `json:"id,omitempty"`
	Method               string            `json:"method"`
	URL                  string            `json:"url"`
	Headers              map[string]string `json:"headers"`
	Body                 string            `json:"body"`
	TimeoutMs            int               `json:"timeoutMs"`
	FollowRedirects      bool              `json:"followRedirects"`
	MaxRedirects         int               `json:"maxRedirects,omitempty"`
	StripAuthOnRedirect  bool              `json:"stripAuthOnRedirect,omitempty"`
	SkipTLSVerify        bool              `json:"skipTlsVerify"`
	ClientCertPEM        string            `json:"clientCertPem,omitempty"`
	ClientCertPassphrase string            `json:"clientCertPassphrase,omitempty"`
	HostsMap             []HostMapEntry    `json:"hostsMap,omitempty"`
}

// HTTPExecResponse is the result returned by ExecuteHTTP.
type HTTPExecResponse struct {
	Status      int               `json:"status"`
	StatusText  string            `json:"statusText"`
	Headers     map[string]string `json:"headers"`
	Body        string            `json:"body"`
	BodyBase64  string            `json:"bodyBase64,omitempty"`
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

	// mTLS: load a client certificate when a PEM path is configured.
	if strings.TrimSpace(req.ClientCertPEM) != "" {
		cert, err := loadClientCert(req.ClientCertPEM, req.ClientCertPassphrase)
		if err != nil {
			return HTTPExecResponse{Error: &HTTPExecError{Code: "MTLS_ERR", Message: err.Error()}}
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	}

	transport := &http.Transport{
		TLSClientConfig: tlsCfg,
		DialContext:     buildDialerWithHosts(req.HostsMap),
	}

	client := &http.Client{Transport: transport}
	if !req.FollowRedirects {
		client.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
	} else {
		maxRedirects := req.MaxRedirects
		if maxRedirects <= 0 {
			maxRedirects = 10
		}
		client.CheckRedirect = func(r *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return http.ErrUseLastResponse
			}
			// Drop credentials when redirected to a different host.
			if req.StripAuthOnRedirect && len(via) > 0 && r.URL.Host != via[0].URL.Host {
				r.Header.Del("Authorization")
				r.Header.Del("Cookie")
			}
			return nil
		}
	}

	timeoutMs := req.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 30000
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	// Register for external cancellation (Cancel button) while the request runs.
	if req.ID != "" {
		inFlight.Store(req.ID, cancel)
		defer inFlight.Delete(req.ID)
	}

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
		switch ctx.Err() {
		case context.DeadlineExceeded:
			code = "TIMEOUT"
		case context.Canceled:
			code = "CANCELED"
		}
		msg := err.Error()
		if code == "CANCELED" {
			msg = "Request cancelled"
		}
		return HTTPExecResponse{Ms: elapsed, Error: &HTTPExecError{Code: code, Message: msg}}
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
		BodyBase64:  base64.StdEncoding.EncodeToString(bodyBytes),
		ContentType: httpResp.Header.Get("Content-Type"),
		Ms:          elapsed,
		Size:        len(bodyBytes),
	}
}

// loadClientCert reads a PEM file containing a certificate and private key for
// mutual TLS. An encrypted private key is decrypted with the given passphrase.
func loadClientCert(path, passphrase string) (tls.Certificate, error) {
	pemData, err := os.ReadFile(path)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("read client certificate: %w", err)
	}

	var certPEM, keyPEM []byte
	rest := pemData
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		switch {
		case strings.Contains(block.Type, "CERTIFICATE"):
			certPEM = append(certPEM, pem.EncodeToMemory(block)...)
		case strings.Contains(block.Type, "PRIVATE KEY"):
			if x509.IsEncryptedPEMBlock(block) { //nolint:staticcheck // legacy encrypted PEM support
				if passphrase == "" {
					return tls.Certificate{}, fmt.Errorf("client certificate key is encrypted but no passphrase was provided")
				}
				decrypted, derr := x509.DecryptPEMBlock(block, []byte(passphrase)) //nolint:staticcheck
				if derr != nil {
					return tls.Certificate{}, fmt.Errorf("decrypt client certificate key: %w", derr)
				}
				block = &pem.Block{Type: block.Type, Bytes: decrypted}
			}
			keyPEM = append(keyPEM, pem.EncodeToMemory(block)...)
		}
	}

	if len(certPEM) == 0 || len(keyPEM) == 0 {
		return tls.Certificate{}, fmt.Errorf("client certificate PEM must contain both a CERTIFICATE and a PRIVATE KEY block")
	}
	return tls.X509KeyPair(certPEM, keyPEM)
}
