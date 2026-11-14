package diagrams

import (
	"strings"
	"testing"
)

const orderMarkdown = "# Order platform\n\n" +
	"## Edge\n- **Web app** (React): the storefront\n- API Gateway\n\n" +
	"## Backend\n- Order Service (Go)\n- Orders DB (Postgres)\n- orders topic (Kafka)\n\n" +
	"## Flow\n" +
	"Web app -> API Gateway: HTTPS\nAPI Gateway => Order Service\nOrder Service -> Orders DB: insert\nOrder Service --> orders topic: OrderPlaced\n\n" +
	"## Checkout\n1. Open cart\n2. Is the card valid?\n3. Confirm order\n\n" +
	"```mermaid\nsequenceDiagram\nUser->>API: pay\nAPI-->>User: ok\n```\n"

func TestFromMarkdownComponentsLinksStepsAndSequence(t *testing.T) {
	bp, err := FromMarkdown(orderMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	if bp.Name != "Order platform" || bp.Format != BlueprintFormat {
		t.Fatalf("name/format = %q/%q", bp.Name, bp.Format)
	}
	shapes := map[string]Node{}
	for _, node := range bp.Nodes {
		shapes[node.Label] = node
	}
	expect := map[string]string{"Web app": "client", "API Gateway": "gateway", "Order Service": "service", "Orders DB": "database", "orders topic": "kafka-topic", "Edge": "container", "Backend": "container", "Is the card valid?": "decision", "Open cart": "terminator"}
	for label, shape := range expect {
		if shapes[label].Shape != shape {
			t.Errorf("%s: shape %q, want %q", label, shapes[label].Shape, shape)
		}
	}
	if shapes["Web app"].Subtitle != "React" || shapes["Order Service"].Parent != shapes["Backend"].Key {
		t.Errorf("subtitle/parent not kept: %+v", shapes["Web app"])
	}
	if _, ok := shapes["Flow"]; ok {
		t.Error("a section without components must not become an empty container")
	}
	var dashed, flow, steps int
	for _, link := range bp.Links {
		if link.Dashed {
			dashed++
		}
		if link.Flow {
			flow++
		}
		if strings.HasPrefix(link.From, "step-") {
			steps++
		}
	}
	if dashed != 1 || flow < 2 || steps != 2 {
		t.Errorf("links dashed=%d flow=%d steps=%d: %+v", dashed, flow, steps, bp.Links)
	}
	if !strings.Contains(bp.Sequence, "User->>API: pay") {
		t.Errorf("sequence block not kept: %q", bp.Sequence)
	}
}

func TestFromMarkdownMermaidFlowchart(t *testing.T) {
	bp, err := FromMarkdown("```mermaid\nflowchart LR\n  A[Start] --> B{Valid?}\n  B -->|yes| C[(Ledger)]\n  B -.->|no| D(Reject)\n```")
	if err != nil {
		t.Fatal(err)
	}
	if len(bp.Nodes) != 4 || len(bp.Links) != 3 {
		t.Fatalf("nodes=%d links=%d: %+v", len(bp.Nodes), len(bp.Links), bp)
	}
	if bp.Nodes[1].Shape != "decision" || bp.Nodes[2].Shape != "database" || bp.Links[1].Label != "yes" || !bp.Links[2].Dashed {
		t.Errorf("unexpected mapping: %+v", bp)
	}
}

func TestFromMarkdownRefusesEmptyAndHuge(t *testing.T) {
	if _, err := FromMarkdown("just prose, nothing to draw"); err == nil {
		t.Error("prose without structure must be refused")
	}
	if _, err := FromMarkdown(strings.Repeat("x", MaxMarkdownBytes+1)); err == nil {
		t.Error("oversized input must be refused")
	}
}
