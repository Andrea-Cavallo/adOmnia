package diagrams

import (
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/flowintel"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

func goGraph() graph.Graph {
	return graph.Graph{
		Root: "/repo", Language: "go", Fingerprint: "fp-go",
		Nodes: []graph.Node{
			{ID: "mod:payments", Kind: graph.KindModule, Label: "payments"},
			{ID: "pkg:payments/service", Kind: graph.KindPackage, Label: "payments/service", Package: "payments/service", Attrs: map[string]string{"module": "mod:payments"}},
			{ID: "fn:payments/service.CreatePayment", Kind: graph.KindFunction, Label: "CreatePayment", Package: "payments/service", File: "service/payment.go", Line: 42},
			{ID: "fn:payments/service.ReserveFunds", Kind: graph.KindFunction, Label: "ReserveFunds", Package: "payments/service", File: "service/wallet.go", Line: 12},
			{ID: "http:POST /payments", Kind: graph.KindEndpoint, Label: "POST /payments", File: "service/http.go", Line: 9},
			{ID: "topic:payments.created", Kind: graph.KindTopic, Label: "payments.created"},
			{ID: "table:payments", Kind: graph.KindTable, Label: "payments"},
		},
		Edges: []graph.Edge{
			{From: "mod:payments", To: "pkg:payments/service", Kind: graph.EdgeContains},
			{From: "pkg:payments/service", To: "fn:payments/service.CreatePayment", Kind: graph.EdgeContains},
			{From: "pkg:payments/service", To: "fn:payments/service.ReserveFunds", Kind: graph.EdgeContains},
			{From: "fn:payments/service.CreatePayment", To: "http:POST /payments", Kind: graph.EdgeHandles},
			{From: "fn:payments/service.CreatePayment", To: "fn:payments/service.ReserveFunds", Kind: graph.EdgeCalls},
			{From: "fn:payments/service.CreatePayment", To: "topic:payments.created", Kind: graph.EdgeProduces, Detail: "kafka"},
			{From: "fn:payments/service.CreatePayment", To: "table:payments", Kind: graph.EdgeQueries, Detail: "INSERT"},
		},
	}
}

func flowDiscovery() *flowintel.Discovery {
	g := graph.Graph{
		Root: "/repo", Language: "flow", Fingerprint: "fp-flow",
		Nodes: []graph.Node{
			{ID: "bundle:com.acme.payments", Kind: graph.KindBundle, Label: "com.acme.payments", File: "META-INF/MANIFEST.MF"},
			{ID: "flow:paymentFlow", Kind: graph.KindFlow, Label: "PaymentFlow", File: "flows/payment.xml", Line: 3},
			{ID: "method:com.acme.Payment.execute", Kind: graph.KindMethod, Label: "Payment.execute", File: "src/Payment.java", Line: 20},
			{ID: "external:wallet://reserve", Kind: graph.KindExternal, Label: "wallet://reserve", Attrs: map[string]string{"bundle": "com.acme.payments"}},
		},
		Edges: []graph.Edge{
			{From: "bundle:com.acme.payments", To: "flow:paymentFlow", Kind: graph.EdgeContains, Confidence: graph.ConfidenceDerived},
			{From: "bundle:com.acme.payments", To: "method:com.acme.Payment.execute", Kind: graph.EdgeContains, Confidence: graph.ConfidenceDerived},
			{From: "flow:paymentFlow", To: "method:com.acme.Payment.execute", Kind: graph.EdgeInvokes, Confidence: graph.ConfidenceDeclared},
			{From: "method:com.acme.Payment.execute", To: "external:wallet://reserve", Kind: graph.EdgeCallsExt, Confidence: graph.ConfidenceInferred},
		},
	}
	return &flowintel.Discovery{Root: "/repo", Fingerprint: "fp-flow", Graph: g, Problems: []string{}}
}

func TestBuildWorkspaceNormalizesGoAndFlow(t *testing.T) {
	semantic := goGraph()
	analysis := BuildWorkspace(WorkspaceInput{Root: "/repo", Semantic: &semantic, Flows: flowDiscovery()})

	service, ok := analysis.FindEntity("mod:payments")
	if !ok || service.Kind != EntityService {
		t.Fatalf("Go module is not a service entity: %+v", service)
	}
	payment, ok := analysis.FindEntity("fn:payments/service.CreatePayment")
	if !ok {
		t.Fatal("CreatePayment missing")
	}
	if payment.Service != "mod:payments" || payment.File != "service/payment.go" || payment.Line != 42 {
		t.Fatalf("source ref or owner wrong: %+v", payment)
	}
	// Endpoints, topics and tables are reached by the handler: the service is attributed.
	for _, id := range []string{"http:POST /payments", "topic:payments.created", "table:payments"} {
		entity, found := analysis.FindEntity(id)
		if !found || entity.Service != "mod:payments" {
			t.Fatalf("%s not attributed to the service: %+v", id, entity)
		}
	}
	bundle, ok := analysis.FindEntity("bundle:com.acme.payments")
	if !ok || bundle.Kind != EntityService {
		t.Fatalf("OSGi bundle is not a service entity: %+v", bundle)
	}
	flow, ok := analysis.FindEntity("flow:paymentFlow")
	if !ok || flow.Service != "bundle:com.acme.payments" {
		t.Fatalf("flow not attributed to its bundle: %+v", flow)
	}
	if analysis.Stats[EntityService] != 2 {
		t.Fatalf("expected two services, got %v", analysis.Stats)
	}
	if len(analysis.Languages) != 2 {
		t.Fatalf("expected two languages, got %v", analysis.Languages)
	}
	if len(analysis.Links) == 0 {
		t.Fatal("links are missing")
	}
	for _, link := range analysis.Links {
		if link.Kind == graph.EdgeContains {
			t.Fatal("containment must not be a visible flow link")
		}
		if link.Confidence == "" {
			t.Fatalf("link without confidence: %+v", link)
		}
	}
}

func TestBuildWorkspaceKeepsConfidenceAndNeighborhood(t *testing.T) {
	semantic := goGraph()
	analysis := BuildWorkspace(WorkspaceInput{Root: "/repo", Semantic: &semantic})

	entities, links := analysis.Neighborhood("fn:payments/service.CreatePayment", nil)
	if len(entities) < 4 || len(links) < 4 {
		t.Fatalf("neighborhood incomplete: %d entities, %d links", len(entities), len(links))
	}
	called := map[string]bool{}
	for _, link := range links {
		if link.Kind == graph.EdgeCalls {
			called[link.To] = true
			if link.Confidence != graph.ConfidenceDerived {
				t.Fatalf("calls confidence = %q", link.Confidence)
			}
		}
	}
	if !called["fn:payments/service.ReserveFunds"] {
		t.Fatal("callee ReserveFunds missing from the neighborhood")
	}
}

func TestBuildWorkspaceWithoutAdaptersIsExplicit(t *testing.T) {
	analysis := BuildWorkspace(WorkspaceInput{Root: "/repo", Problems: []string{"no adapter ran"}})
	if len(analysis.Entities) != 0 || len(analysis.Links) != 0 {
		t.Fatal("an empty input must produce an empty analysis")
	}
	if len(analysis.Problems) != 1 {
		t.Fatal("the missing-adapter problem must be reported")
	}
}
