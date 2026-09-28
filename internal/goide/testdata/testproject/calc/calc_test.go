package calc

import (
	"os"
	"testing"
	"time"
)

func TestAdd(t *testing.T) {
	t.Run("positive", func(t *testing.T) {
		if Add(1, 2) != 3 {
			t.Fatal("bad")
		}
	})
	t.Run("negative", func(t *testing.T) {
		if Add(-1, -2) != -4 {
			t.Errorf("got %d", Add(-1, -2))
		}
	})
}

func TestSign(t *testing.T) {
	if Sign(5) != 1 {
		t.Fatal("bad sign")
	}
}

func TestHang(t *testing.T) {
	if os.Getenv("GOIDE_HANG") == "" {
		t.Skip("solo per il test di stop")
	}
	time.Sleep(time.Minute)
}

func BenchmarkAdd(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Add(i, i)
	}
}
