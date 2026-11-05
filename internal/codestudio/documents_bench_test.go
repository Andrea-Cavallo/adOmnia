package codestudio

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// benchmarkDirectory creates a directory with `files` files and `dirs` subdirectories, the shape of a
// workspace folder (an OSGi plugins folder is mostly directories, a source folder mostly files).
func benchmarkDirectory(b *testing.B, files, dirs int) string {
	b.Helper()
	root := b.TempDir()
	for index := range dirs {
		if err := os.MkdirAll(filepath.Join(root, fmt.Sprintf("dir%04d", index)), 0o755); err != nil {
			b.Fatal(err)
		}
	}
	for index := range files {
		name := filepath.Join(root, fmt.Sprintf("File%05d.java", index))
		if err := os.WriteFile(name, []byte("package p\n"), 0o644); err != nil {
			b.Fatal(err)
		}
	}
	return root
}

// BenchmarkListDirectory measures one folder expansion as the Project Explorer performs it: read the
// folder, filter it, collect metadata and sort directories first, case-insensitively.
func BenchmarkListDirectory(b *testing.B) {
	for _, size := range []int{100, 1_000, 10_000, 50_000} {
		b.Run(fmt.Sprintf("files_%d", size), func(b *testing.B) {
			root := benchmarkDirectory(b, size, 10)
			manager := NewDocumentManager()
			project := Project{RealPath: root}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				if _, err := manager.ListDirectory(project, "", false); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkListDirectoryNested is the same listing inside a subfolder, where the relative path of
// every child has to be built (the OSGi case: plugins/<bundle>/src/...).
func BenchmarkListDirectoryNested(b *testing.B) {
	root := benchmarkDirectory(b, 1_000, 1)
	sub := filepath.Join(root, "dir0000")
	for index := range 1_000 {
		if err := os.WriteFile(filepath.Join(sub, fmt.Sprintf("Nested%05d.java", index)), []byte("package p\n"), 0o644); err != nil {
			b.Fatal(err)
		}
	}
	manager := NewDocumentManager()
	project := Project{RealPath: root}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := manager.ListDirectory(project, "dir0000", false); err != nil {
			b.Fatal(err)
		}
	}
}

// listDirectoryBaseline is the previous implementation, kept only to measure the change on the same
// machine and dataset: os.ReadDir of the whole folder, one filepath.Rel per entry and a lowercase
// copy per sort comparison.
func listDirectoryBaseline(root string, limit int) ([]FileEntry, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	ignore := project.LoadGitIgnore(root)
	result := make([]FileEntry, 0, min(len(entries), limit))
	for _, entry := range entries {
		if len(result) >= limit {
			break
		}
		path := filepath.Join(root, entry.Name())
		ignored := (entry.IsDir() && skipWalkDirectory(path, entry.Name())) || gitIgnored(ignore, root, path, entry.IsDir())
		if ignored && entry.IsDir() {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			continue
		}
		result = append(result, FileEntry{Name: entry.Name(), RelativePath: filepath.ToSlash(rel), Directory: entry.IsDir(), Ignored: ignored, Size: info.Size(), ModifiedAt: info.ModTime().UTC(), Language: languageForPath(entry.Name())})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Directory != result[j].Directory {
			return result[i].Directory
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	return result, nil
}

func BenchmarkListDirectoryBaseline(b *testing.B) {
	for _, size := range []int{100, 1_000, 10_000, 50_000} {
		b.Run(fmt.Sprintf("files_%d", size), func(b *testing.B) {
			root := benchmarkDirectory(b, size, 10)
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				if _, err := listDirectoryBaseline(root, MaxDirectoryItems); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
