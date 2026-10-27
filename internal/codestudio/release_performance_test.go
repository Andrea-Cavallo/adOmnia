package codestudio

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Repeatable offline baseline. Fixture generation is outside the measured region.
// Measures backend project opening and full-tree search, not first painted editor or gopls.
func BenchmarkReleaseRepository(b *testing.B) {
	for _, count := range []int{10, 100, 1000} {
		b.Run(fmt.Sprintf("files_%d", count), func(b *testing.B) {
			root := b.TempDir()
			if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/perf\n\ngo 1.26\n"), 0600); err != nil {
				b.Fatal(err)
			}
			for i := range count {
				dir := filepath.Join(root, fmt.Sprintf("pkg%04d", i))
				if err := os.MkdirAll(dir, 0700); err != nil {
					b.Fatal(err)
				}
				content := "package fixture\n" + strings.Repeat("// Representative source padding.\n", 128) + "func ReleaseNeedle() {}\n"
				if err := os.WriteFile(filepath.Join(dir, "source.go"), []byte(content), 0600); err != nil {
					b.Fatal(err)
				}
			}
			b.Run("Open", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					service := NewService(&memoryStore{}, nil)
					if _, err := service.OpenProject(root); err != nil {
						b.Fatal(err)
					}
					service.Shutdown()
				}
			})
			service := NewService(&memoryStore{}, nil)
			defer service.Shutdown()
			session, err := service.OpenProject(root)
			if err != nil {
				b.Fatal(err)
			}
			b.Run("OpenFile", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					document, err := service.OpenDocument(string(session.ID), "pkg0000/source.go")
					if err != nil {
						b.Fatal(err)
					}
					if !strings.Contains(document.Content, "ReleaseNeedle") {
						b.Fatal("missing source content")
					}
				}
			})
			b.Run("Search", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					result, err := service.SearchProject(context.Background(), SearchQuery{SessionID: session.ID, Pattern: "ReleaseNeedle"})
					if err != nil {
						b.Fatal(err)
					}
					if len(result.Matches) != count {
						b.Fatalf("matches %d, want %d", len(result.Matches), count)
					}
				}
			})
		})
	}
}

// Cold measures the actual three offline Go commands; Warm includes file stamps
// and the facade/cache hit. No subprocess fixture generation is timed.
func BenchmarkDependencyGraph(b *testing.B) {
	root := b.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/depbench\n\ngo 1.26\n"), 0600); err != nil {
		b.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "source.go"), []byte("package depbench\nfunc Value() int { return 1 }\n"), 0600); err != nil {
		b.Fatal(err)
	}
	service := NewService(&memoryStore{}, nil)
	defer service.Shutdown()
	session, err := service.OpenProject(root)
	if err != nil {
		b.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		b.Fatal(err)
	}
	if _, err := service.DependencyGraph(string(session.ID), ""); err != nil {
		b.Fatal(err)
	}
	for _, mode := range []string{"Cold", "Warm"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if mode == "Cold" {
					service.depGraph.invalidateSession(session.ID)
				}
				result, err := service.DependencyGraph(string(session.ID), "")
				if err != nil {
					b.Fatal(err)
				}
				if result.ModulePath != "example.test/depbench" {
					b.Fatal("unexpected graph")
				}
			}
		})
	}
}
