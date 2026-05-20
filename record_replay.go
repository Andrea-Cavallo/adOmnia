// record_replay.go — record real HTTP traffic and save as mock responses.
// Bridges proxy and mock server: one click to capture a real API → mock rule.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// recordRequest makes a real HTTP call and returns a mockResponse from it.
func recordRequest(url, method string, headers map[string]string, body string) (*mockResponse, error) {
	client := &http.Client{Timeout: 30 * time.Second}

	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}

	req, err := http.NewRequest(strings.ToUpper(method), url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "adOmnia/record")
	}

	start := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024)) // max 2MB
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	respHeaders := make(map[string]string)
	for k, v := range resp.Header {
		if len(v) > 0 {
			respHeaders[k] = v[0]
		}
	}

	mockResp := &mockResponse{
		ID:       fmt.Sprintf("rec-%d", time.Now().UnixNano()),
		Name:     fmt.Sprintf("%s %s → %d (%s)", method, truncateURL(url, 60), resp.StatusCode, elapsed.Round(time.Millisecond)),
		Status:   resp.StatusCode,
		Headers:  respHeaders,
		Body:     string(respBody),
		DelayMs:  0,
		IsActive: true,
	}

	log.Printf("[record] %s %s → %d in %s", method, url, resp.StatusCode, elapsed.Round(time.Millisecond))
	return mockResp, nil
}

func truncateURL(url string, maxLen int) string {
	if len(url) <= maxLen {
		return url
	}
	return url[:maxLen-3] + "..."
}

// recordReplayHandler records a real HTTP request and adds it as a mock endpoint.
// POST /mock/record
func recordReplayHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		URL        string            `json:"url"`
		Method     string            `json:"method"`
		Headers    map[string]string `json:"headers"`
		Body       string            `json:"body"`
		MockPath   string            `json:"mockPath"`
		MockMethod string            `json:"mockMethod"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.URL == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}
	if req.Method == "" {
		req.Method = "GET"
	}
	if req.MockPath == "" {
		req.MockPath = extractPath(req.URL)
	}
	if req.MockMethod == "" {
		req.MockMethod = req.Method
	}

	mockResp, err := recordRequest(req.URL, req.Method, req.Headers, req.Body)
	if err != nil {
		http.Error(w, "record failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	endpoint := mockEndpoint{
		ID:        fmt.Sprintf("rec-%d", time.Now().UnixNano()),
		Path:      req.MockPath,
		Method:    req.MockMethod,
		Responses: []mockResponse{*mockResp},
		Mode:      "first_active",
	}

	mockCfgMu.Lock()
	mockCfg.Endpoints = append(mockCfg.Endpoints, endpoint)
	mockCfgMu.Unlock()

	if storeDB != nil {
		data, _ := json.Marshal(mockCfg)
		_ = storePut("mock", "config", data)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"endpoint": endpoint,
		"response": mockResp,
	})
}

func extractPath(rawURL string) string {
	for _, prefix := range []string{"https://", "http://"} {
		if after, ok := strings.CutPrefix(rawURL, prefix); ok {
			if idx := strings.Index(after, "/"); idx >= 0 {
				return after[idx:]
			}
			return "/"
		}
	}
	return rawURL
}
