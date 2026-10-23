package mcp

import (
	"bufio"
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"adomnia/internal/jsonutil"
	"adomnia/internal/procutil"
)

const (
	maxMessageBytes = 16 * 1024 * 1024
	stderrTailBytes = 4096
	closeGrace      = 1500 * time.Millisecond
)

// stdioTransport talks newline-delimited JSON-RPC to a child process. One reader goroutine
// routes responses to the waiting Send by id, so notifications and server requests that arrive
// in between never get mistaken for the answer, and a cancelled call cannot leave a stale line
// for the next one.
type stdioTransport struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stderr *tailBuffer

	writeMu sync.Mutex

	mu      sync.Mutex
	pending map[string]chan JSONRPCResponse

	done    chan struct{} // closed when stdout ends
	exited  chan struct{} // closed once the process has been reaped
	waitErr error
}

func newStdioTransport(cfg ConnectionConfig) (*stdioTransport, error) {
	if cfg.Command == "" {
		return nil, fmt.Errorf("stdio transport requires a command")
	}
	cmd := procutil.Command(cfg.Command, cfg.Args...)
	if len(cfg.Env) > 0 {
		cmd.Env = append(cmd.Environ(), cfg.Env...)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr := &tailBuffer{limit: stderrTailBytes}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start MCP process: %w", err)
	}
	t := &stdioTransport{
		cmd: cmd, stdin: stdin, stderr: stderr,
		pending: map[string]chan JSONRPCResponse{},
		done:    make(chan struct{}), exited: make(chan struct{}),
	}
	go t.readLoop(stdout)
	return t, nil
}

// incoming is any message the server can send: a response, a request or a notification.
type incoming struct {
	ID     jsonv1.RawMessage `json:"id"`
	Method string            `json:"method"`
	Result jsonv1.RawMessage `json:"result"`
	Error  *JSONRPCError     `json:"error"`
}

func (t *stdioTransport) readLoop(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), maxMessageBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var msg incoming
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue // not JSON-RPC (a stray log line): ignore it, stderr is the log channel
		}
		t.route(msg)
	}
	close(t.done)
	t.waitErr = t.cmd.Wait()
	close(t.exited)
}

func (t *stdioTransport) route(msg incoming) {
	switch {
	case msg.Method != "" && len(msg.ID) > 0:
		t.answerServerRequest(msg)
	case msg.Method != "":
		// Notification (progress, log, list_changed): nothing waits for it.
	case len(msg.ID) > 0:
		t.mu.Lock()
		ch := t.pending[idKey(msg.ID)]
		t.mu.Unlock()
		if ch != nil {
			var id any
			_ = json.Unmarshal(msg.ID, &id)
			ch <- JSONRPCResponse{JSONRPC: "2.0", ID: id, Result: msg.Result, Error: msg.Error}
		}
	}
}

// answerServerRequest keeps a server that pings or asks for something unsupported from hanging.
func (t *stdioTransport) answerServerRequest(msg incoming) {
	reply := map[string]any{"jsonrpc": "2.0", "id": msg.ID}
	if msg.Method == "ping" {
		reply["result"] = map[string]any{}
	} else {
		reply["error"] = map[string]any{"code": -32601, "message": "client does not support " + msg.Method}
	}
	_ = t.write(reply)
}

func idKey(raw jsonv1.RawMessage) string {
	return strings.Trim(strings.TrimSpace(string(raw)), `"`)
}

func (t *stdioTransport) write(message any) error {
	raw, err := jsonutil.Marshal(message)
	if err != nil {
		return err
	}
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	if _, err := fmt.Fprintf(t.stdin, "%s\n", raw); err != nil {
		return fmt.Errorf("write stdin: %w", err)
	}
	return nil
}

func (t *stdioTransport) Send(ctx context.Context, req JSONRPCRequest) (JSONRPCResponse, error) {
	if req.ID == nil {
		return JSONRPCResponse{}, t.write(req)
	}
	key := fmt.Sprint(req.ID)
	ch := make(chan JSONRPCResponse, 1)
	t.mu.Lock()
	t.pending[key] = ch
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.pending, key)
		t.mu.Unlock()
	}()

	if err := t.write(req); err != nil {
		return JSONRPCResponse{}, t.withStderr(err)
	}
	select {
	case resp := <-ch:
		return resp, nil
	case <-ctx.Done():
		return JSONRPCResponse{}, ctx.Err()
	case <-t.done:
		// The answer may have been routed just before stdout closed.
		select {
		case resp := <-ch:
			return resp, nil
		default:
		}
		// Wait (in readLoop) is what finishes copying the server stderr: without it the error can be built
		// before the last stderr bytes arrive and lose the reason the server gave for dying.
		select {
		case <-t.exited:
		case <-time.After(2 * time.Second):
		}
		return JSONRPCResponse{}, t.withStderr(fmt.Errorf("MCP server closed stdout"))
	}
}

func (t *stdioTransport) withStderr(err error) error {
	if tail := strings.TrimSpace(t.stderr.String()); tail != "" {
		return fmt.Errorf("%w (server stderr: %s)", err, tail)
	}
	return err
}

// ProcessState is running, stopped (clean exit) or crashed (non-zero exit or signal).
func (t *stdioTransport) ProcessState() string {
	select {
	case <-t.exited:
		if t.waitErr != nil {
			return "crashed"
		}
		return "stopped"
	default:
		return "running"
	}
}

func (t *stdioTransport) Close() error {
	_ = t.stdin.Close()
	select {
	case <-t.exited:
	case <-time.After(closeGrace): // a well-behaved server leaves when its stdin closes
		if t.cmd.Process != nil {
			_ = t.cmd.Process.Kill()
		}
		// A grandchild that keeps stdout open must not freeze the UI on Close.
		select {
		case <-t.exited:
		case <-time.After(2 * time.Second):
		}
	}
	return nil
}

// tailBuffer keeps the last bytes written: enough to explain why a server died.
type tailBuffer struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data = append(b.data, p...)
	if extra := len(b.data) - b.limit; extra > 0 {
		b.data = b.data[extra:]
	}
	return len(p), nil
}

func (b *tailBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.data)
}
