package ws

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json/v2"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// ── Helpers ──────────────────────────────────────────────────────────────────

type wsUpstream struct {
	server    *httptest.Server
	url       string
	requests  chan http.Header
	protocols chan string
}

// newWSUpstream runs a WebSocket echo server that records the handshake headers
// and the negotiated subprotocol.
func newWSUpstream(t *testing.T) *wsUpstream {
	t.Helper()
	u := &wsUpstream{requests: make(chan http.Header, 16), protocols: make(chan string, 16)}
	upgrader := websocket.Upgrader{
		CheckOrigin:  func(*http.Request) bool { return true },
		Subprotocols: []string{"chat"},
	}
	u.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case u.requests <- r.Header.Clone():
		default:
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		select {
		case u.protocols <- conn.Subprotocol():
		default:
		}
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err := conn.WriteMessage(mt, data); err != nil {
				return
			}
		}
	}))
	t.Cleanup(u.server.Close)
	u.url = "ws" + strings.TrimPrefix(u.server.URL, "http")
	return u
}

func newSidecar(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	RegisterHandlers(mux)
	server := httptest.NewServer(mux)
	t.Cleanup(func() {
		closeAllTestSessions()
		server.Close()
	})
	return server
}

// closeAllTestSessions closes and forgets every session left by a test. Dummy
// sessions used by the limit test have no connection and are only forgotten.
func closeAllTestSessions() {
	wsSessions.Range(func(key, value any) bool {
		if sess, ok := value.(*WSSession); ok && sess.conn != nil {
			sess.closeConn()
		}
		wsSessions.Delete(key)
		return true
	})
}

func postJSON(t *testing.T, endpoint string, body any) (int, []byte) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	resp, err := http.Post(endpoint, "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("POST %s: %v", endpoint, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s: %v", endpoint, err)
	}
	return resp.StatusCode, data
}

func connectWS(t *testing.T, sidecar *httptest.Server, body any) (int, map[string]any) {
	t.Helper()
	code, data := postJSON(t, sidecar.URL+"/ws/connect", body)
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	return code, out
}

func sessionIDOf(t *testing.T, out map[string]any) string {
	t.Helper()
	id, _ := out["sessionId"].(string)
	if id == "" {
		t.Fatalf("no sessionId in %v", out)
	}
	return id
}

// openStream subscribes to /ws/stream and decodes its SSE frames into a channel.
func openStream(t *testing.T, sidecar *httptest.Server, sessionID string) <-chan WSEvent {
	t.Helper()
	resp, err := http.Get(sidecar.URL + "/ws/stream?sessionId=" + url.QueryEscape(sessionID))
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("stream status = %d, want 200", resp.StatusCode)
	}
	t.Cleanup(func() { resp.Body.Close() })
	events := make(chan WSEvent, 32)
	go func() {
		defer resp.Body.Close()
		defer close(events)
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var event WSEvent
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
				continue
			}
			events <- event
		}
	}()
	return events
}

func nextEvent(t *testing.T, events <-chan WSEvent) WSEvent {
	t.Helper()
	select {
	case event, ok := <-events:
		if !ok {
			t.Fatal("stream closed before the expected event")
		}
		return event
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for a stream event")
		return WSEvent{}
	}
}

// expectEvent skips frames until one matches, so event ordering stays irrelevant.
func expectEvent(t *testing.T, events <-chan WSEvent, match func(WSEvent) bool) WSEvent {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		event := nextEvent(t, events)
		if match(event) {
			return event
		}
	}
	t.Fatal("no matching stream event")
	return WSEvent{}
}

func waitStreamClosed(t *testing.T, events <-chan WSEvent) {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case event, ok := <-events:
			if !ok || event.Type == "close" {
				return
			}
		case <-deadline:
			t.Fatal("stream did not close")
		}
	}
}

func waitSessionGone(t *testing.T, sessionID string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := wsSessions.Load(sessionID); !ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("session %s still registered", sessionID)
}

// ── Tests ────────────────────────────────────────────────────────────────────

