package adomniacli

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// The app exports every node kind, including the `extract` node created from a
// recorded script step, together with extractions and conditions. A plan built by
// the UI must run all of it.
func TestStressRunsExtractionsConditionsAndExtractNodes(t *testing.T) {
	var mutex sync.Mutex
	headers := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mutex.Lock()
		headers = append(headers, r.Header.Get("X-Token"))
		mutex.Unlock()
		if r.URL.Path == "/login" {
			w.Header().Set("X-Token", "tok-42")
			_, _ = w.Write([]byte(`{"kind":"session"}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	plan := `{
  "format": "adomnia-flow-stress-plan",
  "version": 1,
  "flowName": "Recorded flow",
  "graph": {
    "nodes": [
      { "id": "n1", "type": "start", "label": "Start", "config": {} },
      { "id": "n2", "type": "request", "label": "Login", "config": {
        "request": { "id": "r1", "name": "Login", "type": "request", "method": "GET", "url": "` + server.URL + `/login", "headers": [], "params": [], "assertions": [] },
        "expectedStatus": "200",
        "extractions": [ { "id": "m1", "name": "token", "source": "header", "path": "X-Token", "fallback": "none" } ] } },
      { "id": "n3", "type": "extract", "label": "Script", "config": {
        "extractions": [ { "id": "m2", "name": "kind", "source": "body", "path": "kind" } ] } },
      { "id": "n4", "type": "condition", "label": "Has token", "config": {
        "condition": { "source": "variable", "path": "token", "operator": "eq", "value": "tok-42" } } },
      { "id": "n5", "type": "request", "label": "Secure", "config": {
        "request": { "id": "r2", "name": "Secure", "type": "request", "method": "GET", "url": "` + server.URL + `/secure", "headers": [ { "key": "X-Token", "value": "{{token}}", "enabled": true } ], "params": [], "assertions": [] },
        "expectedStatus": "2xx" } },
      { "id": "n6", "type": "request", "label": "Wrong branch", "config": {
        "request": { "id": "r3", "name": "Wrong", "type": "request", "method": "GET", "url": "` + server.URL + `/wrong", "headers": [], "params": [], "assertions": [] } } },
      { "id": "n7", "type": "end", "label": "Done", "config": { "endState": "success" } }
    ],
    "edges": [
      { "id": "e1", "source": "n1", "target": "n2", "branch": "next" },
      { "id": "e2", "source": "n2", "target": "n3", "branch": "success" },
      { "id": "e3", "source": "n3", "target": "n4", "branch": "next" },
      { "id": "e4", "source": "n4", "target": "n5", "branch": "true" },
      { "id": "e5", "source": "n4", "target": "n6", "branch": "false" },
      { "id": "e6", "source": "n5", "target": "n7", "branch": "success" },
      { "id": "e7", "source": "n6", "target": "n7", "branch": "success" }
    ],
    "settings": { "maxSteps": 20, "failOnHttpError": true }
  },
  "config": { "vus": 1, "mode": "iterations", "iterations": 1, "apdexTMs": 500 }
}`
	path := filepath.Join(t.TempDir(), "recorded.stress.json")
	if err := os.WriteFile(path, []byte(plan), 0600); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	if code := Run([]string{"stress", path}, &stdout, &stderr); code != 0 {
		t.Fatalf("code=%d %s %s", code, stdout.String(), stderr.String())
	}
	if len(headers) != 2 {
		t.Fatalf("server saw %d requests (%v), want 2: the extract node must not break the walk", len(headers), headers)
	}
	if headers[1] != "tok-42" {
		t.Fatalf("second request carried X-Token=%q: extraction from the header did not reach the variable", headers[1])
	}
}

// A graph with no entry point must fail instead of reporting zero requests as a
// passing run.
func TestStressRejectsGraphWithoutEntryPoint(t *testing.T) {
	plan := `{
  "format": "adomnia-flow-stress-plan",
  "version": 1,
  "graph": {
    "nodes": [
      { "id": "a", "type": "request", "label": "A", "config": { "request": { "id": "a", "name": "A", "type": "request", "method": "GET", "url": "http://127.0.0.1:1/a" } } },
      { "id": "b", "type": "request", "label": "B", "config": { "request": { "id": "b", "name": "B", "type": "request", "method": "GET", "url": "http://127.0.0.1:1/b" } } }
    ],
    "edges": [
      { "id": "e1", "source": "a", "target": "b", "branch": "next" },
      { "id": "e2", "source": "b", "target": "a", "branch": "next" }
    ],
    "settings": { "maxSteps": 5 }
  },
  "config": { "vus": 1, "mode": "iterations", "iterations": 1 }
}`
	path := filepath.Join(t.TempDir(), "cycled.stress.json")
	if err := os.WriteFile(path, []byte(plan), 0600); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"stress", path}, &stdout, &stderr); code == 0 {
		t.Fatalf("graph with no entry point passed: %s%s", stdout.String(), stderr.String())
	}
	if !strings.Contains(stderr.String(), "no request") {
		t.Fatalf("error does not explain the empty run: %s", stderr.String())
	}
}

func TestStressRejectsDuplicateNodeIDs(t *testing.T) {
	plan := `{
  "format": "adomnia-flow-stress-plan",
  "version": 1,
  "graph": {
    "nodes": [
      { "id": "same", "type": "request", "label": "A", "config": { "request": { "id": "a", "name": "A", "type": "request", "method": "GET", "url": "http://127.0.0.1:1/a" } } },
      { "id": "same", "type": "request", "label": "B", "config": { "request": { "id": "b", "name": "B", "type": "request", "method": "GET", "url": "http://127.0.0.1:1/b" } } }
    ],
    "edges": [],
    "settings": { "maxSteps": 5 }
  },
  "config": { "vus": 1, "mode": "iterations", "iterations": 1 }
}`
	path := filepath.Join(t.TempDir(), "duplicate.stress.json")
	if err := os.WriteFile(path, []byte(plan), 0600); err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	if code := Run([]string{"stress", path}, &bytes.Buffer{}, &stderr); code == 0 {
		t.Fatal("duplicate node ids accepted")
	}
	if !strings.Contains(stderr.String(), "duplicate node id") {
		t.Fatalf("error does not name the duplicate: %s", stderr.String())
	}
}
