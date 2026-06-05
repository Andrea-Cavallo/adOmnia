package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

type stdioTransport struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Scanner
	mu     sync.Mutex
}

func newStdioTransport(cfg ConnectionConfig) (*stdioTransport, error) {
	if cfg.Command == "" {
		return nil, fmt.Errorf("stdio transport requires a command")
	}
	cmd := exec.Command(cfg.Command, cfg.Args...)
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
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start MCP process: %w", err)
	}
	return &stdioTransport{
		cmd:    cmd,
		stdin:  stdin,
		stdout: bufio.NewScanner(stdout),
	}, nil
}

func (t *stdioTransport) Send(_ context.Context, req JSONRPCRequest) (JSONRPCResponse, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	raw, err := json.Marshal(req)
	if err != nil {
		return JSONRPCResponse{}, err
	}
	if _, err := fmt.Fprintf(t.stdin, "%s\n", raw); err != nil {
		return JSONRPCResponse{}, fmt.Errorf("write stdin: %w", err)
	}

	if req.ID == nil {
		return JSONRPCResponse{}, nil
	}

	if !t.stdout.Scan() {
		if err := t.stdout.Err(); err != nil {
			return JSONRPCResponse{}, fmt.Errorf("read stdout: %w", err)
		}
		return JSONRPCResponse{}, fmt.Errorf("MCP server closed stdout")
	}
	line := strings.TrimSpace(t.stdout.Text())
	var resp JSONRPCResponse
	if err := json.Unmarshal([]byte(line), &resp); err != nil {
		return JSONRPCResponse{}, fmt.Errorf("decode response: %w (raw: %s)", err, line)
	}
	return resp, nil
}

func (t *stdioTransport) ProcessState() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cmd == nil || t.cmd.Process == nil {
		return "unknown"
	}
	if t.cmd.ProcessState != nil {
		return "stopped"
	}
	return "running"
}

func (t *stdioTransport) Close() error {
	_ = t.stdin.Close()
	_ = t.cmd.Process.Kill()
	return t.cmd.Wait()
}