func TestConnectValidatesURL(t *testing.T) {
	sidecar := newSidecar(t)
	cases := []struct {
		name string
		body map[string]any
	}{
		{"missing", map[string]any{}},
		{"blank", map[string]any{"url": "   "}},
		{"http scheme", map[string]any{"url": "http://example.com/socket"}},
		{"malformed", map[string]any{"url": "://bad"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if code, _ := connectWS(t, sidecar, tc.body); code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", code)
			}
		})
	}
}

func TestConnectRejectsInvalidBody(t *testing.T) {
	sidecar := newSidecar(t)
	resp, err := http.Post(sidecar.URL+"/ws/connect", "application/json", strings.NewReader("{"))
	if err != nil {
		t.Fatalf("POST connect: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestConnectUpstreamFailure(t *testing.T) {
	sidecar := newSidecar(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := "ws" + strings.TrimPrefix(upstream.URL, "http")
	upstream.Close()

	code, body := postJSON(t, sidecar.URL+"/ws/connect", map[string]any{"url": deadURL})
	if code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 (%s)", code, body)
	}
}

func TestConnectionRoundTrip(t *testing.T) {
	sidecar := newSidecar(t)
	upstream := newWSUpstream(t)

	code, out := connectWS(t, sidecar, map[string]any{
		"url":          upstream.url,
		"headers":      map[string]string{"X-Test": "yes"},
		"subprotocols": []string{"chat"},
		"auth":         map[string]any{"type": "bearer", "token": "secret"},
	})
	if code != http.StatusOK {
		t.Fatalf("connect status = %d (%v)", code, out)
	}
	sessionID := sessionIDOf(t, out)

	select {
	case headers := <-upstream.requests:
		if got := headers.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q", got)
		}
		if got := headers.Get("X-Test"); got != "yes" {
			t.Fatalf("X-Test = %q", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upstream handshake never arrived")
	}
	select {
	case protocol := <-upstream.protocols:
		if protocol != "chat" {
			t.Fatalf("subprotocol = %q, want chat", protocol)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upstream subprotocol never reported")
	}

	events := openStream(t, sidecar, sessionID)

	if code, body := postJSON(t, sidecar.URL+"/ws/send", map[string]any{"sessionId": sessionID, "content": "hello"}); code != http.StatusOK {
		t.Fatalf("send status = %d (%s)", code, body)
	}

	sent := expectEvent(t, events, func(event WSEvent) bool { return event.Direction == "outbound" })
	if sent.Type != "message" || sent.Content != "hello" || sent.Binary {
		t.Fatalf("outbound frame = %+v", sent)
	}
	echoed := expectEvent(t, events, func(event WSEvent) bool { return event.Direction == "inbound" })
	if echoed.Type != "message" || echoed.Content != "hello" || echoed.Binary {
		t.Fatalf("inbound frame = %+v", echoed)
	}
	if echoed.Timestamp == 0 {
		t.Fatal("inbound frame has no timestamp")
	}

	if code, body := postJSON(t, sidecar.URL+"/ws/ping", map[string]any{"sessionId": sessionID}); code != http.StatusOK {
		t.Fatalf("ping status = %d (%s)", code, body)
	}
	ping := expectEvent(t, events, func(event WSEvent) bool { return event.Type == "ping" })
	if ping.Direction != "outbound" {
		t.Fatalf("ping direction = %q", ping.Direction)
	}

	if code, body := postJSON(t, sidecar.URL+"/ws/disconnect", map[string]any{"sessionId": sessionID}); code != http.StatusOK {
		t.Fatalf("disconnect status = %d (%s)", code, body)
	}
	waitSessionGone(t, sessionID)
	waitStreamClosed(t, events)
}

func TestBinaryRoundTrip(t *testing.T) {
	sidecar := newSidecar(t)
	upstream := newWSUpstream(t)
	code, out := connectWS(t, sidecar, map[string]any{"url": upstream.url})
	if code != http.StatusOK {
		t.Fatalf("connect status = %d (%v)", code, out)
	}
	sessionID := sessionIDOf(t, out)
	events := openStream(t, sidecar, sessionID)

	payload := base64.StdEncoding.EncodeToString([]byte{0x00, 0x01, 0xfe, 0xff})
	if code, body := postJSON(t, sidecar.URL+"/ws/send", map[string]any{"sessionId": sessionID, "content": payload, "messageType": "binary"}); code != http.StatusOK {
		t.Fatalf("send status = %d (%s)", code, body)
	}
	sent := expectEvent(t, events, func(event WSEvent) bool { return event.Direction == "outbound" })
	if !sent.Binary || sent.Content != payload {
		t.Fatalf("outbound binary frame = %+v", sent)
	}
	echoed := expectEvent(t, events, func(event WSEvent) bool { return event.Direction == "inbound" })
	if !echoed.Binary || echoed.Content != payload {
		t.Fatalf("inbound binary frame = %+v", echoed)
	}
}

func TestSendRejectsInvalidBase64(t *testing.T) {
	sidecar := newSidecar(t)
	upstream := newWSUpstream(t)
	code, out := connectWS(t, sidecar, map[string]any{"url": upstream.url})
	if code != http.StatusOK {
		t.Fatalf("connect status = %d (%v)", code, out)
	}
	sessionID := sessionIDOf(t, out)
	if code, _ := postJSON(t, sidecar.URL+"/ws/send", map[string]any{"sessionId": sessionID, "content": "not base64!", "messageType": "binary"}); code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", code)
	}
}

func TestBasicAuthHeader(t *testing.T) {
	sidecar := newSidecar(t)
	upstream := newWSUpstream(t)
	code, out := connectWS(t, sidecar, map[string]any{
		"url":  upstream.url,
		"auth": map[string]any{"type": "basic", "username": "user", "password": "pass"},
	})
	if code != http.StatusOK {
		t.Fatalf("connect status = %d (%v)", code, out)
	}
	select {
	case headers := <-upstream.requests:
		if got, want := headers.Get("Authorization"), wsBasicAuth("user", "pass"); got != want {
			t.Fatalf("Authorization = %q, want %q", got, want)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upstream handshake never arrived")
	}
}

func TestUnknownSessionEndpoints(t *testing.T) {
	sidecar := newSidecar(t)
	if code, _ := postJSON(t, sidecar.URL+"/ws/send", map[string]any{"sessionId": "missing", "content": "x"}); code != http.StatusNotFound {
		t.Fatalf("send status = %d, want 404", code)
	}
	if code, _ := postJSON(t, sidecar.URL+"/ws/ping", map[string]any{"sessionId": "missing"}); code != http.StatusNotFound {
		t.Fatalf("ping status = %d, want 404", code)
	}
	if code, _ := postJSON(t, sidecar.URL+"/ws/disconnect", map[string]any{"sessionId": "missing"}); code != http.StatusOK {
		t.Fatalf("disconnect status = %d, want 200", code)
	}
	resp, err := http.Get(sidecar.URL + "/ws/stream?sessionId=missing")
	if err != nil {
		t.Fatalf("GET stream: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("stream status = %d, want 404", resp.StatusCode)
	}
}

func TestHandlersRejectWrongMethod(t *testing.T) {
	sidecar := newSidecar(t)
	for _, path := range []string{"/ws/connect", "/ws/send", "/ws/ping", "/ws/disconnect"} {
		resp, err := http.Get(sidecar.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Fatalf("GET %s status = %d, want 405", path, resp.StatusCode)
		}
	}
}

func TestSessionLimit(t *testing.T) {
	sidecar := newSidecar(t)
	for i := 0; i < maxWSSessions; i++ {
		id := fmt.Sprintf("dummy-%d", i)
		wsSessions.Store(id, &WSSession{id: id, done: make(chan struct{})})
	}
	t.Cleanup(func() {
		for i := 0; i < maxWSSessions; i++ {
			wsSessions.Delete(fmt.Sprintf("dummy-%d", i))
		}
	})

	upstream := newWSUpstream(t)
	code, body := postJSON(t, sidecar.URL+"/ws/connect", map[string]any{"url": upstream.url})
	if code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 (%s)", code, body)
	}
}

func TestShutdownClosesSessions(t *testing.T) {
	sidecar := newSidecar(t)
	upstream := newWSUpstream(t)
	code, out := connectWS(t, sidecar, map[string]any{"url": upstream.url})
	if code != http.StatusOK {
		t.Fatalf("connect status = %d (%v)", code, out)
	}
	sessionID := sessionIDOf(t, out)

	WsShutdown()
	waitSessionGone(t, sessionID)
}
