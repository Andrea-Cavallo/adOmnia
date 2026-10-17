package codestudio

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// BenchmarkSearchProject misura la ricerca su un workspace grande (10.000 file × 200 righe):
// dato di riferimento per la valutazione Rust (mds/REFACTOR.md, voce 13).
func BenchmarkSearchProject(b *testing.B) {
	root := b.TempDir()
	line := strings.Repeat("x", 30) + " handler := newServer(config)\n"
	body := strings.Repeat(line, 200)
	for i := 0; i < 10_000; i++ {
		dir := filepath.Join(root, fmt.Sprintf("pkg%03d", i%100))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			b.Fatal(err)
		}
		content := body
		if i%2_500 == 0 {
			content += "needle_unique_token\n"
		}
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%05d.go", i)), []byte(content), 0o644); err != nil {
			b.Fatal(err)
		}
	}
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		b.Fatal(err)
	}
	for _, tc := range []struct{ name, pattern string }{{"rare", "needle_unique_token"}, {"common-capped", "newServer"}} {
		b.Run(tc.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				if _, err := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: tc.pattern}); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
