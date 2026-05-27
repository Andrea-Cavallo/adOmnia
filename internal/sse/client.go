package sse

import (
	"adomnia/internal/httputil"
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type SSEEvent struct {
	Type      string `json:"type"`
	ID        string `json:"id,omitempty"`
	Retry     int    `json:"retry,omitempty"`
	Payload   string `json:"payload"`
	Timestamp int64  `json:"timestamp"`
	System    bool   `json:"system,omitempty"`
}

type SSESession struct {
	id         string
	ctx        context.Context
	cancel     context.CancelFunc
	clients    []chan SSEEvent
	clientsMu  sync.Mutex
	done       chan struct{}
	closeOnce  sync.Once
	createdAt  int64        // UnixNano — immutable after creation
	lastActive atomic.Int64 // UnixNano — updated on any I/O
}

type SSEConnectRequest struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Auth    struct {
		Type     string `json:"type"`
		Token    string `json:"token"`
		Username string `json:"username"`
		Password string `json:"password"`
	} `json:"auth"`
}

type SSEDisconnectRequest struct {
	SessionID string `json:"sessionId"`
}

const (
	maxSSESessions        = 20
	sseSessionIdleTimeout = 5 * time.Minute
)

var sseSessions sync.Map // sessionId -> *SSESession

func sseNewSessionID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

func sseBasicAuth(username, password string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password))
}

func (s *SSESession) touch() {
	s.lastActive.Store(time.Now().UnixNano())
}

func sseSessionCount() int {
	n := 0
	sseSessions.Range(func(_, _ interface{}) bool { n++; return true })
	return n
}

func (s *SSESession) broadcast(ev SSEEvent) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	for _, ch := range s.clients {
		select {
		case ch <- ev:
		default:
		}
	}
}

func (s *SSESession) addClient(ch chan SSEEvent) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	s.clients = append(s.clients, ch)
}

func (s *SSESession) removeClient(ch chan SSEEvent) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	next := s.clients[:0]
	for _, c := range s.clients {
		if c != ch {
			next = append(next, c)
		}
	}
	s.clients = next
}

func (s *SSESession) close() {
	s.closeOnce.Do(func() {
		s.cancel()
	})
}

// ── Session management ───────────────────────────────────────────────────────

type sseSessionInfo struct {
	SessionID string `json:"sessionId"`
	CreatedAt int64  `json:"createdAt"`
	Clients   int    `json:"clients"`
}

var sseReaperOnce sync.Once

func ensureSSEReaper() {
	sseReaperOnce.Do(func() {
		go sseSessionReaper()
	})
}

func sseSessionReaper() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now().UnixNano()
		sseSessions.Range(func(key, value interface{}) bool {
			sess := value.(*SSESession)
			last := sess.lastActive.Load()
			if now-last > int64(sseSessionIdleTimeout) {
				log.Printf("[sse] reaping idle session %s (idle %v)", sess.id, time.Duration(now-last))
				sess.close()
			}
			return true
		})
	}
}

// SseShutdown closes every active SSE session. Safe to call multiple times.
func SseShutdown() {
	sseSessions.Range(func(key, value interface{}) bool {
		sess := value.(*SSESession)
		sess.close()
		return true
	})
}

