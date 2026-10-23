package update

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func writePackage(t *testing.T, path string, names ...string) {
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

func TestExtractPackageRejectsEntriesOutsideTheStage(t *testing.T) {
	for _, name := range []string{"../evil.txt", "a/../../evil.txt", "/abs-evil.txt", "..\\evil.txt", "C:/evil.txt"} {
		base := t.TempDir()
		stage := filepath.Join(base, "stage")
		if err := os.MkdirAll(stage, 0o700); err != nil {
			t.Fatal(err)
		}
		archive := filepath.Join(base, "bad.zip")
		writePackage(t, archive, name)
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
	writePackage(t, archive, "adomnia/app.exe")
	if err := extractPackage(archive, stage); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(stage, "adomnia", "app.exe")); err != nil {
		t.Fatalf("a regular entry must be extracted: %v", err)
	}
}
