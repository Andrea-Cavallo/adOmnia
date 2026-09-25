package aigateway

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGatewayProxiesChatCompletionsAndReplacesAuthorization(t *testing.T) {
	var receivedPath, receivedAuth, receivedBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		receivedAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		receivedBody = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`)
	}))
	defer upstream.Close()

	gateway := New()
	status, err := gateway.Start(Config{
		Port: 0, Token: "local-secret", Provider: "ollama",
		UpstreamBaseURL: upstream.URL + "/v1", UpstreamAPIKey: "upstream-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer gateway.Stop()

	req, _ := http.NewRequest(http.MethodPost, status.Endpoint+"/chat/completions", strings.NewReader(`{"model":"qwen","tools":[{"type":"function"}]}`))
	req.Header.Set("Authorization", "Bearer local-secret")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if receivedPath != "/v1/chat/completions" {
		t.Fatalf("path = %q", receivedPath)
	}
	if receivedAuth != "Bearer upstream-secret" {
		t.Fatalf("authorization = %q", receivedAuth)
	}
	if !strings.Contains(receivedBody, `"tools"`) {
		t.Fatalf("request body was not preserved: %s", receivedBody)
	}
}

func TestGatewayRequiresBearerToken(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("unauthorized request reached upstream")
	}))
	defer upstream.Close()
	gateway := New()
	status, err := gateway.Start(Config{Token: "secret", UpstreamBaseURL: upstream.URL + "/v1"})
	if err != nil {
		t.Fatal(err)
	}
	defer gateway.Stop()

	resp, err := http.Get(status.Endpoint + "/models")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestGatewayFlushesStreamingChunks(t *testing.T) {
	firstWritten := make(chan struct{})
	releaseSecond := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		close(firstWritten)
		<-releaseSecond
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	gateway := New()
	status, err := gateway.Start(Config{Token: "secret", UpstreamBaseURL: upstream.URL + "/v1"})
	if err != nil {
		t.Fatal(err)
	}
	defer gateway.Stop()

	req, _ := http.NewRequest(http.MethodPost, status.Endpoint+"/chat/completions", strings.NewReader(`{"stream":true}`))
	req.Header.Set("Authorization", "Bearer secret")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	<-firstWritten

	lineResult := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(resp.Body).ReadString('\n')
		lineResult <- line
	}()
	select {
	case line := <-lineResult:
		if line != "data: first\n" {
			t.Fatalf("first streamed line = %q", line)
		}
	case <-time.After(time.Second):
		t.Fatal("first SSE chunk was buffered by gateway")
	}
	close(releaseSecond)
}

func TestGatewayStopUpdatesStatus(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	defer upstream.Close()
	gateway := New()
	if _, err := gateway.Start(Config{Token: "secret", UpstreamBaseURL: upstream.URL + "/v1"}); err != nil {
		t.Fatal(err)
	}
	if err := gateway.Stop(); err != nil {
		t.Fatal(err)
	}
	if gateway.Status().Running {
		t.Fatal("gateway still reports running after stop")
	}
	// Ensure repeated lifecycle calls are harmless.
	if err := gateway.Stop(); err != nil && err != context.Canceled {
		t.Fatal(err)
	}
}
