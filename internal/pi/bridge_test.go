package pi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
)

func TestPiRPCProcess(t *testing.T) {
	if os.Getenv("ADOMNIA_PI_TEST_HELPER") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	enc := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var request map[string]any
		_ = json.Unmarshal(scanner.Bytes(), &request)
		kind, _ := request["type"].(string)
		data := any(map[string]any{})
		switch kind {
		case "get_state":
			data = map[string]any{"model": map[string]any{"provider": "test", "id": "model", "name": "Test", "input": []string{"text"}}, "thinkingLevel": "off"}
		case "get_available_models":
			data = map[string]any{"models": []any{map[string]any{"provider": "test", "id": "model", "name": "Test"}}}
		case "get_available_thinking_levels":
			data = map[string]any{"levels": []string{"off", "high"}}
		}
		_ = enc.Encode(map[string]any{"type": "response", "id": request["id"], "success": true, "data": data})
		if kind == "abort" {
			_ = enc.Encode(map[string]any{"type": "agent_settled", "aborted": true})
		}
		if kind == "prompt" && request["message"] != "wait" {
			_ = enc.Encode(map[string]any{"type": "message_update", "assistantMessageEvent": map[string]string{"type": "text_delta", "delta": "Hello"}})
			_ = enc.Encode(map[string]string{"type": "agent_end"})
			time.Sleep(80 * time.Millisecond)
			_ = enc.Encode(map[string]string{"type": "agent_settled"})
		}
	}
	os.Exit(0)
}

func TestBridgeSessionLifecycle(t *testing.T) {
	t.Setenv("ADOMNIA_PI_TEST_HELPER", "1")
	root := t.TempDir()
	b := &bridge{command: []string{os.Args[0], "-test.run=^TestPiRPCProcess$", "--"}, sessions: map[string]*piSession{}}
	var streamed bytes.Buffer
	b.conn = milk.NewConn(nil, &streamed, b)
	defer b.close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	raw, _ := json.Marshal(map[string]any{"cwd": root})
	result, err := b.HandleRequest(ctx, "session/new", raw)
	if err != nil {
		t.Fatal(err)
	}
	session := result.(map[string]any)["sessionId"].(string)
	controls := result.(map[string]any)["configOptions"].([]milk.SessionControl)
	if len(controls) != 2 || controls[0].CurrentValue != "test/model" {
		t.Fatalf("controls: %+v", controls)
	}
	raw, _ = json.Marshal(map[string]any{"sessionId": session, "prompt": []any{map[string]string{"type": "image", "data": "AA==", "mimeType": "image/png"}}})
	if _, err := b.HandleRequest(ctx, "session/prompt", raw); err == nil {
		t.Fatal("text-only model accepted an image")
	}
	raw, _ = json.Marshal(map[string]any{"sessionId": session, "prompt": []any{map[string]string{"type": "text", "text": "hi"}}})
	started := time.Now()
	if _, err := b.HandleRequest(ctx, "session/prompt", raw); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(streamed.Bytes(), []byte("Hello")) {
		t.Fatal("assistant text did not reach the shared host")
	}
	if time.Since(started) < 75*time.Millisecond {
		t.Fatal("turn ended on agent_end instead of agent_settled")
	}
	raw, _ = json.Marshal(map[string]any{"sessionId": session, "prompt": []any{map[string]string{"type": "text", "text": "wait"}}})
	finished := make(chan error, 1)
	go func() { _, err := b.HandleRequest(ctx, "session/prompt", raw); finished <- err }()
	time.Sleep(50 * time.Millisecond)
	cancelRaw, _ := json.Marshal(map[string]string{"sessionId": session})
	b.HandleNotification("session/cancel", cancelRaw)
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("cancellation did not settle")
	}
	raw, _ = json.Marshal(map[string]string{"sessionId": session})
	if _, err := b.HandleRequest(ctx, "session/close", raw); err != nil {
		t.Fatal(err)
	}
	if len(b.sessions) != 0 {
		t.Fatal("session leaked")
	}
}

