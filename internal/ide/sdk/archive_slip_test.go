package sdk

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/archivetest"
)

func TestExtractArchiveRejectsEntriesOutsideTheDestination(t *testing.T) {
	for _, name := range archivetest.HostileNames {
		for _, format := range []string{"zip", "tar.gz"} {
			t.Run(format+" "+name, func(t *testing.T) {
				base := t.TempDir()
				destination := filepath.Join(base, "dest")
				archive := filepath.Join(base, "bad."+format)
				if format == "zip" {
					archivetest.WriteZip(t, archive, name)
				} else {
					archivetest.WriteTarGz(t, archive, name)
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
	archivetest.WriteZip(t, archive, "go/bin/go.exe", "go/VERSION")
	if err := ExtractArchive(context.Background(), "ok", archive, destination, 1<<20); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(destination, "go", "bin", "go.exe")); err != nil {
		t.Fatalf("a regular nested entry must be extracted: %v", err)
	}
}
