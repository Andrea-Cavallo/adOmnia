package lsp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestCallLatestSupersedesAndIgnoresLateReply(t *testing.T) {
	conn, server, _ := connPair(t)
	first := make(chan error, 1)
	go func() {
		first <- conn.CallLatest(context.Background(), "file:///a", "textDocument/completion", nil, nil)
	}()
	old := server.read(t)
	second := make(chan error, 1)
	go func() {
		second <- conn.CallLatest(context.Background(), "file:///a", "textDocument/completion", nil, nil)
	}()
	var newest json.RawMessage
	for range 2 {
		message := server.read(t)
		if message.Method == "$/cancelRequest" {
			var params struct {
				ID json.RawMessage `json:"id"`
			}
			_ = json.Unmarshal(message.Params, &params)
			if string(params.ID) != string(old.ID) {
				t.Fatal("wrong request canceled")
			}
		} else {
			newest = message.ID
		}
	}
	if !errors.Is(<-first, context.Canceled) {
		t.Fatal("old request survived")
	}
	server.send(t, map[string]any{"jsonrpc": "2.0", "id": old.ID, "result": "late"})
	server.send(t, map[string]any{"jsonrpc": "2.0", "id": newest, "result": nil})
	if err := <-second; err != nil {
		t.Fatal(err)
	}
	if conn.PendingRequests() != 0 {
		t.Fatal("pending request leak")
	}
}

func TestCancelDocumentPreservesOtherDocumentsAndExplicitOperations(t *testing.T) {
	conn, server, _ := connPair(t)
	results := make(chan error, 3)
	go func() { results <- conn.CallLatest(context.Background(), "a", "textDocument/hover", nil, nil) }()
	server.read(t)
	go func() { results <- conn.CallLatest(context.Background(), "b", "textDocument/hover", nil, nil) }()
	other := server.read(t)
	go func() { results <- conn.Call(context.Background(), "textDocument/rename", nil, nil) }()
	rename := server.read(t)
	conn.CancelDocument("a")
	if message := server.read(t); message.Method != "$/cancelRequest" {
		t.Fatal("no wire cancellation")
	}
	if !errors.Is(<-results, context.Canceled) {
		t.Fatal("document request survived")
	}
	for _, id := range []json.RawMessage{other.ID, rename.ID} {
		server.send(t, map[string]any{"jsonrpc": "2.0", "id": id, "result": nil})
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
}
