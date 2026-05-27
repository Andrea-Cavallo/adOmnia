package themes

import "testing"

func TestThemeStopWatchingIsIdempotent(t *testing.T) {
	tm := NewThemeManager()
	_ = tm.StopWatching()
	if err := tm.StartWatching(); err != nil {
		t.Fatalf("start watching: %v", err)
	}
	if err := tm.StopWatching(); err != nil {
		t.Fatalf("first stop should succeed: %v", err)
	}
	if err := tm.StopWatching(); err != nil {
		t.Fatalf("second stop should be idempotent: %v", err)
	}
}
