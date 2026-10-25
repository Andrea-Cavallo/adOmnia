package adomniacli

import (
	"bytes"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func failingPlan(url string, iterations int) string {
	return `{
  "format": "adomnia-flow-stress-plan",
  "version": 1,
  "flowName": "Failing target",
  "graph": {
    "nodes": [
      { "id": "n1", "type": "request", "label": "GET dead", "config": {
        "request": { "id": "r1", "name": "Dead", "type": "request", "method": "GET", "url": "` + url + `", "headers": [], "params": [], "assertions": [] },
        "expectedStatus": "200" } },
      { "id": "n2", "type": "end", "label": "end", "config": { "endState": "success" } }
    ],
    "edges": [{ "source": "n1", "target": "n2", "branch": "next" }],
    "settings": { "maxSteps": 5, "failOnHttpError": true }
  },
  "config": { "vus": 1, "mode": "iterations", "iterations": ` + itoa(iterations) + `, "apdexTMs": 300, "minApdex": 0.9 }
}`
}

// A run that fails every request must say why: a bare "ERR" is not evidence.
func TestStressReportsErrorReasons(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	deadAddr := listener.Addr().String()
	_ = listener.Close() // nobody listens here anymore: connection refused

	path := filepath.Join(t.TempDir(), "failing.stress.json")
	if err := os.WriteFile(path, []byte(failingPlan("http://"+deadAddr+"/nothing", 3)), 0600); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	if code := Run([]string{"stress", path, "--reporter", "json"}, &stdout, &stderr); code != 1 {
		t.Fatalf("code=%d stderr=%s", code, stderr.String())
	}
	out := stdout.String()
	if !strings.Contains(out, `"errorGroups"`) {
		t.Fatalf("no error groups in the result: %s", out)
	}
	if !strings.Contains(out, `"count": 3`) {
		t.Fatalf("error group does not count the 3 failures: %s", out)
	}
	if strings.Contains(out, `"message": ""`) {
		t.Fatalf("error group has an empty message: %s", out)
	}
	// The CLI reporter must show the reason too, not only the JSON.
	var cliOut, cliErr bytes.Buffer
	if code := Run([]string{"stress", path}, &cliOut, &cliErr); code != 1 {
		t.Fatalf("cli code=%d %s", code, cliErr.String())
	}
	if !strings.Contains(cliOut.String(), "error") || !strings.Contains(cliOut.String(), "×3") {
		t.Fatalf("cli reporter hides the reason: %s", cliOut.String())
	}
}

// Failed requests are frustrated users: they must not inflate APDEX (0 ms latency
// previously counted as "satisfied") and must not make latency percentiles look good.
func TestStressApdexAndPercentilesIgnoreFailedRequests(t *testing.T) {
	items := []stressObservation{
		{Step: "ok", LatencyMs: 10, Status: 200},
		{Step: "ok", LatencyMs: 20, Status: 200},
		{Step: "boom", LatencyMs: 0, Status: 0, Failed: true, Error: "connection refused"},
		{Step: "boom", LatencyMs: 0, Status: 0, Failed: true, Error: "connection refused"},
		// A connect attempt takes a few ms and a slow 5xx is a real server latency:
		// the first must stay out of the percentiles, the second must stay in.
		{Step: "boom", LatencyMs: 5, Status: 0, Failed: true, Error: "connect timeout"},
		{Step: "slow", LatencyMs: 900, Status: 500, Failed: true, Error: "HTTP 500"},
	}
	cfg := stressConfig{ApdexTMs: 100}

	stats := summarizeStress(items, 0, 6, 4, 100, 100, cfg)
	if stats.Apdex != 0.333 {
		t.Fatalf("apdex=%.3f, want 0.333 (2 ok fast out of 6 requests; failures are frustrated)", stats.Apdex)
	}
	if stats.P95 != 900 {
		t.Fatalf("p95=%dms, want 900: the slow 500 must stay visible and transport failures must not enter", stats.P95)
	}
	if len(stats.ErrorGroups) != 3 || stats.ErrorGroups[0].Count != 2 || stats.ErrorGroups[0].Message == "" {
		t.Fatalf("error groups = %+v", stats.ErrorGroups)
	}
	if strings.Contains(stats.ErrorGroups[0].Message, "<n>") {
		t.Fatalf("message was masked for display: %q", stats.ErrorGroups[0].Message)
	}

	allFailed := summarizeStress(items[2:], 0, 4, 4, 10, 10, cfg)
	if allFailed.Apdex != 0 {
		t.Fatalf("all-failed apdex=%.3f, want 0", allFailed.Apdex)
	}

	// Groups stay bounded on noisy runs and are ordered by frequency.
	many := []stressObservation{}
	for i := 0; i < 20; i++ {
		msg := "timeout talking to upstream"
		if i%2 == 1 {
			msg = "connection refused"
		}
		many = append(many, stressObservation{Step: "s", Status: 0, Failed: true, Error: msg})
	}
	grouped := summarizeStress(many, 0, 20, 20, 10, 10, cfg)
	if len(grouped.ErrorGroups) != 2 {
		t.Fatalf("groups=%+v", grouped.ErrorGroups)
	}
	if grouped.ErrorGroups[0].Count != 10 || grouped.ErrorGroups[1].Count != 10 {
		t.Fatalf("groups not grouped by message: %+v", grouped.ErrorGroups)
	}
}
