package ai

import (
	"context"
	"encoding/json/v2"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLocalEndpointRejectsRemoteAndCredentials(t *testing.T) {
	for _, address := range []string{"https://example.com/v1", "http://127.0.0.1.example.com/v1", "file:///tmp/model", "http://user:secret@localhost:1234/v1", "http://localhost:1234/v1?target=remote", "http://192.168.1.2:1234/v1"} {
		if _, err := localEndpoint(address); err == nil {
			t.Errorf("accepted %s", address)
		}
	}
	for _, address := range []string{"http://localhost:1234/v1", "http://127.0.0.1:11434/v1/", "http://[::1]:1234/v1"} {
		if _, err := localEndpoint(address); err != nil {
			t.Errorf("rejected %s: %v", address, err)
		}
	}
}

func localChatBody(endpoint string, models bool) string {
	body, _ := json.Marshal(map[string]any{"endpoint": endpoint, "apiKey": "local-key", "models": models, "payload": map[string]any{"model": "test-local", "stream": true, "messages": []map[string]string{{"role": "user", "content": "hello"}}}})
	return string(body)
}

func TestLocalChatStreamsAndDiscoversModels(t *testing.T) {
	for _, models := range []bool{false, true} {
		t.Run(map[bool]string{false: "stream", true: "models"}[models], func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer local-key" {
					t.Error("missing server credential")
				}
				if models {
					if r.Method != "GET" || r.URL.Path != "/v1/models" {
						t.Errorf("models request %s %s", r.Method, r.URL.Path)
					}
					_, _ = io.WriteString(w, `{"data":[{"id":"test-local"}]}`)
					return
				}
				if r.Method != "POST" || r.URL.Path != "/v1/chat/completions" {
					t.Errorf("chat request %s %s", r.Method, r.URL.Path)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n")
			}))
			defer upstream.Close()
			response := httptest.NewRecorder()
			LocalChatHandler(response, httptest.NewRequest("POST", "/ai/local/chat", strings.NewReader(localChatBody(upstream.URL+"/v1", models))))
			if response.Code != 200 {
				t.Fatalf("status %d: %s", response.Code, response.Body.String())
			}
			want := "[DONE]"
			if models {
				want = "test-local"
			}
			if !strings.Contains(response.Body.String(), want) {
				t.Fatalf("missing %s in response", want)
			}
		})
	}
}

func TestLocalChatDoesNotFollowRedirects(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.com/", http.StatusTemporaryRedirect)
	}))
	defer upstream.Close()
	response := httptest.NewRecorder()
	LocalChatHandler(response, httptest.NewRequest("POST", "/ai/local/chat", strings.NewReader(localChatBody(upstream.URL, false))))
	if response.Code != http.StatusBadGateway {
		t.Fatalf("status %d", response.Code)
	}
}

func TestLocalChatCancellationStopsUpstream(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(started)
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
			t.Error("upstream did not observe cancellation")
		}
		close(stopped)
	}))
	defer upstream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		LocalChatHandler(httptest.NewRecorder(), httptest.NewRequest("POST", "/ai/local/chat", strings.NewReader(localChatBody(upstream.URL, false))).WithContext(ctx))
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream was not called")
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream was not cancelled")
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("handler did not stop")
	}
}
