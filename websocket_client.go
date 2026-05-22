package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// ── Types ────────────────────────────────────────────────────────────────────

const (
	maxWSSessions       = 20
	wsSessionIdleTimeout = 5 * time.Minute
)

type WSEvent struct {
	Type      string `json:"type"`           // message | ping | pong | close | error
	Direction string `json:"direction"`      // inbound | outbound | system
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"`
	Binary    bool   `json:"binary,omitempty"` // true when payload is base64-encoded binary
}

type WSSession struct {
	id         string
	conn       *websocket.Conn
	mu         sync.Mutex
	clients    []chan WSEvent
	clientsMu  sync.Mutex
	done       chan struct{}
	closeOnce  sync.Once
	createdAt  int64       // UnixNano — immutable after creation
	lastActive atomic.Int64 // UnixNano — updated on any I/O
}

type WSConnectRequest struct {
	URL          string            `json:"url"`
	Headers      map[string]string `json:"headers"`
	Subprotocols []string          `json:"subprotocols,omitempty"`
	Auth         struct {
		Type     string `json:"type"` // none | bearer | basic
		Token    string `json:"token"`
		Username string `json:"username"`
		Password string `json:"password"`
	} `json:"auth"`
}

type WSSendRequest struct {
	SessionID   string `json:"sessionId"`
	Content     string `json:"content"`
	MessageType string `json:"messageType,omitempty"` // "text" | "binary" (base64 payload)
}

type WSPingRequest struct {
	SessionID string `json:"sessionId"`
}

type WSDisconnectRequest struct {
	SessionID string `json:"sessionId"`
}

// ── State ────────────────────────────────────────────────────────────────────

var wsSessions sync.Map // sessionId → *WSSession

// ── Helpers ──────────────────────────────────────────────────────────────────

func wsNewSessionID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

func (s *WSSession) touch() {
	s.lastActive.Store(time.Now().UnixNano())
}

func wsSessionCount() int {
	n := 0
	wsSessions.Range(func(_, _ interface{}) bool { n++; return true })
	return n
}

func wsBasicAuth(username, password string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password))
}

func (s *WSSession) broadcast(ev WSEvent) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	for _, ch := range s.clients {
		select {
		case ch <- ev:
		default:
		}
	}
}

func (s *WSSession) addClient(ch chan WSEvent) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	s.clients = append(s.clients, ch)
}

func (s *WSSession) removeClient(ch chan WSEvent) {
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

func (s *WSSession) closeConn() {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		s.conn.Close()
		s.mu.Unlock()
	})
}

// ── Session management ───────────────────────────────────────────────────────

type wsSessionInfo struct {
	SessionID string `json:"sessionId"`
	CreatedAt int64  `json:"createdAt"`
	Clients   int    `json:"clients"`
}

var wsReaperOnce sync.Once

func ensureWSReaper() {
	wsReaperOnce.Do(func() {
		go wsSessionReaper()
	})
}

func wsSessionReaper() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now().UnixNano()
		wsSessions.Range(func(key, value interface{}) bool {
			sess := value.(*WSSession)
			last := sess.lastActive.Load()
			if now-last > int64(wsSessionIdleTimeout) {
				log.Printf("[ws] reaping idle session %s (idle %v)", sess.id, time.Duration(now-last))
				sess.closeConn()
			}
			return true
		})
	}
}

// WsShutdown closes every active WebSocket session. Safe to call multiple times.
func WsShutdown() {
	wsSessions.Range(func(key, value interface{}) bool {
		sess := value.(*WSSession)
		sess.closeConn()
		return true
	})
}

