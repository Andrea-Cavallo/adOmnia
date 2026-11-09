package ws

import (
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
	"github.com/gorilla/websocket"
)

// connectProxy is an HTTP CONNECT proxy that sends every tunnel to target, whatever host was
// asked: the WebSocket host below exists only through it.
func connectProxy(t *testing.T, target string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var tunnels atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			http.Error(w, "CONNECT only", http.StatusMethodNotAllowed)
			return
		}
		upstream, err := net.Dial("tcp", target)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		tunnels.Add(1)
		client, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			_ = upstream.Close()
			return
		}
		_, _ = client.Write([]byte("HTTP/1.1 200 Connection established\r\n\r\n"))
		go func() { _, _ = io.Copy(upstream, client); _ = upstream.Close() }()
		go func() { _, _ = io.Copy(client, upstream); _ = client.Close() }()
	}))
	t.Cleanup(proxy.Close)
	return proxy, &tunnels
}

func useNetworkSettings(t *testing.T, settings netpolicy.Settings) {
	t.Helper()
	previous := netpolicy.Current()
	if _, err := netpolicy.Save(settings); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = netpolicy.Save(previous) })
}

func TestDialGoesThroughTheConfiguredProxy(t *testing.T) {
	upstream := newWSUpstream(t)
	proxy, tunnels := connectProxy(t, strings.TrimPrefix(upstream.server.URL, "http://"))
	useNetworkSettings(t, netpolicy.Settings{ProxyURL: proxy.URL})

	dialer, err := wsDialer(nil)
	if err != nil {
		t.Fatal(err)
	}
	// The host does not resolve: only the proxy knows where it is, as on a corporate network.
	conn, _, err := dialer.Dial("ws://only-through-proxy.invalid/", nil)
	if err != nil {
		t.Fatalf("dial through the proxy: %v", err)
	}
	defer conn.Close()
	if tunnels.Load() != 1 {
		t.Fatalf("tunnels through the proxy = %d, want 1", tunnels.Load())
	}
	if err := conn.WriteMessage(websocket.TextMessage, []byte("hello")); err != nil {
		t.Fatal(err)
	}
	if _, echoed, err := conn.ReadMessage(); err != nil || string(echoed) != "hello" {
		t.Fatalf("echo through the proxy = %q, %v", echoed, err)
	}
}

func TestHandshakeErrorQuotesTheServerRefusal(t *testing.T) {
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
	}))
	t.Cleanup(refusing.Close)
	dialer, err := wsDialer(nil)
	if err != nil {
		t.Fatal(err)
	}
	_, response, err := dialer.Dial("ws"+strings.TrimPrefix(refusing.URL, "http"), nil)
	message := handshakeError(err, response)
	if !strings.Contains(message, "403 Forbidden") || !strings.Contains(message, "origin not allowed") {
		t.Fatalf("message = %q", message)
	}
}

func TestDroppedConnectionsGetAHint(t *testing.T) {
	for _, err := range []error{io.ErrUnexpectedEOF, &websocket.CloseError{Code: websocket.CloseAbnormalClosure, Text: io.ErrUnexpectedEOF.Error()}} {
		if message := readError(err); !strings.Contains(message, "without a close frame") || !strings.Contains(message, "Settings → Network") {
			t.Fatalf("readError(%v) = %q", err, message)
		}
	}
	if message := handshakeError(io.ErrUnexpectedEOF, nil); !strings.Contains(message, "during the handshake") {
		t.Fatalf("handshakeError = %q", message)
	}
	if message := readError(errors.New("websocket: close 1008 (policy violation): bad token")); strings.Contains(message, "Settings") {
		t.Fatalf("a close with a reason needs no hint: %q", message)
	}
}

func TestDialNegotiatesCompressionWithAServerThatOffersIt(t *testing.T) {
	upgrader := websocket.Upgrader{EnableCompression: true}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			kind, data, err := conn.ReadMessage()
			if err != nil || conn.WriteMessage(kind, data) != nil {
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	dialer, err := wsDialer(nil)
	if err != nil {
		t.Fatal(err)
	}
	conn, response, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if !strings.Contains(response.Header.Get("Sec-WebSocket-Extensions"), "permessage-deflate") {
		t.Fatalf("extensions = %q, want permessage-deflate", response.Header.Get("Sec-WebSocket-Extensions"))
	}
	payload := strings.Repeat(`{"order":42,"status":"shipped"}`, 2000)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(payload)); err != nil {
		t.Fatal(err)
	}
	if _, echoed, err := conn.ReadMessage(); err != nil || string(echoed) != payload {
		t.Fatalf("compressed echo: %d bytes, %v", len(echoed), err)
	}
}