// SseListHandler lists all active SSE sessions (GET /sse/list).
func SseListHandler(w http.ResponseWriter, r *http.Request) {
	sessions := make([]sseSessionInfo, 0)
	sseSessions.Range(func(key, value interface{}) bool {
		sess := value.(*SSESession)
		sess.clientsMu.Lock()
		clientCount := len(sess.clients)
		sess.clientsMu.Unlock()
		sessions = append(sessions, sseSessionInfo{
			SessionID: sess.id,
			CreatedAt: sess.createdAt,
			Clients:   clientCount,
		})
		return true
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

// SseCloseAllHandler closes every active SSE session (POST /sse/close-all).
func SseCloseAllHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	count := 0
	sseSessions.Range(func(key, value interface{}) bool {
		sess := value.(*SSESession)
		sess.close()
		count++
		return true
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"closed": count})
}

func sseConnectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.JSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req SSEConnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		httputil.JSONError(w, "url required", http.StatusBadRequest)
		return
	}

	if sseSessionCount() >= maxSSESessions {
		httputil.JSONError(w, "max SSE sessions reached", http.StatusTooManyRequests)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, req.URL, nil)
	if err != nil {
		cancel()
		httputil.JSONError(w, "invalid url: "+err.Error(), http.StatusBadRequest)
		return
	}
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Cache-Control", "no-cache")
	for k, v := range req.Headers {
		if strings.TrimSpace(k) != "" {
			httpReq.Header.Set(k, v)
		}
	}
	switch req.Auth.Type {
	case "bearer":
		if req.Auth.Token != "" {
			httpReq.Header.Set("Authorization", "Bearer "+req.Auth.Token)
		}
	case "basic":
		httpReq.Header.Set("Authorization", sseBasicAuth(req.Auth.Username, req.Auth.Password))
	}

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(httpReq)
	if err != nil {
		cancel()
		httputil.JSONError(w, "connect failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		cancel()
		httputil.JSONError(w, fmt.Sprintf("SSE endpoint returned HTTP %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	now := time.Now().UnixNano()
	sessionID := sseNewSessionID()
	sess := &SSESession{id: sessionID, ctx: ctx, cancel: cancel, done: make(chan struct{}), createdAt: now}
	sess.lastActive.Store(now)
	sseSessions.Store(sessionID, sess)
	ensureSSEReaper()
	go sseReadPump(sess, resp)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"sessionId": sessionID})
}

func sseReadPump(sess *SSESession, resp *http.Response) {
	defer func() {
		resp.Body.Close()
		sseSessions.Delete(sess.id)
		sess.broadcast(SSEEvent{
			Type:      "close",
			Payload:   "stream closed",
			Timestamp: time.Now().UnixMilli(),
			System:    true,
		})
		close(sess.done)
	}()

	reader := bufio.NewReader(resp.Body)
	var eventType, eventID string
	var retry int
	var data []string

	dispatch := func() {
		if len(data) == 0 && eventType == "" && eventID == "" && retry == 0 {
			return
		}
		t := eventType
		if t == "" {
			t = "message"
		}
		sess.touch()
		sess.broadcast(SSEEvent{
			Type:      t,
			ID:        eventID,
			Retry:     retry,
			Payload:   strings.Join(data, "\n"),
			Timestamp: time.Now().UnixMilli(),
		})
		eventType = ""
		data = nil
	}

	for {
		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			line = strings.TrimRight(line, "\r\n")
			if line == "" {
				dispatch()
				continue
			}
			if strings.HasPrefix(line, ":") {
				continue
			}
			field, value, ok := strings.Cut(line, ":")
			if ok && strings.HasPrefix(value, " ") {
				value = value[1:]
			}
			switch field {
			case "event":
				eventType = value
			case "data":
				data = append(data, value)
			case "id":
				eventID = value
			case "retry":
				if n, parseErr := strconv.Atoi(value); parseErr == nil {
					retry = n
				}
			}
		}
		if err != nil {
			if sess.ctx.Err() == nil {
				sess.broadcast(SSEEvent{
					Type:      "error",
					Payload:   err.Error(),
					Timestamp: time.Now().UnixMilli(),
					System:    true,
				})
			}
			return
		}
	}
}

func sseStreamHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	val, ok := sseSessions.Load(sessionID)
	if !ok {
		httputil.JSONError(w, "session not found", http.StatusNotFound)
		return
	}
	sess := val.(*SSESession)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	ch := make(chan SSEEvent, 128)
	sess.addClient(ch)
	defer sess.removeClient(ch)

	for {
		select {
		case <-r.Context().Done():
			return
		case <-sess.done:
			return
		case ev := <-ch:
			data, _ := json.Marshal(ev)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func sseDisconnectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httputil.JSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req SSEDisconnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if val, ok := sseSessions.Load(req.SessionID); ok {
		val.(*SSESession).close()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// RegisterHandlers registers Server-Sent Events client sidecar endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/sse/connect", sseConnectHandler)
	mux.HandleFunc("/sse/disconnect", sseDisconnectHandler)
	mux.HandleFunc("/sse/stream", sseStreamHandler)
	mux.HandleFunc("/sse/list", SseListHandler)
	mux.HandleFunc("/sse/close-all", SseCloseAllHandler)
}
