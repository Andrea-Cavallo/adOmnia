package codestudio

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// BenchmarkSearchEngines compares the Go engine with ripgrep on the same tree. Run with:
//
//	go test ./internal/codestudio -run '^$' -bench BenchmarkSearchEngines -benchtime 3x -benchmem
func BenchmarkSearchEngines(b *testing.B) {
	root := b.TempDir()
	for file := range 12000 {
		var builder strings.Builder
		for line := range 60 {
			if line%37 == 0 {
				fmt.Fprintf(&builder, "func handler%d() { return configValue(%d) }\n", line, line)
				continue
			}
			fmt.Fprintf(&builder, "// filler line %d for the benchmark tree\n", line)
		}
		path := filepath.Join(root, "pkg", fmt.Sprintf("file%03d.go", file))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			b.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(builder.String()), 0o644); err != nil {
			b.Fatal(err)
		}
	}
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		b.Fatal(err)
	}
	query := SearchQuery{SessionID: session.ID, Pattern: "configValue"}
	matcher, err := compileSearch(query)
	if err != nil {
		b.Fatal(err)
	}
	b.Run("go-engine", func(b *testing.B) {
		for range b.N {
			if _, err := service.searchProjectWalk(context.Background(), session, query, matcher); err != nil {
				b.Fatal(err)
			}
		}
	})
	if binary, ok := RipgrepBinary(service.toolsRoot); ok {
		b.Run("ripgrep", func(b *testing.B) {
			for range b.N {
				if _, err := service.searchWithRipgrep(context.Background(), binary, root, query); err != nil {
					b.Fatal(err)
				}
			}
		})
		b.Run("ripgrep-stream", func(b *testing.B) {
			for range b.N {
				if err := service.ripgrepStream(context.Background(), binary, root, query, streamBatchSize, false, func([]SearchMatch, int, bool) bool { return true }); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
