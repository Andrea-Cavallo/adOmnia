package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// --- Map Local Handler ---

func proxyMapLocalHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		mapLocalRulesMu.RLock()
		rules := mapLocalRules
		mapLocalRulesMu.RUnlock()
		if rules == nil {
			rules = []mapLocalRule{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "rules": rules})

	case http.MethodPost:
		var body struct {
			Rules []mapLocalRule `json:"rules"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			jsonError(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		mapLocalRulesMu.Lock()
		mapLocalRules = body.Rules
		mapLocalRulesMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "count": len(body.Rules)})

	default:
		http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
	}
}

// --- Map Remote Handler ---

func proxyMapRemoteHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		mapRemoteRulesMu.RLock()
		rules := mapRemoteRules
		mapRemoteRulesMu.RUnlock()
		if rules == nil {
			rules = []mapRemoteRule{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "rules": rules})

	case http.MethodPost:
		var body struct {
			Rules []mapRemoteRule `json:"rules"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			jsonError(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		mapRemoteRulesMu.Lock()
		mapRemoteRules = body.Rules
		mapRemoteRulesMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "count": len(body.Rules)})

	default:
		http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
	}
}

// --- Throttle Handler ---

func proxyThrottleHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		proxyThrottleMu.RLock()
		cfg := proxyThrottle
		proxyThrottleMu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "config": cfg})

	case http.MethodPost:
		var cfg throttleConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			jsonError(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		proxyThrottleMu.Lock()
		proxyThrottle = cfg
		proxyThrottleMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "config": cfg})

	default:
		http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
	}
}

// --- Repeat Handler ---

func proxyRepeatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if body.ID == "" {
		jsonError(w, "missing id", 400)
		return
	}

	trafficMu.RLock()
	var original *trafficEntry
	for i := range trafficLog {
		if trafficLog[i].ID == body.ID {
			entry := trafficLog[i]
			original = &entry
			break
		}
	}
	trafficMu.RUnlock()

	if original == nil {
		jsonError(w, "entry not found: "+body.ID, 404)
		return
	}

	start := time.Now()

	req, err := http.NewRequest(original.Method, original.URL, bytes.NewReader([]byte(original.ReqBody)))
	if err != nil {
		jsonError(w, "failed to create request: "+err.Error(), 500)
		return
	}
	for k, v := range original.ReqHeaders {
		lk := strings.ToLower(k)
		if lk == "host" || lk == "connection" || lk == "proxy-connection" {
			continue
		}
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		jsonError(w, "request failed: "+err.Error(), 502)
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	duration := time.Since(start)

	respHeaders := make(map[string]string)
	for k, vs := range resp.Header {
		respHeaders[k] = strings.Join(vs, ", ")
	}

	recordEntry(original.URL, original.Method, original.ReqHeaders, original.ReqBody, resp.StatusCode, respHeaders, string(respBody), duration, "", false)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":         true,
		"status":     resp.StatusCode,
		"headers":    respHeaders,
		"body":       truncateBody(string(respBody), 64*1024),
		"durationMs": float64(duration.Microseconds()) / 1000.0,
		"originalId": body.ID,
	})
}
