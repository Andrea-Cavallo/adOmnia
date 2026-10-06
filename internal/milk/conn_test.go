package milk

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"sync"
	"testing"
	"time"
)

// recordingHandler cattura notifiche e risponde alle richieste con un risultato fisso.
type recordingHandler struct {
	mu            sync.Mutex
	notifications []string
	requestResult any
	requestErr    error
}

func (h *recordingHandler) HandleNotification(method string, _ json.RawMessage) {
	h.mu.Lock()
	h.notifications = append(h.notifications, method)
	h.mu.Unlock()
}

func (h *recordingHandler) HandleRequest(_ context.Context, method string, _ json.RawMessage) (any, error) {
	if h.requestErr != nil {
		return nil, h.requestErr
	}
	return h.requestResult, nil
}

func (h *recordingHandler) received() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.notifications...)
}

func writeLine(t *testing.T, w io.Writer, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := w.Write(append(data, '\n')); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// connPair collega un Conn a due pipe: agentToClient (milk → client) e
// clientToAgent (client → milk). clientOutput legge ciò che il client scrive
// verso milk.
type connPair struct {
	conn          *Conn
	agentToClient io.Writer
	clientOutput  *bufio.Scanner
}

func newConnPair(t *testing.T, handler Handler) *connPair {
	t.Helper()
	agentToClientR, agentToClientW := io.Pipe()
	clientToAgentR, clientToAgentW := io.Pipe()
	conn := NewConn(agentToClientR, clientToAgentW, handler)
	go conn.Run()
	t.Cleanup(func() {
		_ = agentToClientR.Close()
		_ = agentToClientW.Close()
		_ = clientToAgentR.Close()
		_ = clientToAgentW.Close()
	})
	return &connPair{
		conn:          conn,
		agentToClient: agentToClientW,
		clientOutput:  bufio.NewScanner(clientToAgentR),
	}
}

// readClientLine legge la prossima riga JSON-RPC scritta dal client verso milk.
func (p *connPair) readClientLine(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	if !p.clientOutput.Scan() {
		t.Fatalf("client wrote no output")
	}
	var message map[string]json.RawMessage
	if err := json.Unmarshal(p.clientOutput.Bytes(), &message); err != nil {
		t.Fatalf("client output is not JSON: %v", err)
	}
	return message
}

func TestCallRoundTrip(t *testing.T) {
	pair := newConnPair(t, &recordingHandler{requestResult: map[string]any{}})
	go func() {
		// Agent finto: risponde a session/new con un sessionId, echoando l'id raw.
		for pair.clientOutput.Scan() {
			var message wireMessage
			if json.Unmarshal(pair.clientOutput.Bytes(), &message) != nil || message.Method == "" {
				continue
			}
			response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(message.ID)}
			if message.Method == "session/new" {
				response["result"] = map[string]any{"sessionId": "sess-1"}
			} else {
				response["result"] = map[string]any{}
			}
			writeLine(t, pair.agentToClient, response)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var result struct {
		SessionID string `json:"sessionId"`
	}
	if err := pair.conn.Call(ctx, "session/new", map[string]any{"cwd": "/tmp"}, &result); err != nil {
		t.Fatalf("Call: %v", err)
	}
	if result.SessionID != "sess-1" {
		t.Fatalf("sessionId = %q, want %q", result.SessionID, "sess-1")
	}
}

func TestNotificationDispatch(t *testing.T) {
	handler := &recordingHandler{requestResult: map[string]any{}}
	pair := newConnPair(t, handler)

	writeLine(t, pair.agentToClient, map[string]any{
		"jsonrpc": "2.0", "method": "session/update",
		"params": map[string]any{"sessionId": "s1", "update": map[string]any{"sessionUpdate": "state_update", "state": "running"}},
	})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(handler.received()) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	received := handler.received()
	if len(received) != 1 || received[0] != "session/update" {
		t.Fatalf("received = %v, want [session/update]", received)
	}
}

func TestAgentRequestEchoesStringID(t *testing.T) {
	handler := &recordingHandler{requestResult: map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow"}}}
	pair := newConnPair(t, handler)

	writeLine(t, pair.agentToClient, map[string]any{
		"jsonrpc": "2.0", "id": "42", "method": "session/request_permission", "params": map[string]any{},
	})

	response := pair.readClientLine(t)
	if string(response["id"]) != `"42"` {
		t.Fatalf("response id = %s, want raw \"42\" (string id echoed byte-for-byte)", response["id"])
	}
	var result map[string]any
	if err := json.Unmarshal(response["result"], &result); err != nil {
		t.Fatalf("response result is not JSON: %v", err)
	}
	if _, ok := response["error"]; ok {
		t.Fatalf("unexpected error in response: %s", response["error"])
	}
}

func TestAgentRequestMethodNotFound(t *testing.T) {
	handler := &recordingHandler{requestErr: ErrMethodNotFound}
	pair := newConnPair(t, handler)

	writeLine(t, pair.agentToClient, map[string]any{
		"jsonrpc": "2.0", "id": "7", "method": "session/list", "params": map[string]any{},
	})

	response := pair.readClientLine(t)
	var err struct {
		Code int `json:"code"`
	}
	if e := json.Unmarshal(response["error"], &err); e != nil {
		t.Fatalf("response error is not JSON: %v", e)
	}
	if err.Code != -32601 {
		t.Fatalf("error code = %d, want -32601", err.Code)
	}
}
