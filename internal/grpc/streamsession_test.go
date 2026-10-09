package grpc

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestInteractiveBidiStreamSendsAndReceivesOneByOne(t *testing.T) {
	mux := http.NewServeMux()
	RegisterHandlers(mux)
	server := httptest.NewServer(mux)
	defer server.Close()

	body, _ := json.Marshal(map[string]any{"address": startGrpcStreamingTestServer(t), "service": "grpc.testing.TestService", "method": "FullDuplexCall", "interactive": true})
	response, err := http.Post(server.URL+"/grpc/stream", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	events := make(chan map[string]any, 16)
	go func() {
		scanner := bufio.NewScanner(response.Body)
		for scanner.Scan() {
			var event map[string]any
			if json.Unmarshal(scanner.Bytes(), &event) == nil {
				events <- event
			}
		}
		close(events)
	}()
	next := func(kind string) map[string]any {
		t.Helper()
		for {
			select {
			case event, ok := <-events:
				if !ok {
					t.Fatalf("stream ended waiting for %s", kind)
				}
				if event["type"] == kind {
					return event
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("timeout waiting for %s", kind)
			}
		}
	}
	control := func(path string, payload map[string]any) int {
		t.Helper()
		data, _ := json.Marshal(payload)
		reply, err := http.Post(server.URL+path, "application/json", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		reply.Body.Close()
		return reply.StatusCode
	}

	id := next("session")["id"].(string)
	for _, body := range []string{"YQ==", "Yg=="} { // the server echoes each message as it arrives
		if code := control("/grpc/stream/send", map[string]any{"id": id, "message": map[string]any{"payload": map[string]any{"body": body}}}); code != http.StatusOK {
			t.Fatalf("send status %d", code)
		}
		echo := next("message")["message"].(map[string]any)
		if echo["payload"].(map[string]any)["body"] != body {
			t.Fatalf("echo = %v, want %s", echo, body)
		}
	}
	if code := control("/grpc/stream/close", map[string]any{"id": id}); code != http.StatusOK {
		t.Fatalf("close status %d", code)
	}
	if done := next("complete"); done["status"] != "OK" {
		t.Fatalf("complete = %v", done)
	}
	if code := control("/grpc/stream/send", map[string]any{"id": id}); code != http.StatusNotFound {
		t.Fatalf("send after end: status %d, want 404", code)
	}
}
