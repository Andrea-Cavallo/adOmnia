package otlp

import "testing"

func TestServiceMapFromTraces(t *testing.T) {
	store := NewStore(1000)
	attrs := func(kv ...string) map[string]string {
		out := map[string]string{}
		for i := 0; i+1 < len(kv); i += 2 {
			out[kv[i]] = kv[i+1]
		}
		return out
	}
	store.Add([]Span{
		// gateway → orders over HTTP (client span answered by a server span of another service)
		{TraceID: "t1", SpanID: "g1", Service: "gateway", Kind: "server", Category: "http", Name: "GET /api/orders", StartMs: 0, DurationMs: 50},
		{TraceID: "t1", SpanID: "g2", ParentSpanID: "g1", Service: "gateway", Kind: "client", Category: "http", Name: "GET", StartMs: 1, DurationMs: 40,
			Attributes: attrs("http.request.method", "GET", "code.filepath", "/src/gw/client.go", "code.lineno", "17")},
		{TraceID: "t1", SpanID: "o1", ParentSpanID: "g2", Service: "orders", Kind: "server", Category: "http", Name: "GET /orders", StartMs: 2, DurationMs: 35,
			Attributes: attrs("code.filepath", "/src/orders/handler.go", "code.lineno", "42")},
		{TraceID: "t1", SpanID: "o2", ParentSpanID: "o1", Service: "orders", Kind: "client", Category: "db", Name: "SELECT", StartMs: 3, DurationMs: 20, StatusCode: "ERROR",
			Attributes: attrs("db.system", "postgresql", "db.name", "shop")},
		{TraceID: "t1", SpanID: "o3", ParentSpanID: "o1", Service: "orders", Kind: "producer", Category: "messaging", Name: "publish", StartMs: 25, DurationMs: 2,
			Attributes: attrs("messaging.system", "kafka", "messaging.destination.name", "orders.created")},
		{TraceID: "t1", SpanID: "b1", ParentSpanID: "o3", Service: "billing", Kind: "consumer", Category: "messaging", Name: "process", StartMs: 30, DurationMs: 5,
			Attributes: attrs("messaging.system", "kafka", "messaging.destination.name", "orders.created")},
		// an outgoing call nobody answered: external endpoint
		{TraceID: "t1", SpanID: "b2", ParentSpanID: "b1", Service: "billing", Kind: "client", Category: "http", Name: "POST", StartMs: 31, DurationMs: 3,
			Attributes: attrs("http.request.method", "POST", "url.full", "https://api.stripe.com/v1/charges")},
	})
	m := store.ServiceMap()
	kinds := map[string]string{}
	for _, node := range m.Nodes {
		kinds[node.ID] = node.Kind
	}
	want := map[string]string{"svc:gateway": "service", "svc:orders": "service", "svc:billing": "service", "db:postgresql · shop": "database", "topic:orders.created": "topic", "ext:api.stripe.com": "external"}
	for id, kind := range want {
		if kinds[id] != kind {
			t.Fatalf("node %s = %q; nodes %v", id, kinds[id], kinds)
		}
	}
	edges := map[string]MapEdge{}
	for _, edge := range m.Edges {
		edges[edge.From+"→"+edge.To] = edge
	}
	if e := edges["svc:gateway→svc:orders"]; e.Kind != "http" || e.Calls != 1 || e.P95Ms != 40 || e.SourceFile != "/src/gw/client.go" || e.SourceLine != 17 || e.HandlerFile != "/src/orders/handler.go" || e.HandlerLine != 42 {
		t.Fatalf("gateway→orders: %+v", e)
	}
	if e := edges["svc:orders→db:postgresql · shop"]; e.Errors != 1 || e.ErrorTraceID != "t1" {
		t.Fatalf("orders→db: %+v", e)
	}
	if _, ok := edges["svc:orders→topic:orders.created"]; !ok {
		t.Fatalf("producer edge missing: %v", edges)
	}
	if _, ok := edges["topic:orders.created→svc:billing"]; !ok {
		t.Fatalf("consumer edge missing: %v", edges)
	}
	if _, ok := edges["svc:billing→ext:api.stripe.com"]; !ok {
		t.Fatalf("external edge missing: %v", edges)
	}
	if len(m.Edges) != 5 {
		t.Fatalf("edges: %+v", m.Edges)
	}
}

func TestRetryIDs(t *testing.T) {
	spans := []Span{
		{SpanID: "p", Kind: "server", Name: "GET /x"},
		{SpanID: "a2", ParentSpanID: "p", Kind: "client", Name: "GET", StartMs: 20},
		{SpanID: "a1", ParentSpanID: "p", Kind: "client", Name: "GET", StartMs: 10},
		{SpanID: "a3", ParentSpanID: "p", Kind: "client", Name: "GET", StartMs: 30},
		{SpanID: "db", ParentSpanID: "p", Kind: "client", Name: "SELECT", StartMs: 5},
		{SpanID: "r", ParentSpanID: "q", Kind: "client", Name: "POST", Attributes: map[string]string{"http.request.resend_count": "1"}},
	}
	got := retryIDs(spans)
	if len(got) != 3 || !got["a2"] || !got["a3"] || !got["r"] {
		t.Fatalf("retries: %v", got)
	}
}
