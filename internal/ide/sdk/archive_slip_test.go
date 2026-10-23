package sdk

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"testing"
)

// hostileNames are entry names a malicious archive uses to write outside the destination.
var hostileNames = []string{"../evil.txt", "a/../../evil.txt", "/abs-evil.txt", "..\\evil.txt"}

func writeZip(t *testing.T, path string, names ...string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	writer := zip.NewWriter(file)
	for _, name := range names {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = entry.Write([]byte("pwned"))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeTarGz(t *testing.T, path string, names ...string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz := gzip.NewWriter(file)
	archive := tar.NewWriter(gz)
	for _, name := range names {
		if err := archive.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: 5}); err != nil {
			t.Fatal(err)
		}
		_, _ = archive.Write([]byte("pwned"))
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestExtractArchiveRejectsEntriesOutsideTheDestination(t *testing.T) {
	for _, name := range hostileNames {
		for _, format := range []string{"zip", "tar.gz"} {
			t.Run(format+" "+name, func(t *testing.T) {
				base := t.TempDir()
				destination := filepath.Join(base, "dest")
				archive := filepath.Join(base, "bad."+format)
				if format == "zip" {
					writeZip(t, archive, name)
				} else {
					writeTarGz(t, archive, name)
				}
				if err := ExtractArchive(context.Background(), "bad", archive, destination, 1<<20); err == nil {
					t.Fatal("a hostile entry name must be refused")
				}
				for _, escaped := range []string{filepath.Join(base, "evil.txt"), filepath.Join(filepath.VolumeName(base)+string(os.PathSeparator), "abs-evil.txt")} {
					if _, err := os.Stat(escaped); err == nil {
						t.Fatalf("%s was written outside the destination", escaped)
					}
				}
			})
		}
	}
}

func TestExtractArchiveKeepsNestedEntries(t *testing.T) {
	base := t.TempDir()
	destination := filepath.Join(base, "dest")
	archive := filepath.Join(base, "ok.zip")
	writeZip(t, archive, "go/bin/go.exe", "go/VERSION")
	if err := ExtractArchive(context.Background(), "ok", archive, destination, 1<<20); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(destination, "go", "bin", "go.exe")); err != nil {
		t.Fatalf("a regular nested entry must be extracted: %v", err)
	}
}
