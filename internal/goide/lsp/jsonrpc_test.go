package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"
)

type recordingHandler struct {
	notifications chan string
}

func (h *recordingHandler) HandleNotification(method string, _ json.RawMessage) {
	h.notifications <- method
}

func (h *recordingHandler) HandleRequest(_ context.Context, method string, _ json.RawMessage) (any, error) {
	if method == "workspace/configuration" {
		return []any{map[string]any{}}, nil
	}
	return nil, ErrMethodNotFound
}

type fakeServer struct {
	reader *bufio.Reader
	writer io.Writer
}

func (s fakeServer) read(t *testing.T) wireMessage {
	t.Helper()
	payload, err := readFrame(s.reader)
	if err != nil {
		t.Fatalf("lettura server: %v", err)
	}
	var message wireMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		t.Fatal(err)
	}
	return message
}

func (s fakeServer) send(t *testing.T, message any) {
	t.Helper()
	data, _ := json.Marshal(message)
	if _, err := fmt.Fprintf(s.writer, "Content-Length: %d\r\n\r\n%s", len(data), data); err != nil {
		t.Fatal(err)
	}
}

func connPair(t *testing.T) (*Conn, fakeServer, *recordingHandler) {
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()
	handler := &recordingHandler{notifications: make(chan string, 8)}
	conn := NewConn(clientReader, clientWriter, handler)
	go conn.Run()
	t.Cleanup(func() { serverWriter.Close(); clientWriter.Close() })
	return conn, fakeServer{reader: bufio.NewReader(serverReader), writer: serverWriter}, handler
}

func TestConnCorrelatesResponsesOutOfOrder(t *testing.T) {
	conn, server, _ := connPair(t)
	results := make(chan string, 2)
	for _, method := range []string{"first", "second"} {
		go func(method string) {
			var value string
			if err := conn.Call(context.Background(), method, nil, &value); err != nil {
				results <- "error: " + err.Error()
				return
			}
			results <- method + "=" + value
		}(method)
	}
	requests := map[string]json.RawMessage{}
	for range 2 {
		message := server.read(t)
		requests[message.Method] = message.ID
	}
	server.send(t, map[string]any{"jsonrpc": "2.0", "id": requests["second"], "result": "B"})
	server.send(t, map[string]any{"jsonrpc": "2.0", "id": requests["first"], "result": "A"})
	got := map[string]bool{<-results: true, <-results: true}
	if !got["first=A"] || !got["second=B"] {
		t.Fatalf("risposte non correlate: %v", got)
	}
}

func TestConnCancelsAndTypesErrors(t *testing.T) {
	conn, server, _ := connPair(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- conn.Call(ctx, "slow", nil, nil) }()
	request := server.read(t)
	cancel()
	cancelMessage := server.read(t)
	if cancelMessage.Method != "$/cancelRequest" || !json.Valid(cancelMessage.Params) {
		t.Fatalf("cancellazione non inviata: %+v", cancelMessage)
	}
	if err := <-done; !IsCancelled(err) {
		t.Fatalf("errore di cancellazione inatteso: %v", err)
	}
	// Una risposta tardiva alla richiesta annullata viene ignorata senza effetti.
	server.send(t, map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": "late"})

	go func() { done <- conn.Call(context.Background(), "broken", nil, nil) }()
	broken := server.read(t)
	server.send(t, map[string]any{"jsonrpc": "2.0", "id": broken.ID, "error": map[string]any{"code": -32602, "message": "bad params"}})
	var responseErr *ResponseError
	if err := <-done; !errors.As(err, &responseErr) || responseErr.Code != -32602 {
		t.Fatalf("errore tipizzato atteso, ottenuto %v", err)
	}
}

func TestConnAnswersServerRequestsAndNotifications(t *testing.T) {
	_, server, handler := connPair(t)
	server.send(t, map[string]any{"jsonrpc": "2.0", "id": 7, "method": "workspace/configuration", "params": map[string]any{}})
	reply := server.read(t)
	if string(reply.ID) != "7" || string(reply.Result) != "[{}]" {
		t.Fatalf("risposta configurazione inattesa: %+v", reply)
	}
	server.send(t, map[string]any{"jsonrpc": "2.0", "id": 8, "method": "unknown/request"})
	if reply := server.read(t); reply.Error == nil || reply.Error.Code != codeNoMethod {
		t.Fatalf("metodo sconosciuto non rifiutato: %+v", reply)
	}
	server.send(t, map[string]any{"jsonrpc": "2.0", "method": "window/logMessage", "params": map[string]any{}})
	select {
	case method := <-handler.notifications:
		if method != "window/logMessage" {
			t.Fatalf("notifica inattesa %s", method)
		}
	case <-time.After(time.Second):
		t.Fatal("notifica non consegnata")
	}
}

func TestConnUnblocksPendingCallsOnClose(t *testing.T) {
	conn, server, _ := connPair(t)
	done := make(chan error, 1)
	go func() { done <- conn.Call(context.Background(), "never", nil, nil) }()
	server.read(t)
	server.writer.(*io.PipeWriter).Close()
	if err := <-done; !errors.Is(err, ErrClosed) {
		t.Fatalf("chiamata non sbloccata: %v", err)
	}
	<-conn.Done()
	if err := conn.Call(context.Background(), "after", nil, nil); !errors.Is(err, ErrClosed) {
		t.Fatalf("chiamata dopo la chiusura accettata: %v", err)
	}
}
