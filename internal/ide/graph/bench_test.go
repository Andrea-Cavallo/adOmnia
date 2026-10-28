package graph

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func BenchmarkWorkspaceFingerprint(b *testing.B) {
	for _, files := range []int{10, 1000} {
		b.Run(fmt.Sprintf("files_%d", files), func(b *testing.B) {
			root := b.TempDir()
			for i := range files {
				if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("source%04d.go", i)), []byte("package fixture\n"), 0600); err != nil {
					b.Fatal(err)
				}
			}
			match := func(rel string) bool { return strings.HasSuffix(rel, ".go") }
			baseline, err := Fingerprint(root, match)
			if err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			for b.Loop() {
				fingerprint, err := Fingerprint(root, match)
				if err != nil || fingerprint != baseline {
					b.Fatalf("unstable fingerprint: %v", err)
				}
			}
		})
	}
}
