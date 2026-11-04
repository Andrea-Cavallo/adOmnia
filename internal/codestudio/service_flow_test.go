package codestudio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFlowSource(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestFlowIntelligenceServiceEndToEnd(t *testing.T) {
	root := t.TempDir()
	writeFlowSource(t, root, "src/com/acme/PaymentFlow.java", `package com.acme;

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
	writeFlowSource(t, root, "src/com/acme/Ledger.java", `package com.acme;

public class Ledger {
	public void record() {
	}
}
`)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.FlowOverview(id, false); err == nil {
		t.Fatal("an untrusted project must not be indexed")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}

	overview, err := service.FlowOverview(id, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.Flows) < 2 || overview.Counts["method"] < 3 {
		t.Fatalf("overview = %+v", overview)
	}
	flows, err := service.FlowSearch(id, "PaymentFlow", "", 10)
	if err != nil || len(flows) == 0 {
		t.Fatalf("search = %+v (%v)", flows, err)
	}

	trace, err := service.FlowTrace(id, "PaymentFlow.execute", "downstream", 3)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Root.Kind != "flow" || len(trace.Steps) == 0 {
		t.Fatalf("trace = %+v", trace)
	}

	impact, err := service.FlowImpact(id, "Ledger.record", 4)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, flow := range impact.Flows {
		if strings.Contains(flow.Label, "PaymentFlow.execute") {
			found = true
		}
	}
	if !found {
		t.Fatalf("impact = %+v", impact)
	}

	explanation, err := service.FlowExplain(id, "Ledger.record")
	if err != nil {
		t.Fatal(err)
	}
	if explanation.Source == nil || !strings.Contains(explanation.Source.File, "Ledger.java") {
		t.Fatalf("explanation = %+v", explanation)
	}

	paths, err := service.FlowFindPaths(id, "PaymentFlow.execute", "Ledger.record", 6, 2)
	if err != nil || len(paths) == 0 {
		t.Fatalf("paths = %+v (%v)", paths, err)
	}

	// A refresh re-reads the sources: a new flow appears.
	writeFlowSource(t, root, "src/com/acme/OtherFlow.java", "package com.acme;\npublic class OtherFlow {\n\t@Flow\n\tpublic void run() {\n\t}\n}\n")
	if _, err := service.FlowOverview(id, false); err != nil {
		t.Fatal(err)
	}
	refreshed, err := service.FlowOverview(id, true)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, flow := range refreshed.Flows {
		if strings.Contains(flow.Label, "OtherFlow.run") {
			found = true
		}
	}
	if !found {
		t.Fatalf("refresh did not see the new flow: %+v", refreshed.Flows)
	}
}
