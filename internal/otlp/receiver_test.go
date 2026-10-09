package otlp

import (
	"bytes"
	"context"
	"net/http"
	"testing"
	"time"

	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
)

func str(key, value string) *commonpb.KeyValue {
	return &commonpb.KeyValue{Key: key, Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: value}}}
}

func exportRequest(service string, traceID byte, spans ...*tracepb.Span) *coltracepb.ExportTraceServiceRequest {
	for _, span := range spans {
		span.TraceId = bytes.Repeat([]byte{traceID}, 16)
	}
	return &coltracepb.ExportTraceServiceRequest{ResourceSpans: []*tracepb.ResourceSpans{{
		Resource:   &resourcepb.Resource{Attributes: []*commonpb.KeyValue{str("service.name", service)}},
		ScopeSpans: []*tracepb.ScopeSpans{{Spans: spans}},
	}}}
}

func startTestReceiver(t *testing.T) *Receiver {
	t.Helper()
	r := NewReceiver()
	if err := r.Start(0, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Stop)
	return r
}

func TestReceiverAcceptsOTLPJSON(t *testing.T) {
	r := startTestReceiver(t)
	body := `{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"orders"}}]},
	 "scopeSpans":[{"spans":[
	  {"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b174","name":"GET /orders/{id}","kind":2,
	   "startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000000012000000",
	   "attributes":[{"key":"http.request.method","value":{"stringValue":"GET"}},{"key":"http.response.status_code","value":{"intValue":"200"}}]},
	  {"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b175","parentSpanId":"eee19b7ec3c1b174","name":"SELECT orders","kind":3,
	   "startTimeUnixNano":"1700000000002000000","endTimeUnixNano":"1700000000009000000",
	   "status":{"code":2,"message":"timeout"},
	   "attributes":[{"key":"db.system","value":{"stringValue":"postgresql"}},{"key":"code.filepath","value":{"stringValue":"/src/store/orders.go"}},{"key":"code.lineno","value":{"intValue":"42"}}]}
	 ]}]}]}`
	response, err := http.Post("http://"+r.Status().HTTPAddr+"/v1/traces", "application/json", bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status %d", response.StatusCode)
	}
	spans := r.Store().Trace("5b8efff798038103d269b633813fc60c")
	if len(spans) != 2 {
		t.Fatalf("spans: %+v", spans)
	}
	root, db := spans[0], spans[1]
	if root.Service != "orders" || root.Kind != "server" || root.Category != "http" || root.DurationMs != 12 || root.Attributes["http.response.status_code"] != "200" {
		t.Fatalf("root: %+v", root)
	}
	if db.ParentSpanID != root.SpanID || db.Category != "db" || db.StatusCode != "ERROR" || db.StatusMessage != "timeout" || db.Attributes["code.lineno"] != "42" {
		t.Fatalf("db: %+v", db)
	}
	summaries := r.Store().Summaries(10)
	if len(summaries) != 1 || summaries[0].Root != "orders GET /orders/{id}" || summaries[0].Errors != 1 || summaries[0].Spans != 2 {
		t.Fatalf("summary: %+v", summaries)
	}
}

func TestReceiverAcceptsProtobufAndGRPC(t *testing.T) {
	r := startTestReceiver(t)
	now := uint64(time.Now().UnixNano())
	payload, _ := proto.Marshal(exportRequest("billing", 1, &tracepb.Span{SpanId: []byte{1, 2, 3, 4, 5, 6, 7, 8}, Name: "charge", StartTimeUnixNano: now, EndTimeUnixNano: now + 5e6,
		Attributes: []*commonpb.KeyValue{str("messaging.system", "kafka")}}))
	response, err := http.Post("http://"+r.Status().HTTPAddr+"/v1/traces", "application/x-protobuf", bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()

	conn, err := grpc.NewClient(r.Status().GRPCAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := coltracepb.NewTraceServiceClient(conn).Export(ctx, exportRequest("gateway", 2, &tracepb.Span{SpanId: []byte{9, 9, 9, 9, 9, 9, 9, 9}, Name: "/orders.v1.Orders/Get",
		Attributes: []*commonpb.KeyValue{str("rpc.system", "grpc")}})); err != nil {
		t.Fatal(err)
	}
	categories := map[string]string{}
	for _, summary := range r.Store().Summaries(10) {
		for _, span := range r.Store().Trace(summary.TraceID) {
			categories[span.Service] = span.Category
		}
	}
	if categories["billing"] != "messaging" || categories["gateway"] != "rpc" {
		t.Fatalf("categories: %v", categories)
	}
}

func TestStoreEvictsOldestTraces(t *testing.T) {
	store := NewStore(3)
	store.Add([]Span{{TraceID: "a", SpanID: "1"}, {TraceID: "a", SpanID: "2"}})
	store.Add([]Span{{TraceID: "b", SpanID: "3"}, {TraceID: "b", SpanID: "4"}})
	if traces, spans := store.Counts(); traces != 1 || spans != 2 || len(store.Trace("a")) != 0 {
		t.Fatalf("traces=%d spans=%d", traces, spans)
	}
}

func TestReceiverRefusesBusyPort(t *testing.T) {
	first := startTestReceiver(t)
	port := first.Status().HTTPAddr[len("127.0.0.1:"):]
	second := NewReceiver()
	var busy int
	for _, ch := range port {
		busy = busy*10 + int(ch-'0')
	}
	if err := second.Start(busy, -1); err == nil {
		second.Stop()
		t.Fatal("second receiver bound a busy port")
	}
	if second.Status().Running || second.Status().Error == "" {
		t.Fatalf("status: %+v", second.Status())
	}
}
