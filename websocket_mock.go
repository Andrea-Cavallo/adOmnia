package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tidwall/gjson"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type WsMockCondition struct {
	Type  string `json:"type"`  // any | exact | contains | regex | jsonpath_eq | jsonpath_exists
	Field string `json:"field"` // gjson path (jsonpath_* types)
	Value string `json:"value"`
}

type WsMockRule struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Enabled   bool            `json:"enabled"`
	Condition WsMockCondition `json:"condition"`
	// Response is a JSLT-lite template:
	//   {{.field}}          → gjson path from incoming JSON
	//   {{$MSG}}            → full incoming message string
	//   {{$NOW}}            → current unix ms timestamp
	//   {{$UUID}}           → random ID
	Response string `json:"response"`
	DelayMs  int    `json:"delayMs"`
}

type WsMockHit struct {
	Timestamp int64  `json:"timestamp"`
	RuleID    string `json:"ruleId"`
	RuleName  string `json:"ruleName"`
	Incoming  string `json:"incoming"`
	Response  string `json:"response"`
	Matched   bool   `json:"matched"`
}

// ── Singleton state ───────────────────────────────────────────────────────────

var wsMock struct {
	sync.Mutex
	ln      net.Listener
	port    int
	rules   []WsMockRule
	hits    []WsMockHit
	running bool
	clients sync.Map // *websocket.Conn → struct{}
}

var wsMockUpgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

// ── Condition matching ────────────────────────────────────────────────────────

func wsMockMatch(rule WsMockRule, msg string) bool {
	if !rule.Enabled {
		return false
	}
	c := rule.Condition
	switch c.Type {
	case "any":
		return true
	case "exact":
		return msg == c.Value
	case "contains":
		return strings.Contains(msg, c.Value)
	case "regex":
		ok, _ := regexp.MatchString(c.Value, msg)
		return ok
	case "jsonpath_eq":
		return gjson.Get(msg, c.Field).String() == c.Value
	case "jsonpath_exists":
		return gjson.Get(msg, c.Field).Exists()
	}
	return false
}

// ── JSLT-lite template rendering ──────────────────────────────────────────────

var jsltFieldRe = regexp.MustCompile(`\{\{\.([^}]+)\}\}`)

func wsMockRender(tmpl, incoming string) string {
	out := tmpl
	out = strings.ReplaceAll(out, "{{$MSG}}", incoming)
	out = strings.ReplaceAll(out, "{{$NOW}}", fmt.Sprintf("%d", time.Now().UnixMilli()))
	out = strings.ReplaceAll(out, "{{$UUID}}", wsNewSessionID())
	out = jsltFieldRe.ReplaceAllStringFunc(out, func(match string) string {
		path := jsltFieldRe.FindStringSubmatch(match)[1]
		val := gjson.Get(incoming, path)
		if !val.Exists() {
			return match
		}
		// Return raw JSON for objects/arrays, plain string otherwise
		if val.Type == gjson.JSON {
			return val.Raw
		}
		return val.String()
	})
	return out
}

// ── Mock WS connection handler ────────────────────────────────────────────────

func wsMockWSHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := wsMockUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	wsMock.clients.Store(conn, struct{}{})
	defer func() {
		wsMock.clients.Delete(conn)
		conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		msg := string(data)

		wsMock.Lock()
		rules := make([]WsMockRule, len(wsMock.rules))
		copy(rules, wsMock.rules)
		wsMock.Unlock()

		matched := false
		for _, rule := range rules {
			if !wsMockMatch(rule, msg) {
				continue
			}
			response := wsMockRender(rule.Response, msg)
			if rule.DelayMs > 0 {
				time.Sleep(time.Duration(rule.DelayMs) * time.Millisecond)
			}
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			writeErr := conn.WriteMessage(websocket.TextMessage, []byte(response))
			conn.SetWriteDeadline(time.Time{})

			wsMock.Lock()
			wsMock.hits = wsMockAppendHit(wsMock.hits, WsMockHit{
				Timestamp: time.Now().UnixMilli(),
				RuleID:    rule.ID,
				RuleName:  rule.Name,
				Incoming:  msg,
				Response:  response,
				Matched:   true,
			})
			wsMock.Unlock()

			if writeErr != nil {
				return
			}
			matched = true
			break
		}

		if !matched {
			wsMock.Lock()
			wsMock.hits = wsMockAppendHit(wsMock.hits, WsMockHit{
				Timestamp: time.Now().UnixMilli(),
				Incoming:  msg,
				Matched:   false,
			})
			wsMock.Unlock()
		}
	}
}

func wsMockAppendHit(hits []WsMockHit, h WsMockHit) []WsMockHit {
	if len(hits) >= 500 {
		hits = hits[1:]
	}
	return append(hits, h)
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

func wsMockStartHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	wsMock.Lock()
	defer wsMock.Unlock()

	if wsMock.running {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"port": wsMock.port, "running": true})
		return
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	port := ln.Addr().(*net.TCPAddr).Port
	wsMock.ln = ln
	wsMock.port = port
	wsMock.running = true
	wsMock.hits = nil

	mux := http.NewServeMux()
	mux.HandleFunc("/", wsMockWSHandler)
	go http.Serve(ln, mux) //nolint:errcheck

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"port": port, "running": true})
}

func wsMockStopHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	wsMock.Lock()
	defer wsMock.Unlock()

	if wsMock.ln != nil {
		wsMock.ln.Close()
		wsMock.ln = nil
	}
	wsMock.running = false
	wsMock.clients.Range(func(k, _ any) bool {
		k.(*websocket.Conn).Close()
		return true
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func wsMockStatusHandler(w http.ResponseWriter, r *http.Request) {
	wsMock.Lock()
	defer wsMock.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"running": wsMock.running,
		"port":    wsMock.port,
		"hits":    wsMock.hits,
	})
}

func wsMockRulesGetHandler(w http.ResponseWriter, r *http.Request) {
	wsMock.Lock()
	rules := make([]WsMockRule, len(wsMock.rules))
	copy(rules, wsMock.rules)
	wsMock.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rules)
}

func wsMockRulesSaveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var rules []WsMockRule
	if err := json.NewDecoder(r.Body).Decode(&rules); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	wsMock.Lock()
	wsMock.rules = rules
	wsMock.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func wsMockHitsClearHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	wsMock.Lock()
	wsMock.hits = nil
	wsMock.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
