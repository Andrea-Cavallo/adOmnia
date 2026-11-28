package httpexec

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"maps"
	"net/http"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// Pool sends requests of different shapes — the steps of a flow under load — over reused
// connections: one transport per transport configuration (TLS, client certificate, hosts map,
// QWAC), a cookie jar per call (CookieJarID), the whole body read like Execute.
type Pool struct {
	maxConns   int
	mu         sync.Mutex
	transports map[string]*http.Transport
	failures   map[string]*HTTPExecError
}

// NewPool keeps up to maxConns idle connections per host.
func NewPool(maxConns int) *Pool {
	return &Pool{maxConns: maxConns, transports: map[string]*http.Transport{}, failures: map[string]*HTTPExecError{}}
}

// Execute sends req and returns the response with its full-precision latency. BodyBase64 is
// not filled: callers under load read Body.
func (p *Pool) Execute(ctx context.Context, req HTTPExecRequest) (HTTPExecResponse, time.Duration) {
	req.Headers = maps.Clone(req.Headers)
	if req.Headers == nil {
		req.Headers = map[string]string{}
	}
	transport, execErr := p.transport(req)
	if execErr != nil {
		return HTTPExecResponse{Error: execErr}, 0
	}
	if req.PSD2 != nil && req.PSD2.Enabled {
		// Fresh Berlin Group headers for every call; the QWAC is already on the transport.
		if err := preparePSD2(&req, &tls.Config{}); err != nil {
			return HTTPExecResponse{Error: &HTTPExecError{Code: "PSD2_ERR", Message: err.Error()}}, 0
		}
	}
	return send(ctx, newClient(transport, &req), req, false)
}

func (p *Pool) transport(req HTTPExecRequest) (*http.Transport, *HTTPExecError) {
	key := transportKey(req)
	p.mu.Lock()
	defer p.mu.Unlock()
	if t, ok := p.transports[key]; ok {
		return t, nil
	}
	if failure, ok := p.failures[key]; ok {
		return nil, failure // a bad certificate fails every call alike, without reloading it
	}
	probe := req
	probe.Headers = maps.Clone(req.Headers)
	t, execErr := buildTransport(&probe)
	if execErr != nil {
		p.failures[key] = execErr
		return nil, execErr
	}
	if p.maxConns > 0 {
		t.MaxIdleConnsPerHost = p.maxConns
		t.MaxIdleConns = p.maxConns * 4
	}
	p.transports[key] = t
	return t, nil
}

// transportKey identifies what buildTransport depends on; secrets enter only as a hash.
func transportKey(req HTTPExecRequest) string {
	shape := struct {
		Skip     bool
		Cert     string
		CertPass string
		Hosts    []HostMapEntry
		QWAC     string
		QWACPass string
	}{Skip: req.SkipTLSVerify, Cert: req.ClientCertPEM, CertPass: req.ClientCertPassphrase, Hosts: req.HostsMap}
	if req.PSD2 != nil && req.PSD2.Enabled {
		shape.QWAC, shape.QWACPass = req.PSD2.QWACPath, req.PSD2.QWACPassword
	}
	data, _ := jsonutil.Marshal(shape) // plain struct of strings, bools and slices: cannot fail
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// Close releases every pooled connection.
func (p *Pool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, t := range p.transports {
		t.CloseIdleConnections()
	}
}
