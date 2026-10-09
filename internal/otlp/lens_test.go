package otlp

import (
	"strconv"
	"testing"
)

func TestLensAggregatesBySourceLocation(t *testing.T) {
	store := NewStore(1000)
	var spans []Span
	for i := 1; i <= 100; i++ {
		status := "OK"
		if i%25 == 0 {
			status = "ERROR"
		}
		spans = append(spans, Span{TraceID: strconv.Itoa(i), SpanID: "a", Name: "SELECT orders", StartMs: float64(i * 10), DurationMs: float64(i), StatusCode: status, Category: "db",
			Attributes: map[string]string{"code.filepath": "/src/store.go", "code.lineno": "42", "code.function": "store.Find"}})
	}
	spans = append(spans, Span{TraceID: "x", SpanID: "b", Name: "no code"})
	spans = append(spans, Span{TraceID: "y", SpanID: "c", Name: "stable names", DurationMs: 3, Attributes: map[string]string{"code.file.path": "/src/api.go", "code.line.number": "7"}})
	store.Add(spans)

	lens := store.Lens()
	if len(lens) != 2 {
		t.Fatalf("lens: %+v", lens)
	}
	api, find := lens[0], lens[1]
	if api.File != "/src/api.go" || api.Line != 7 || api.Count != 1 || api.P99Ms != 3 {
		t.Fatalf("api: %+v", api)
	}
	if find.Count != 100 || find.Errors != 4 || find.P50Ms != 50 || find.P95Ms != 95 || find.P99Ms != 99 || find.MaxMs != 100 || find.AvgMs != 50.5 || find.LastMs != 1100 || find.Function != "store.Find" {
		t.Fatalf("find: %+v", find)
	}
}
