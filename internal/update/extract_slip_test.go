package update

import (
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/archivetest"
)

func TestExtractPackageRejectsEntriesOutsideTheStage(t *testing.T) {
	for _, name := range archivetest.HostileNames {
		base := t.TempDir()
		stage := filepath.Join(base, "stage")
		if err := os.MkdirAll(stage, 0o700); err != nil {
			t.Fatal(err)
		}
		archive := filepath.Join(base, "bad.zip")
		archivetest.WriteZip(t, archive, name)
		if err := extractPackage(archive, stage); err == nil {
			t.Fatalf("%q must be refused", name)
		}
		if _, err := os.Stat(filepath.Join(base, "evil.txt")); err == nil {
			t.Fatalf("%q was written outside the stage", name)
		}
	}
}

func TestExtractPackageExtractsRegularEntries(t *testing.T) {
	base := t.TempDir()
	stage := filepath.Join(base, "stage")
	if err := os.MkdirAll(stage, 0o700); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(base, "ok.zip")
	archivetest.WriteZip(t, archive, "adomnia/app.exe")
	if err := extractPackage(archive, stage); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(stage, "adomnia", "app.exe")); err != nil {
		t.Fatalf("a regular entry must be extracted: %v", err)
	}
}
