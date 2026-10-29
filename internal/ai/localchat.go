package ai

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
)

func localEndpoint(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("use a local HTTP endpoint, such as http://localhost:1234/v1")
	}
	ip := net.ParseIP(u.Hostname())
	if u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return "", fmt.Errorf("Local LLM only connects to loopback addresses")
	}
	return strings.TrimRight(u.String(), "/"), nil
}

// LocalChatHandler runs behind the sidecar's origin and per-launch token checks.
// File access stays in the project owner; this endpoint only transports model messages.
func LocalChatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var input struct {
		Endpoint string         `json:"endpoint"`
		APIKey   string         `json:"apiKey"`
		Models   bool           `json:"models"`
		Payload  jsontext.Value `json:"payload"`
	}
	if err := json.UnmarshalRead(http.MaxBytesReader(w, r.Body, 12<<20), &input); err != nil {
		http.Error(w, "invalid local chat request", http.StatusBadRequest)
		return
	}
	endpoint, err := localEndpoint(input.Endpoint)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	method, path := http.MethodPost, "/chat/completions"
	if input.Models {
		method, path = http.MethodGet, "/models"
	} else {
		var payload struct {
			Model    string           `json:"model"`
			Stream   bool             `json:"stream"`
			Messages []jsontext.Value `json:"messages"`
		}
		if err := json.Unmarshal(input.Payload, &payload); err != nil || payload.Model == "" || !payload.Stream || len(payload.Messages) == 0 || len(payload.Messages) > 100 {
			http.Error(w, "model, streaming and 1–100 messages required", http.StatusBadRequest)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, method, endpoint+path, bytes.NewReader(input.Payload))
	if err != nil {
		http.Error(w, "invalid local endpoint", http.StatusBadRequest)
		return
	}
	request.Header.Set("Content-Type", "application/json")
	if input.APIKey != "" {
		request.Header.Set("Authorization", "Bearer "+input.APIKey)
	}
	client := *netpolicy.Client("ai", 0)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		http.Error(w, "Cannot reach the local model server. Check its address and start the server.", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		http.Error(w, fmt.Sprintf("Local server returned %d: %s", response.StatusCode, body), http.StatusBadGateway)
		return
	}
	if input.Models {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.Copy(w, io.LimitReader(response.Body, 2<<20))
		return
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		http.Error(w, "The local server did not return an event stream", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	controller := http.NewResponseController(w)
	buffer := make([]byte, 4096)
	for {
		n, readErr := response.Body.Read(buffer)
		if n > 0 {
			if _, err := w.Write(buffer[:n]); err != nil {
				return
			}
			_ = controller.Flush()
		}
		if readErr != nil {
			return
		}
	}
}
