package kafka

import (
	"sync"
	"sync/atomic"
	"testing"
)

func TestReserveKafkaMessageIndexStopsExactlyAtLimit(t *testing.T) {
	const (
		total   = 1000
		workers = 32
	)

	var sequence atomic.Int64
	indices := make(chan int, total)
	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				idx, ok := reserveKafkaMessageIndex(&sequence, total)
				if !ok {
					return
				}
				indices <- idx
			}
		}()
	}
	wg.Wait()
	close(indices)

	seen := make(map[int]bool, total)
	for idx := range indices {
		if idx < 0 || idx >= total {
			t.Fatalf("reserved out-of-range message index %d", idx)
		}
		if seen[idx] {
			t.Fatalf("reserved duplicate message index %d", idx)
		}
		seen[idx] = true
	}

	if len(seen) != total {
		t.Fatalf("reserved %d messages, want %d", len(seen), total)
	}
	if got := sequence.Load(); got != total {
		t.Fatalf("sequence advanced to %d, want exactly %d", got, total)
	}
}
