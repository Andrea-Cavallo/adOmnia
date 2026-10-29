package otlp

import (
	"context"
	"net"
	"os"
	"runtime"
	"strconv"
	"testing"
	"time"
)

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
			Attributes: attrs("messaging.system", "kafka", "messaging.destination.name", "orders.created", "messaging.consumer.group.name", "billing", "server.address", "127.0.0.1", "server.port", "59092")},
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
	if e, ok := edges["topic:orders.created→svc:billing"]; !ok || e.Group != "billing" || e.Brokers != "127.0.0.1:59092" {
		t.Fatalf("consumer edge: %+v", e)
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

func TestAnnotateConnections(t *testing.T) {
	store := NewStore(100)
	store.Add([]Span{
		{TraceID: "t", SpanID: "g1", Service: "gateway", Kind: "server", Category: "http", PID: 10, Attributes: map[string]string{"server.port": "8080"}},
		{TraceID: "t", SpanID: "g2", ParentSpanID: "g1", Service: "gateway", Kind: "client", Category: "http"},
		{TraceID: "t", SpanID: "o1", ParentSpanID: "g2", Service: "orders", Kind: "server", Category: "http", Attributes: map[string]string{"server.port": "9090"}},
		{TraceID: "t", SpanID: "o2", ParentSpanID: "o1", Service: "orders", Kind: "client", Category: "db", Attributes: map[string]string{"db.system": "postgresql", "server.port": "5432"}},
		{TraceID: "t", SpanID: "b1", ParentSpanID: "o1", Service: "billing", Kind: "consumer", Category: "messaging", PID: 30, Attributes: map[string]string{"messaging.system": "kafka", "messaging.destination.name": "orders", "server.port": "59092"}},
	})
	m := store.ServiceMap()
	// orders has no process.pid: found through the owner of its port 9090.
	AnnotateConnections(&m, []Conn{{10, 9090}, {10, 9090}, {10, 443}, {20, 5432}, {20, 5432}, {20, 5432}, {30, 59092}}, []Listener{{9090, 20}, {8080, 10}})
	nodes := map[string]MapNode{}
	for _, node := range m.Nodes {
		nodes[node.ID] = node
	}
	if nodes["svc:orders"].PID != 20 || nodes["svc:orders"].Connections != 3 || nodes["svc:gateway"].Connections != 3 {
		t.Fatalf("nodes: %+v", nodes)
	}
	got := map[string]int{}
	for _, edge := range m.Edges {
		got[edge.From+">"+edge.To] = edge.ActiveConnections
	}
	if got["svc:gateway>svc:orders"] != 2 || got["svc:orders>db:postgresql"] != 3 || got["topic:orders>svc:billing"] != 1 || !m.ConnectionsMeasured {
		t.Fatalf("edges: %v", got)
	}
}

// Real sockets: this test process is the "orders" service (port fallback, no process.pid).
func TestAnnotateConnectionsWithRealSockets(t *testing.T) {
	server, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	db, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	accepted := make(chan net.Conn, 2)
	go func() {
		defer close(accepted)
		for range 2 {
			connection, err := db.Accept()
			if err != nil {
				return
			}
			accepted <- connection
		}
	}()
	for range 2 {
		c, err := net.Dial("tcp", db.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
	}
	// Keep both server ends alive: discarding Accept's result allowed the GC
	// finalizer to close sockets before liveSockets took its snapshot.
	for range 2 {
		select {
		case connection, ok := <-accepted:
			if !ok {
				t.Fatal("accept failed before both connections were established")
			}
			defer connection.Close()
		case <-time.After(5 * time.Second):
			t.Fatal("timed out accepting test connections")
		}
	}
	serverPort, dbPort := strconv.Itoa(server.Addr().(*net.TCPAddr).Port), strconv.Itoa(db.Addr().(*net.TCPAddr).Port)
	runtime.GC() // accepted connections must remain live even across collection
	store := NewStore(10)
	store.Add([]Span{
		{TraceID: "t", SpanID: "s", Service: "orders", Kind: "server", Category: "http", Attributes: map[string]string{"server.port": serverPort}},
		{TraceID: "t", SpanID: "q", ParentSpanID: "s", Service: "orders", Kind: "client", Category: "db", Attributes: map[string]string{"db.system": "postgresql", "server.port": dbPort}},
	})
	deadline := time.Now().Add(3 * time.Second)
	for {
		// TCP state publication can lag Accept on Windows. Sample fresh sockets
		// until both accepted connections are observable, without reusing the cache.
		sockets.Lock()
		sockets.at = time.Time{}
		sockets.Unlock()
		conns, listeners, ok := liveSockets(context.Background())
		if !ok {
			if runtime.GOOS != "windows" {
				t.Skip("no socket listing tool")
			}
			t.Fatal("cannot read local TCP sockets")
		}
		m := store.ServiceMap()
		AnnotateConnections(&m, conns, listeners)
		ownPID := false
		for _, node := range m.Nodes {
			if node.ID == "svc:orders" {
				ownPID = node.PID == os.Getpid()
			}
		}
		if ownPID && len(m.Edges) == 1 && m.Edges[0].ActiveConnections == 2 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("TCP snapshot did not resolve the service PID and two connections: %+v", m)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
