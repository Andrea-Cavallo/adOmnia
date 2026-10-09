package otlp

import "testing"

func TestImportKeepsLoadedTraces(t *testing.T) {
	store := NewStore(100)
	saved := []Span{{TraceID: "t1", SpanID: "a"}, {TraceID: "t1", SpanID: "b"}, {TraceID: "", SpanID: "x"}}
	if added := store.Import(saved); added != 2 {
		t.Fatalf("added %d", added)
	}
	if added := store.Import(saved); added != 0 {
		t.Fatalf("second load duplicated %d spans", added)
	}
	if traces, spans := store.Counts(); traces != 1 || spans != 2 {
		t.Fatalf("store: %d traces %d spans", traces, spans)
	}
}
