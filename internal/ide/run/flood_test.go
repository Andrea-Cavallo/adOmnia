package run

import (
	"bytes"
	"testing"
)

func TestEnqueueKeepsTheNewestOutputOfAFlood(t *testing.T) {
	w := &outputWriter{}
	for i := range 100 {
		w.enqueue(bytes.Repeat([]byte{byte('a' + i%26)}, 32*1024))
	}
	w.timer.Stop()
	if len(w.pending) != maxOutputBytesPerFlush || !w.dropped {
		t.Fatalf("pending = %d, dropped = %v", len(w.pending), w.dropped)
	}
	if last := byte('a' + 99%26); w.pending[len(w.pending)-1] != last {
		t.Fatalf("the tail must be the newest output, got %q", w.pending[len(w.pending)-1])
	}
}
