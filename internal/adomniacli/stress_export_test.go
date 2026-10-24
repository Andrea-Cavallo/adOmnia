package adomniacli

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// exportedPlanJSON is the exact shape flowStressExport.stressPlanJson writes:
// graph is a FlowGraphDefinition, so nodes use id/type/label and edges use
// id/source/target/branch. A plan exported from Flow Builder must run as-is.
func exportedPlanJSON(url string, iterations int) string {
	return `{
  "format": "adomnia-flow-stress-plan",
  "version": 1,
  "flowName": "Exported flow",
  "graph": {
    "nodes": [
      {
        "id": "node-1",
        "type": "start",
        "label": "Start",
        "x": 120,
        "y": 80,
        "config": {}
      },
      {
        "id": "node-2",
        "type": "request",
        "label": "Health",
        "x": 320,
        "y": 80,
        "config": {
          "request": {
            "id": "req-1",
            "name": "Health",
            "type": "request",
            "method": "GET",
            "url": "` + url + `",
            "params": [],
            "headers": [],
            "bodies": [],
            "assertions": []
          },
          "expectedStatus": "2xx",
          "seq": 1
        }
      },
      {
        "id": "node-3",
        "type": "end",
        "label": "Done",
        "x": 520,
        "y": 80,
        "config": { "endState": "success" }
      }
    ],
    "edges": [
      { "id": "edge-1", "source": "node-1", "target": "node-2", "branch": "next" },
      { "id": "edge-2", "source": "node-2", "target": "node-3", "branch": "success" }
    ],
    "viewport": { "x": 0, "y": 0, "zoom": 1 },
    "settings": { "maxSteps": 20, "failOnHttpError": true, "stopOnMissingBranch": true }
  },
  "config": {
    "vus": 1,
    "mode": "iterations",
    "iterations": ` + itoa(iterations) + `,
    "apdexTMs": 500,
    "maxErrorPct": 0
  }
}`
}

func itoa(value int) string {
	switch value {
	case 3:
		return "3"
	case 4:
		return "4"
	default:
		return "1"
	}
}

func TestStressRunsPlanExportedFromFlowBuilder(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "exported.stress.json")
	if err := os.WriteFile(path, []byte(exportedPlanJSON(server.URL, 3)), 0600); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	if code := Run([]string{"stress", path, "--reporter", "json"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exported plan did not run: code=%d stderr=%s stdout=%s", code, stderr.String(), stdout.String())
	}
	if got := calls.Load(); got != 3 {
		t.Fatalf("server saw %d requests, want 3: an exported plan must execute every iteration", got)
	}
	if !strings.Contains(stdout.String(), `"requests": 3`) {
		t.Fatalf("report does not count the requests: %s", stdout.String())
	}
}

func TestStressRejectsPlanWithoutNodeIdentity(t *testing.T) {
	// Without ids and types nothing can be executed, so the run must fail loudly
	// instead of reporting 0 requests as a valid result.
	plan := `{
  "format": "adomnia-flow-stress-plan",
  "version": 1,
  "graph": { "nodes": [ { "label": "Health", "config": {} } ], "edges": [] },
  "config": { "vus": 1, "mode": "iterations", "iterations": 1 }
}`
	path := filepath.Join(t.TempDir(), "broken.stress.json")
	if err := os.WriteFile(path, []byte(plan), 0600); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	if code := Run([]string{"stress", path}, &stdout, &stderr); code == 0 {
		t.Fatalf("plan without node id/type was accepted: %s %s", stdout.String(), stderr.String())
	}
	if !strings.Contains(stderr.String(), "node") {
		t.Fatalf("error does not explain the missing node identity: %s", stderr.String())
	}
}