func TestAllowedPath(t *testing.T) {
	root := t.TempDir()
	root, _ = filepath.EvalSymlinks(root)
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"main.go", "new.go"} {
		if !allowedPath(root, path) {
			t.Errorf("rejected project file %s", path)
		}
	}
	for _, path := range []string{"../outside", filepath.Join(t.TempDir(), "secret"), ".env"} {
		if allowedPath(root, path) {
			t.Errorf("accepted excluded file %s", path)
		}
	}
}

func TestInstalledPiHandshake(t *testing.T) {
	script := os.Getenv("ADOMNIA_PI_SMOKE_SCRIPT")
	if script == "" {
		t.Skip("set ADOMNIA_PI_SMOKE_SCRIPT to test an installed Pi")
	}
	command, err := ResolveCommand(script, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	b := &bridge{command: command, sessions: map[string]*piSession{}}
	b.conn = milk.NewConn(nil, io.Discard, b)
	defer b.close()
	// Exercise the same embedded extension as the desktop bridge.
	extension := filepath.Join(t.TempDir(), "permissions.ts")
	if err := os.WriteFile(extension, permissionExtension, 0600); err != nil {
		t.Fatal(err)
	}
	b.extension = extension
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	s, err := b.newSession(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.state(ctx)
	if err != nil {
		t.Fatal(err)
	}
	controls, err := s.controls(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Pi RPC connected; selected provider=%s; controls=%d", state.Model.Provider, len(controls))
}

type permissionHost struct {
	mu    sync.Mutex
	calls int
	allow bool
}

func (h *permissionHost) HandleNotification(string, json.RawMessage) {}
func (h *permissionHost) HandleRequest(_ context.Context, method string, _ json.RawMessage) (any, error) {
	if method != "session/request_permission" {
		return nil, milk.ErrMethodNotFound
	}
	h.mu.Lock()
	h.calls++
	h.mu.Unlock()
	option := "deny"
	if h.allow {
		option = "allow"
	}
	return map[string]any{"outcome": map[string]string{"outcome": "selected", "optionId": option}}, nil
}

type bufferCloser struct{ bytes.Buffer }

func (*bufferCloser) Close() error { return nil }
func TestPermissionBridge(t *testing.T) {
	for _, allow := range []bool{false, true} {
		t.Run(fmt.Sprint(allow), func(t *testing.T) {
			root := t.TempDir()
			root, _ = filepath.EvalSymlinks(root)
			br, bw := io.Pipe()
			hr, hw := io.Pipe()
			defer br.Close()
			defer bw.Close()
			defer hr.Close()
			defer hw.Close()
			host := &permissionHost{allow: allow}
			hostConn := milk.NewConn(hr, bw, host)
			b := &bridge{}
			b.conn = milk.NewConn(br, hw, b)
			go hostConn.Run()
			go b.conn.Run()
			output := &bufferCloser{}
			s := &piSession{id: "test", root: root, owner: b, stdin: output}
			for _, path := range []string{"main.go", "../secret"} {
				output.Reset()
				tool, _ := json.Marshal(map[string]any{"tool": "read", "input": map[string]string{"path": path}})
				request, _ := json.Marshal(map[string]string{"id": "ui-1", "method": "confirm", "title": "adOmnia tool permission", "message": string(tool)})
				s.ui(request)
				var response struct {
					Confirmed bool `json:"confirmed"`
				}
				if err := json.Unmarshal(output.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if response.Confirmed != (allow && path == "main.go") {
					t.Fatalf("wrong permission for %s: %s", path, output.String())
				}
			}
			host.mu.Lock()
			defer host.mu.Unlock()
			if host.calls != 1 {
				t.Fatalf("unsafe path reached user permission: %d", host.calls)
			}
		})
	}
}
