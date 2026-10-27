package flight

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDoSharesOneRunPerKey(t *testing.T) {
	var group Group[int]
	var runs atomic.Int32
	release := make(chan struct{})
	var wg sync.WaitGroup
	results := make([]int, 5)
	for i := range results {
		wg.Go(func() {
			results[i], _ = group.Do("k", func() (int, error) {
				runs.Add(1)
				<-release
				return 42, nil
			})
		})
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	if runs.Load() != 1 {
		t.Fatalf("fn eseguita %d volte, attesa 1", runs.Load())
	}
	for _, value := range results {
		if value != 42 {
			t.Fatalf("risultato condiviso errato: %v", results)
		}
	}
	if value, _ := group.Do("k", func() (int, error) { return 7, nil }); value != 7 {
		t.Fatal("la chiave deve liberarsi a fine chiamata")
	}
}
