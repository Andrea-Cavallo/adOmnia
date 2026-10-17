package preview

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ProxyServer espone un dev server (Vite, Next, …) su una porta loopback propria, aggiungendo il
// bridge alle pagine HTML. Serve a tre cose che il dev server da solo non dà: ricarica/indietro/avanti
// della Live Preview, console ed errori della pagina, e anteprima anche quando il server vieta il
// framing (X-Frame-Options, frame-ancestors). HMR e WebSocket passano invariati.
type ProxyServer struct {
	*hub
	target   *url.URL
	server   *http.Server
	listener net.Listener
}

// StartProxy apre il proxy verso target (l'URL del dev server) su una porta loopback.
func StartProxy(target string, preferredPort int) (*ProxyServer, error) {
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("invalid dev server address %q", target)
	}
	listener, err := listenLoopback(preferredPort)
	if err != nil {
		return nil, err
	}
	p := &ProxyServer{hub: newHub(listener.Addr().(*net.TCPAddr).Port), target: parsed, listener: listener}
	reverse := &httputil.ReverseProxy{
		Rewrite:        p.rewriteRequest,
		ModifyResponse: p.modifyResponse,
		ErrorHandler:   unreachablePage,
		FlushInterval:  -1,
	}
	p.server = &http.Server{Handler: p.handler(reverse), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = p.server.Serve(listener) }()
	return p, nil
}

// Port è la porta del proxy.
func (p *ProxyServer) Port() int { return p.port }

// URL è l'indirizzo del proxy da incorniciare nella Live Preview.
func (p *ProxyServer) URL() string { return baseURL(p.port) }

// Close ferma il proxy e chiude i flussi del bridge.
func (p *ProxyServer) Close() error {
	p.closeStreams()
	return shutdown(p.server, p.listener)
}

func (p *ProxyServer) handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !p.allowedHost(r.Host) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if p.serveLive(w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

// rewriteRequest manda la richiesta al dev server con il suo Host (i dev server rifiutano gli altri)
// e senza compressione, così le pagine HTML si possono leggere e arricchire.
func (p *ProxyServer) rewriteRequest(r *httputil.ProxyRequest) {
	r.SetURL(p.target)
	r.Out.Host = p.target.Host
	r.Out.Header.Set("Accept-Encoding", "identity")
	if origin := r.In.Header.Get("Origin"); origin != "" {
		r.Out.Header.Set("Origin", p.target.Scheme+"://"+p.target.Host)
	}
}

var frameAncestors = regexp.MustCompile(`(?i)(^|;)\s*frame-ancestors[^;]*`)

func (p *ProxyServer) modifyResponse(response *http.Response) error {
	header := response.Header
	header.Del("X-Frame-Options")
	if policy := header.Values("Content-Security-Policy"); len(policy) > 0 {
		header.Del("Content-Security-Policy")
		for _, value := range policy {
			if cleaned := strings.TrimLeft(frameAncestors.ReplaceAllString(value, ""), "; "); cleaned != "" {
				header.Add("Content-Security-Policy", cleaned)
			}
		}
	}
	if location := header.Get("Location"); location != "" {
		header.Set("Location", p.rewriteLocation(location))
	}
	if !isHTMLResponse(response) {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxInjectedBytes+1))
	_ = response.Body.Close()
	if err != nil {
		return err
	}
	if len(body) > maxInjectedBytes {
		return fmt.Errorf("page larger than %d bytes", maxInjectedBytes)
	}
	body = injectLiveClient(body)
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	header.Set("Content-Length", strconv.Itoa(len(body)))
	header.Del("Etag")
	return nil
}

func isHTMLResponse(response *http.Response) bool {
	if response.Header.Get("Content-Encoding") != "" || response.StatusCode == http.StatusNotModified || response.StatusCode == http.StatusSwitchingProtocols {
		return false
	}
	mediaType := strings.ToLower(strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0]))
	return mediaType == "text/html"
}

// rewriteLocation riporta sul proxy i redirect assoluti verso il dev server.
func (p *ProxyServer) rewriteLocation(location string) string {
	parsed, err := url.Parse(location)
	if err != nil || !parsed.IsAbs() || !strings.EqualFold(parsed.Host, p.target.Host) {
		return location
	}
	parsed.Scheme, parsed.Host = "http", net.JoinHostPort(LoopbackHost, strconv.Itoa(p.port))
	return parsed.String()
}

// unreachablePage spiega che il dev server non risponde e riprova da sola: succede durante un riavvio.
func unreachablePage(w http.ResponseWriter, _ *http.Request, err error) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusBadGateway)
	_, _ = io.WriteString(w, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Dev server unreachable</title>`+
		`<body style="font:14px system-ui;margin:3rem;color:#667"><h3>The dev server is not answering</h3><p>adOmnia retries automatically. If it stays like this, check the Run console.</p></body>`)
	_ = err
}
