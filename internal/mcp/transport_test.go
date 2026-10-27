package mcp

import (
	"bufio"
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestMain doubles as a tiny MCP stdio server: the tests start their own binary with MCP_FAKE=1.
func TestMain(m *testing.M) {
	if os.Getenv("MCP_FAKE") == "1" {
		fakeServer()
		return
	}
	os.Exit(m.Run())
}

func fakeServer() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 1<<20), 1<<24)
	out := func(v any) { raw, _ := jsonutil.Marshal(v); fmt.Println(string(raw)) }
	for scanner.Scan() {
		var req struct {
			ID     jsonv1.RawMessage `json:"id"`
			Method string            `json:"method"`
			Params jsonv1.RawMessage `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &req) != nil || len(req.ID) == 0 {
			continue
		}
		reply := func(result any) { out(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result}) }
		switch req.Method {
		case "initialize":
			// A notification and a server ping before the answer must not confuse the client.
			out(map[string]any{"jsonrpc": "2.0", "method": "notifications/message", "params": map[string]any{"level": "info"}})
			out(map[string]any{"jsonrpc": "2.0", "id": "srv-1", "method": "ping"})
			out(map[string]any{"jsonrpc": "2.0", "id": "srv-2", "method": "sampling/createMessage"})
			fmt.Fprintln(os.Stderr, "fake server booted")
			reply(map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]any{"name": "fake", "version": "9"}, "instructions": "be nice"})
		case "tools/list":
			var p struct {
				Cursor string `json:"cursor"`
			}
			_ = json.Unmarshal(req.Params, &p)
			if p.Cursor == "" {
				reply(map[string]any{"tools": []map[string]any{{"name": "one"}}, "nextCursor": "page2"})
			} else {
				reply(map[string]any{"tools": []map[string]any{{"name": "two"}}})
			}
		case "tools/call":
			var p struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			_ = json.Unmarshal(req.Params, &p)
			switch p.Name {
			case "crash":
				fmt.Fprintln(os.Stderr, "boom: out of memory")
				os.Exit(3)
			case "image":
				reply(map[string]any{"content": []map[string]any{{"type": "text", "text": "hi"}, {"type": "image", "data": "AAAA", "mimeType": "image/png"}}, "structuredContent": map[string]any{"ok": true}})
			default:
				reply(map[string]any{"content": []map[string]any{{"type": "text", "text": fmt.Sprint(p.Arguments)}}})
			}
		case "resources/read":
			reply(map[string]any{"contents": []map[string]any{{"uri": "file:///a", "text": "body"}}})
		case "ping":
			reply(map[string]any{})
		default:
			out(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32601, "message": "nope"}})
		}
	}
}

func fakeConfig() ConnectionConfig {
	return ConnectionConfig{Transport: TransportStdio, Command: os.Args[0], Env: []string{"MCP_FAKE=1"}}
}

func TestStdio_HandshakePaginationAndContent(t *testing.T) {
	c, err := NewClient(fakeConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx := context.Background()
	info, err := c.Initialize(ctx)
	if err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if info.ServerInfo.Name != "fake" || info.Instructions != "be nice" || c.Server().ProtocolVersion != "2025-03-26" {
		t.Fatalf("handshake = %+v", info)
	}
	if !c.Supports("tools") || c.Supports("resources") {
		t.Fatal("capabilities not honoured")
	}
	tools, err := c.ListTools(ctx)
	if err != nil || len(tools) != 2 || tools[1].Name != "two" {
		t.Fatalf("pagination: %v %+v", err, tools)
	}
	result, err := c.CallTool(ctx, "image", nil)
	if err != nil || len(result.Content) != 2 || result.Content[1].MIMEType != "image/png" || result.Text() != "hi" || string(result.StructuredContent) != `{"ok":true}` {
		t.Fatalf("content: %v %+v", err, result)
	}
	read, err := c.ReadResource(ctx, "file:///a")
	if err != nil || read.Contents[0].Text != "body" {
		t.Fatalf("read: %v %+v", err, read)
	}
	if err := c.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if _, err := c.ListPrompts(ctx); err == nil || !strings.Contains(err.Error(), "-32601") {
		t.Fatalf("unsupported method should surface the JSON-RPC error: %v", err)
	}
	if c.ProcessState() != "running" {
		t.Fatalf("state = %s", c.ProcessState())
	}
}

func TestStdio_ConcurrentCallsGetTheirOwnAnswers(t *testing.T) {
	c, err := NewClient(fakeConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if _, err := c.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			result, err := c.CallTool(context.Background(), "echo", map[string]any{"n": i})
			if err != nil || !strings.Contains(result.Text(), fmt.Sprintf("n:%d", i)) {
				t.Errorf("call %d got %q (%v)", i, result.Text(), err)
			}
		}(i)
	}
	wg.Wait()
}

func TestStdio_CrashIsReportedWithStderr(t *testing.T) {
	c, err := NewClient(fakeConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if _, err := c.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, err = c.CallTool(context.Background(), "crash", nil)
	if err == nil || !strings.Contains(err.Error(), "closed stdout") || !strings.Contains(err.Error(), "out of memory") {
		t.Fatalf("crash error = %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for c.ProcessState() != "crashed" && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if c.ProcessState() != "crashed" {
		t.Fatalf("state = %s, want crashed", c.ProcessState())
	}
}

func TestStdio_ContextCancelDoesNotPoisonNextCall(t *testing.T) {
	c, err := NewClient(fakeConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if _, err := c.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.CallTool(ctx, "echo", nil); err == nil {
		t.Fatal("cancelled call should fail")
	}
	result, err := c.CallTool(context.Background(), "echo", map[string]any{"ok": 1})
	if err != nil || !strings.Contains(result.Text(), "ok:1") {
		t.Fatalf("next call = %q %v", result.Text(), err)
	}
}

func TestStdio_MissingCommand(t *testing.T) {
	if _, err := NewClient(ConnectionConfig{Transport: TransportStdio, Command: "definitely-not-a-real-binary-xyz"}); err == nil {
		t.Fatal("expected start error")
	}
}

func TestHTTP_SessionHeaderAndDelete(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.Method+" "+r.Header.Get("Mcp-Session-Id")+" "+r.Header.Get("MCP-Protocol-Version")+" "+r.Header.Get("Authorization"))
		mu.Unlock()
		if r.Method == http.MethodDelete {
			return
		}
		var req JSONRPCRequest
		_ = json.UnmarshalRead(r.Body, &req)
		if req.ID == nil {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Mcp-Session-Id", "abc")
		result, _ := jsonutil.Marshal(map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "serverInfo": map[string]any{"name": "h"}})
		_ = jsonutil.MarshalWrite(w, JSONRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
	}))
	defer srv.Close()
	c, err := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL, BearerToken: "tok"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = c.Close()
	mu.Lock()
	defer mu.Unlock()
	joined := strings.Join(seen, "|")
	// initialize carries no session yet; the initialized notification and DELETE repeat it plus the version.
	for _, want := range []string{"POST   Bearer tok", "POST abc 2025-03-26 Bearer tok", "DELETE abc 2025-03-26 Bearer tok"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %s", want, joined)
		}
	}
}

func TestHTTP_EventStreamResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.UnmarshalRead(r.Body, &req)
		w.Header().Set("content-type", "text/event-stream")
		id, _ := jsonutil.Marshal(req.ID)
		fmt.Fprint(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n")
		fmt.Fprint(w, "data: {\"jsonrpc\":\"2.0\",\"id\":"+string(id)+",\"result\":{\"tools\":[{\"name\":\"streamed\"}]}}\n\n")
	}))
	defer srv.Close()
	c, _ := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL})
	tools, err := c.ListTools(context.Background())
	if err != nil || len(tools) != 1 || tools[0].Name != "streamed" {
		t.Fatalf("sse: %v %+v", err, tools)
	}
}

func TestHTTP_EventStreamWithoutAnswer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "text/event-stream")
		fmt.Fprint(w, "data: {\"jsonrpc\":\"2.0\",\"method\":\"x\"}\n\n")
	}))
	defer srv.Close()
	c, _ := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL})
	if _, err := c.ListTools(context.Background()); err == nil || !strings.Contains(err.Error(), "without a response") {
		t.Fatalf("err = %v", err)
	}
}

func TestHTTP_StatusErrors(t *testing.T) {
	status := http.StatusUnauthorized
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		fmt.Fprint(w, "denied")
	}))
	defer srv.Close()
	c, _ := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL})
	if _, err := c.ListTools(context.Background()); err == nil || !strings.Contains(err.Error(), "bearer token") {
		t.Fatalf("401 = %v", err)
	}
	status = http.StatusInternalServerError
	if _, err := c.ListTools(context.Background()); err == nil || !strings.Contains(err.Error(), "http 500") {
		t.Fatalf("500 = %v", err)
	}
	if err := httpStatusError(http.StatusNotFound, "", true); !strings.Contains(err.Error(), "reconnect") {
		t.Fatalf("404 with session = %v", err)
	}
}

func TestHTTP_BadJSONAndUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "not json") }))
	c, _ := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL})
	if _, err := c.ListTools(context.Background()); err == nil || !strings.Contains(err.Error(), "http decode") {
		t.Fatalf("bad json = %v", err)
	}
	srv.Close()
	if _, err := c.ListTools(context.Background()); err == nil || !strings.Contains(err.Error(), "http send") {
		t.Fatalf("unreachable = %v", err)
	}
}

func TestClient_PagesAreCapped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.UnmarshalRead(r.Body, &req)
		result, _ := jsonutil.Marshal(map[string]any{"tools": []any{}, "nextCursor": "again"})
		_ = jsonutil.MarshalWrite(w, JSONRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
	}))
	defer srv.Close()
	c, _ := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL})
	if _, err := c.ListTools(context.Background()); err == nil || !strings.Contains(err.Error(), "pages") {
		t.Fatalf("endless cursor = %v", err)
	}
}

func TestClient_PromptArgumentsAreStrings(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.UnmarshalRead(r.Body, &req)
		got = req.Params.(map[string]any)
		result, _ := jsonutil.Marshal(map[string]any{"description": "d", "messages": []any{map[string]any{"role": "user", "content": map[string]any{"type": "text", "text": "go"}}}})
		_ = jsonutil.MarshalWrite(w, JSONRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
	}))
	defer srv.Close()
	c, _ := NewClient(ConnectionConfig{Transport: TransportHTTP, BaseURL: srv.URL})
	prompt, err := c.GetPrompt(context.Background(), "p", map[string]any{"n": 3, "s": "x"})
	if err != nil || prompt.Messages[0].Content.Text != "go" {
		t.Fatalf("prompt: %v %+v", err, prompt)
	}
	args := got["arguments"].(map[string]any)
	if args["n"] != "3" || args["s"] != "x" {
		t.Fatalf("arguments = %v", args)
	}
}
