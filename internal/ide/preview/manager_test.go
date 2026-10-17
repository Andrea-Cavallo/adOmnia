package preview

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/run"
)

const fakeDevServer = `
const http = require('http')
const server = http.createServer((req, res) => {
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; default-src 'self'")
  res.setHeader('Content-Type', 'text/html')
  res.end('<html><body>dev ok</body></html>')
})
server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log('  ➜  Local:   http://localhost:' + port + '/')
})
`

func nodeCommand(t *testing.T, dir string, args ...string) run.CommandSpec {
	t.Helper()
	npm, err := exec.LookPath("npm")
	if err != nil {
		t.Skip("npm is not installed")
	}
	write(t, filepath.Join(dir, "server.js"), fakeDevServer)
	write(t, filepath.Join(dir, "package.json"), `{"name":"fake","scripts":{"dev":"node server.js"}}`)
	arguments := append([]string{"run", "dev"}, args...)
	return run.CommandSpec{
		SessionID: "s1", Kind: "devserver", Executable: npm, Arguments: arguments, WorkingDirectory: dir, DisplayCommand: "npm run dev",
	}
}

func waitState(t *testing.T, manager *Manager, id string, want State) Preview {
	t.Helper()
	var last Preview
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if preview, ok := manager.Get("s1", id); ok {
			last = preview
			if preview.State == want {
				return preview
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("preview never reached %s, last: %+v", want, last)
	return last
}

func TestDevServerLifecycleKillsTheWholeProcessTree(t *testing.T) {
	processes := run.NewProcessManager()
	defer processes.Shutdown()
	manager := NewManager(processes, nil)
	spec := nodeCommand(t, t.TempDir())
	port, err := FreePort(0)
	if err != nil {
		t.Fatal(err)
	}
	spec.Environment = append(os.Environ(), "PORT="+strconv.Itoa(port))

	started, err := manager.StartDevServer(DevServerRequest{ID: "web", SessionID: "s1", Spec: spec})
	if err != nil || started.State != StateStarting {
		t.Fatalf("start: %+v %v", started, err)
	}
	ready := waitState(t, manager, "web", StateReady)
	if ready.Port != port || ready.RunID == "" {
		t.Fatalf("unexpected ready preview: %+v", ready)
	}
	if !ready.Bridged || ready.DirectURL == ready.URL {
		t.Fatalf("the page must go through the bridge proxy: %+v", ready)
	}
	response, err := http.Get(ready.URL)
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if !strings.Contains(string(page), "dev ok") || !strings.Contains(string(page), "/__adomnia/live.js") {
		t.Fatalf("the proxied page lacks the bridge: %q", page)
	}
	if response.Header.Get("X-Frame-Options") != "" || strings.Contains(response.Header.Get("Content-Security-Policy"), "frame-ancestors") {
		t.Fatalf("framing must be allowed for the preview: %v", response.Header)
	}
	if duplicate, _ := manager.StartDevServer(DevServerRequest{ID: "web", SessionID: "s1", Spec: spec}); duplicate.RunID != ready.RunID {
		t.Fatal("a second start must reuse the running dev server")
	}

	if err := manager.Stop("s1", "web"); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, "web", StateStopped)
	waitFor(t, func() bool { return PortAvailable(ready.Port) && PortAvailable(portOf(ready.URL)) })
	waitFor(t, func() bool {
		connection, dialErr := net.DialTimeout("tcp", net.JoinHostPort(LoopbackHost, strconv.Itoa(port)), 200*time.Millisecond)
		if dialErr == nil {
			connection.Close()
			return false
		}
		return true
	})
}

func TestDevServerFailureIsExplained(t *testing.T) {
	processes := run.NewProcessManager()
	defer processes.Shutdown()
	manager := NewManager(processes, nil)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	spec := run.CommandSpec{SessionID: "s1", Kind: "devserver", Executable: node, Arguments: []string{"-e", "console.error('Error: listen EADDRINUSE: address already in use :::3000'); process.exit(1)"}, WorkingDirectory: t.TempDir(), DisplayCommand: "node"}
	if _, err := manager.StartDevServer(DevServerRequest{ID: "web", SessionID: "s1", Spec: spec}); err != nil {
		t.Fatal(err)
	}
	failed := waitState(t, manager, "web", StateFailed)
	if failed.FailureKind != FailurePortInUse || failed.Error == "" {
		t.Fatalf("expected a port conflict explanation, got %+v", failed)
	}
}

func TestStopSessionReleasesEverything(t *testing.T) {
	manager := NewManager(nil, nil)
	for _, id := range []string{"a", "b"} {
		if _, err := manager.StartStatic(StaticRequest{ID: id, SessionID: "s1", Options: StaticOptions{Root: t.TempDir()}}); err != nil {
			t.Fatal(err)
		}
	}
	other, err := manager.StartStatic(StaticRequest{ID: "c", SessionID: "s2", Options: StaticOptions{Root: t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Shutdown()
	manager.StopSession("s1")
	for _, preview := range manager.List("s1") {
		if preview.State != StateStopped {
			t.Fatalf("preview %s still %s", preview.ID, preview.State)
		}
	}
	if current, _ := manager.Get("s2", "c"); current.State != StateReady || fmt.Sprint(current.Port) != fmt.Sprint(other.Port) {
		t.Fatal("stopping one session must not touch another")
	}
}

func TestStoppingFromTheRunConsoleIsNotAnError(t *testing.T) {
	processes := run.NewProcessManager()
	defer processes.Shutdown()
	manager := NewManager(processes, nil)
	spec := nodeCommand(t, t.TempDir())
	port, err := FreePort(0)
	if err != nil {
		t.Fatal(err)
	}
	spec.Environment = append(os.Environ(), "PORT="+strconv.Itoa(port))
	if _, err := manager.StartDevServer(DevServerRequest{ID: "web", SessionID: "s1", Spec: spec}); err != nil {
		t.Fatal(err)
	}
	ready := waitState(t, manager, "web", StateReady)
	if err := processes.Stop(run.RunID(ready.RunID)); err != nil {
		t.Fatal(err)
	}
	stopped := waitState(t, manager, "web", StateStopped)
	if stopped.Error != "" || stopped.FailureKind != "" {
		t.Fatalf("a deliberate stop must not look like a crash: %+v", stopped)
	}
}
