package aigateway

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Config describes the local OpenAI-compatible listener and its upstream.
// The gateway deliberately proxies the wire format without decoding it so
// streaming, tool calls, multimodal messages and future compatible fields are
// preserved for agent clients such as OpenCode and Pi.
type Config struct {
	Port            int
	Token           string
	Provider        string
	UpstreamBaseURL string
	UpstreamAPIKey  string
}

type Status struct {
	Running  bool   `json:"running"`
	Endpoint string `json:"endpoint,omitempty"`
	Port     int    `json:"port,omitempty"`
	Provider string `json:"provider,omitempty"`
}

type Gateway struct {
	mu       sync.RWMutex
	server   *http.Server
	listener net.Listener
	status   Status
}

func New() *Gateway { return &Gateway{} }

func (g *Gateway) Start(cfg Config) (Status, error) {
	if strings.TrimSpace(cfg.Token) == "" {
		return Status{}, fmt.Errorf("gateway token is required")
	}
	if cfg.Port < 0 || cfg.Port > 65535 {
		return Status{}, fmt.Errorf("gateway port must be between 0 and 65535")
	}
	target, err := url.Parse(strings.TrimRight(strings.TrimSpace(cfg.UpstreamBaseURL), "/"))
	if err != nil || target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") {
		return Status{}, fmt.Errorf("invalid gateway upstream URL")
	}

	// Restarting applies a changed provider, endpoint, key, or port atomically
	// from the user's perspective. Stop is safe when the gateway is idle.
	if err := g.Stop(); err != nil {
		return Status{}, err
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.Port))
	if err != nil {
		return Status{}, fmt.Errorf("start AI gateway: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.URL.Path = strings.TrimRight(target.Path, "/") + strings.TrimPrefix(req.URL.Path, "/v1")
			req.Host = target.Host
			if cfg.UpstreamAPIKey == "" {
				req.Header.Del("Authorization")
			} else {
				req.Header.Set("Authorization", "Bearer "+cfg.UpstreamAPIKey)
			}
			req.Header.Set("X-adOmnia-Gateway", "1")
		},
		// Negative means flush every write. This is required for Chat Completions
		// SSE chunks to reach coding agents as soon as the upstream emits them.
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, proxyErr error) {
			writeOpenAIError(w, http.StatusBadGateway, "upstream_error", proxyErr.Error())
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "provider": cfg.Provider})
	})
	mux.Handle("GET /v1/models", authorize(cfg.Token, proxy))
	mux.Handle("POST /v1/chat/completions", authorize(cfg.Token, limitBody(proxy)))

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	status := Status{
		Running:  true,
		Endpoint: fmt.Sprintf("http://127.0.0.1:%d/v1", port),
		Port:     port,
		Provider: cfg.Provider,
	}

	g.mu.Lock()
	g.server = server
	g.listener = listener
	g.status = status
	g.mu.Unlock()

	go func() {
		err := server.Serve(listener)
		if err != nil && err != http.ErrServerClosed {
			log.Printf("[ai-gateway] stopped unexpectedly: %v", err)
		}
		g.mu.Lock()
		if g.server == server {
			g.server = nil
			g.listener = nil
			g.status = Status{}
		}
		g.mu.Unlock()
	}()

	log.Printf("[ai-gateway] listening on 127.0.0.1:%d for provider %s", port, cfg.Provider)
	return status, nil
}

func (g *Gateway) Stop() error {
	g.mu.Lock()
	server := g.server
	g.server = nil
	g.listener = nil
	g.status = Status{}
	g.mu.Unlock()
	if server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		return fmt.Errorf("stop AI gateway: %w", err)
	}
	return nil
}

func (g *Gateway) Status() Status {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.status
}

func authorize(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeOpenAIError(w, http.StatusUnauthorized, "authentication_error", "invalid local gateway token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
		next.ServeHTTP(w, r)
	})
}

func writeOpenAIError(w http.ResponseWriter, status int, errorType, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{"message": message, "type": errorType, "code": nil},
	})
}
