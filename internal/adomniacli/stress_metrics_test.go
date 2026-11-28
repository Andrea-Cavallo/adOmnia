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
