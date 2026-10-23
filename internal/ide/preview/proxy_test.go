package preview

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestProxyForwardsWebSocketsAndRewritesRedirects(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hmr":
			connection, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer connection.Close()
			for {
				kind, message, err := connection.ReadMessage()
				if err != nil {
					return
				}
				_ = connection.WriteMessage(kind, append([]byte("echo:"), message...))
			}
		case "/old":
			http.Redirect(w, r, "http://"+r.Host+"/new", http.StatusFound) // NOSONAR -- test upstream stub: it simulates the redirect the proxy has to rewrite, nothing is user-controlled
		default:
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("<html><body>app</body></html>"))
		}
	}))
	defer upstream.Close()

	proxy, err := StartProxy(upstream.URL, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()

	connection, _, err := websocket.DefaultDialer.Dial("ws://127.0.0.1:"+itoa(proxy.Port())+"/hmr", nil)
	if err != nil {
		t.Fatalf("the HMR websocket must pass through the proxy: %v", err)
	}
	defer connection.Close()
	if err := connection.WriteMessage(websocket.TextMessage, []byte("ping")); err != nil {
		t.Fatal(err)
	}
	if _, reply, err := connection.ReadMessage(); err != nil || string(reply) != "echo:ping" {
		t.Fatalf("websocket echo: %q %v", reply, err)
	}

	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(proxy.URL() + "old")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if location := response.Header.Get("Location"); !strings.HasPrefix(location, "http://127.0.0.1:"+itoa(proxy.Port())+"/") {
		t.Fatalf("a redirect to the dev server must stay on the proxy: %q", location)
	}
}

func TestProxyShowsRetryPageWhenTheDevServerIsDown(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	address := upstream.URL
	upstream.Close()
	proxy, err := StartProxy(address, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	status, body := get(t, proxy.URL())
	if status != http.StatusBadGateway || !strings.Contains(body, "refresh") {
		t.Fatalf("expected the retry page, got %d %q", status, body)
	}
}

func TestProxyRejectsForeignHost(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	defer upstream.Close()
	proxy, err := StartProxy(upstream.URL, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	request, _ := http.NewRequest(http.MethodGet, proxy.URL(), nil)
	request.Host = "evil.example:" + itoa(proxy.Port())
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("a rebound host was accepted: %d", response.StatusCode)
	}
}

func itoa(value int) string { return strconv.Itoa(value) }