// WsListHandler lists all active WebSocket sessions (GET /ws/list).
func WsListHandler(w http.ResponseWriter, r *http.Request) {
	sessions := make([]wsSessionInfo, 0)
	wsSessions.Range(func(key, value interface{}) bool {
		sess := value.(*WSSession)
		sess.clientsMu.Lock()
		clientCount := len(sess.clients)
		sess.clientsMu.Unlock()
		sessions = append(sessions, wsSessionInfo{
			SessionID: sess.id,
			CreatedAt: sess.createdAt,
			Clients:   clientCount,
		})
		return true
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

// WsCloseAllHandler closes every active WebSocket session (POST /ws/close-all).
func WsCloseAllHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	count := 0
	wsSessions.Range(func(key, value interface{}) bool {
		sess := value.(*WSSession)
		sess.closeConn()
		count++
		return true
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"closed": count})
}

// ── Read pump ────────────────────────────────────────────────────────────────

func wsReadPump(sess *WSSession) {
	defer func() {
		wsSessions.Delete(sess.id)
		sess.broadcast(WSEvent{
			Type:      "close",
			Direction: "system",
			Content:   "connection closed",
			Timestamp: time.Now().UnixMilli(),
		})
		close(sess.done)
	}()

	for {
		mt, data, err := sess.conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				sess.broadcast(WSEvent{
					Type:      "error",
					Direction: "system",
					Content:   err.Error(),
					Timestamp: time.Now().UnixMilli(),
				})
			}
			return
		}
		sess.touch()
		evType := "message"
		if mt == websocket.PongMessage {
			evType = "pong"
		}
		isBinary := mt == websocket.BinaryMessage
		content := string(data)
		if isBinary {
			content = base64.StdEncoding.EncodeToString(data)
		}
		sess.broadcast(WSEvent{
			Type:      evType,
			Direction: "inbound",
			Content:   content,
			Timestamp: time.Now().UnixMilli(),
			Binary:    isBinary,
		})
	}
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func wsConnectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req WSConnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}

	if wsSessionCount() >= maxWSSessions {
		jsonError(w, "max WebSocket sessions reached", http.StatusTooManyRequests)
		return
	}

	headers := http.Header{}
	for k, v := range req.Headers {
		if k != "" {
			headers.Set(k, v)
		}
	}
	switch req.Auth.Type {
	case "bearer":
		headers.Set("Authorization", "Bearer "+req.Auth.Token)
	case "basic":
		headers.Set("Authorization", wsBasicAuth(req.Auth.Username, req.Auth.Password))
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
		Subprotocols:     req.Subprotocols,
	}
	conn, _, err := dialer.Dial(req.URL, headers)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	now := time.Now().UnixNano()
	sessionID := wsNewSessionID()
	sess := &WSSession{
		id:         sessionID,
		conn:       conn,
		done:       make(chan struct{}),
		createdAt:  now,
	}
	sess.lastActive.Store(now)
	wsSessions.Store(sessionID, sess)
	ensureWSReaper()
	go wsReadPump(sess)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"sessionId": sessionID})
}

func wsStreamHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	val, ok := wsSessions.Load(sessionID)
	if !ok {
		jsonError(w, "session not found", http.StatusNotFound)
		return
	}
	sess := val.(*WSSession)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	ch := make(chan WSEvent, 64)
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

func wsSendHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req WSSendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	val, ok := wsSessions.Load(req.SessionID)
	if !ok {
		jsonError(w, "session not found", http.StatusNotFound)
		return
	}
	sess := val.(*WSSession)

	msgType := websocket.TextMessage
	payload := []byte(req.Content)
	isBinary := req.MessageType == "binary"
	if isBinary {
		decoded, decErr := base64.StdEncoding.DecodeString(req.Content)
		if decErr != nil {
			jsonError(w, "invalid base64 payload: "+decErr.Error(), http.StatusBadRequest)
			return
		}
		msgType = websocket.BinaryMessage
		payload = decoded
	}

	sess.mu.Lock()
	err := sess.conn.WriteMessage(msgType, payload)
	sess.mu.Unlock()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sess.touch()
	sess.broadcast(WSEvent{
		Type:      "message",
		Direction: "outbound",
		Content:   req.Content,
		Timestamp: time.Now().UnixMilli(),
		Binary:    isBinary,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func wsPingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req WSPingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	val, ok := wsSessions.Load(req.SessionID)
	if !ok {
		jsonError(w, "session not found", http.StatusNotFound)
		return
	}
	sess := val.(*WSSession)
	sess.mu.Lock()
	err := sess.conn.WriteMessage(websocket.PingMessage, []byte("ping"))
	sess.mu.Unlock()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sess.touch()
	sess.broadcast(WSEvent{
		Type:      "ping",
		Direction: "outbound",
		Content:   "ping",
		Timestamp: time.Now().UnixMilli(),
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func wsDisconnectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req WSDisconnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	val, ok := wsSessions.Load(req.SessionID)
	if ok {
		sess := val.(*WSSession)
		sess.closeConn()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

