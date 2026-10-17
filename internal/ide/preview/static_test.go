package preview

import (
	"bufio"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newSite(t *testing.T) (*StaticServer, string) {
	t.Helper()
	root := t.TempDir()
	write(t, filepath.Join(root, "index.html"), "<html><body><h1>Hi</h1></body></html>")
	write(t, filepath.Join(root, "style.css"), "h1{color:red}")
	write(t, filepath.Join(root, "sub", "index.html"), "<p>sub</p>")
	write(t, filepath.Join(root, ".env"), "SECRET=1")
	write(t, filepath.Join(root, ".git", "config"), "x")
	server, err := StartStatic(StaticOptions{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	return server, root
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func get(t *testing.T, rawURL string) (int, string) {
	t.Helper()
	response, err := http.Get(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, string(body)
}

func TestStaticServerInjectsLiveClientWithoutTouchingDisk(t *testing.T) {
	server, root := newSite(t)
	status, body := get(t, server.URL())
	if status != 200 || !strings.Contains(body, "/__adomnia/live.js") || !strings.Contains(body, "<h1>Hi</h1>") {
		t.Fatalf("index not served with the live client: %d %q", status, body)
	}
	if onDisk, _ := os.ReadFile(filepath.Join(root, "index.html")); strings.Contains(string(onDisk), "__adomnia") {
		t.Fatal("the HTML file on disk was modified")
	}
	if status, body = get(t, server.URL()+"sub/"); status != 200 || !strings.Contains(body, "<p>sub</p>") {
		t.Fatalf("directory index: %d %q", status, body)
	}
	if status, _ = get(t, server.URL()+"style.css"); status != 200 {
		t.Fatalf("css: %d", status)
	}
}

func TestStaticServerConfinesAccess(t *testing.T) {
	server, root := newSite(t)
	outside := t.TempDir()
	write(t, filepath.Join(outside, "secret.txt"), "top secret")
	for _, target := range []string{".env", ".git/config", "..%2f..%2fetc/passwd", "%2e%2e/%2e%2e/secret.txt", "missing.html"} {
		if status, body := get(t, server.URL()+target); status == 200 || strings.Contains(body, "SECRET") {
			t.Errorf("%s was served: %d %q", target, status, body)
		}
	}
	link := filepath.Join(root, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if status, body := get(t, server.URL()+"escape/secret.txt"); status == 200 || strings.Contains(body, "top secret") {
		t.Fatalf("a symlink escaped the root: %d %q", status, body)
	}
}

func TestStaticServerRejectsForeignHost(t *testing.T) {
	server, _ := newSite(t)
	request, _ := http.NewRequest(http.MethodGet, server.URL(), nil)
	request.Host = "evil.example:" + strconv.Itoa(server.Port())
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("a rebound host was accepted: %d", response.StatusCode)
	}
}

func TestStaticServerSPAFallback(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "index.html"), "<body>app</body>")
	server, err := StartStatic(StaticOptions{Root: root, SPAFallback: true})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	if status, body := get(t, server.URL()+"deep/route"); status != 200 || !strings.Contains(body, "app") {
		t.Fatalf("route without extension: %d %q", status, body)
	}
	if status, _ := get(t, server.URL()+"missing.js"); status != 404 {
		t.Fatalf("a missing asset must stay 404, got %d", status)
	}
}

func TestStaticServerBroadcastsReload(t *testing.T) {
	server, _ := newSite(t)
	response, err := http.Get(server.URL() + "__adomnia/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	waitFor(t, func() bool { return server.Subscribers() == 1 })
	server.Broadcast(LiveEvent{Type: "reload", Paths: []string{"index.html"}})
	reader := bufio.NewReader(response.Body)
	lines := make(chan string, 16)
	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			lines <- line
		}
	}()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case line := <-lines:
			if strings.Contains(line, `"type":"reload"`) {
				return
			}
		case <-deadline:
			t.Fatal("no reload event received")
		}
	}
}

func TestStaticServerCloseReleasesPort(t *testing.T) {
	server, err := StartStatic(StaticOptions{Root: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	port := server.Port()
	if err := server.Close(); err != nil {
		t.Fatal(err)
	}
	if !PortAvailable(port) {
		t.Fatal("the port is still held after Close")
	}
}

func TestPreferredPortBusyFallsBack(t *testing.T) {
	first, err := StartStatic(StaticOptions{Root: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := StartStatic(StaticOptions{Root: t.TempDir(), PreferredPort: first.Port()})
	if err != nil {
		t.Fatalf("a busy preferred port must fall back: %v", err)
	}
	defer second.Close()
	if second.Port() == first.Port() {
		t.Fatal("two servers share a port")
	}
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}
