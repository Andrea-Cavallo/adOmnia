package adomniacli

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mcpFlowWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeMCPFile(t, filepath.Join(root, "src", "com", "acme", "PaymentFlow.java"), `package com.acme;

public class PaymentFlow {
	@Flow
	public void execute() {
		authorize();
		ledger.record();
	}

	@Subflow
	public void authorize() {
	}
}
`)
	writeMCPFile(t, filepath.Join(root, "src", "com", "acme", "Ledger.java"), `package com.acme;

public class Ledger {
	public void record() {
	}
}
`)
	writeMCPFile(t, filepath.Join(root, "flows", "authorization.xml"), `<?xml version="1.0"?>
<flows>
  <flow id="AutorizzazionePagamento">
    <subflow ref="VerificaRischio"/>
  </flow>
</flows>
`)
	return root
}

func TestMCPFlowTools(t *testing.T) {
	root := mcpFlowWorkspace(t)
	server := osgiMCPServer(t, root, false)

	names := map[string]bool{}
	for _, tool := range mcpTools() {
		names[tool.Name] = true
	}
	for _, expected := range []string{"flow_discover", "flow_trace", "flow_find_paths", "flow_impact", "flow_explain"} {
		if !names[expected] {
			t.Fatalf("tool %s not registered", expected)
		}
	}

	text, err := server.callFlowTool("flow_discover", jsonv1.RawMessage(`{"refresh":true}`))
	if err != nil {
		t.Fatal(err)
	}
	var discovery struct {
		Flows []map[string]any `json:"flows"`
		Count map[string]int   `json:"counts"`
	}
	if err := json.Unmarshal([]byte(text), &discovery); err != nil {
		t.Fatal(err)
	}
	if len(discovery.Flows) < 3 || discovery.Count["flow"] == 0 || discovery.Count["subflow"] == 0 {
		t.Fatalf("discovery = %s", text)
	}

	text, err = server.callFlowTool("flow_trace", jsonv1.RawMessage(`{"id":"PaymentFlow.execute","direction":"downstream","depth":3}`))
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Root  map[string]any   `json:"root"`
		Steps []map[string]any `json:"steps"`
	}
	if err := json.Unmarshal([]byte(text), &trace); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, `"steps"`) || len(trace.Steps) == 0 {
		t.Fatalf("trace = %s", text)
	}
	if trace.Root["kind"] != "flow" {
		t.Fatalf("trace should start at the flow, got %v", trace.Root["kind"])
	}

	text, err = server.callFlowTool("flow_impact", jsonv1.RawMessage(`{"id":"Ledger.record","depth":4}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "PaymentFlow.execute") {
		t.Fatalf("impact = %s", text)
	}

	text, err = server.callFlowTool("flow_find_paths", jsonv1.RawMessage(`{"from":"PaymentFlow.execute","to":"Ledger.record","depth":6}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, `"paths"`) {
		t.Fatalf("paths = %s", text)
	}

	text, err = server.callFlowTool("flow_explain", jsonv1.RawMessage(`{"id":"Ledger.record"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, `"source"`) || !strings.Contains(text, "Ledger.java") {
		t.Fatalf("explain = %s", text)
	}

	if _, err := server.callFlowTool("flow_runtime", jsonv1.RawMessage(`{}`)); err == nil || !strings.Contains(err.Error(), "not running") {
		t.Fatalf("flow_runtime without a runtime = %v", err)
	}

	if _, err := server.callFlowTool("flow_trace", jsonv1.RawMessage(`{"id":"NoSuchFlow"}`)); err == nil {
		t.Fatal("an unknown node must fail")
	}
}

func TestMCPFlowCacheRefresh(t *testing.T) {
	root := mcpFlowWorkspace(t)
	server := osgiMCPServer(t, root, false)
	if _, err := server.callFlowTool("flow_discover", jsonv1.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	// A new flow file is not seen until a refresh is requested.
	writeMCPFile(t, filepath.Join(root, "src", "com", "acme", "OtherFlow.java"), `package com.acme;

public class OtherFlow {
	@Flow
	public void run() {
	}
}
`)
	text, err := server.callFlowTool("flow_discover", jsonv1.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, "OtherFlow.run") {
		t.Fatalf("cached discovery must not see new files: %s", text)
	}
	text, err = server.callFlowTool("flow_discover", jsonv1.RawMessage(`{"refresh":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "OtherFlow.run") {
		t.Fatalf("refresh must see the new flow: %s", text)
	}
	_ = os.Remove(filepath.Join(root, "src", "com", "acme", "OtherFlow.java"))
}
