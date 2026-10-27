package archivetest

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteZipRoundTripsEveryEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "archive.zip")
	names := []string{"go/bin/go.exe", "go/VERSION", "C:/evil.txt"}
	WriteZip(t, path, names...)

	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("the builder wrote an unreadable zip: %v", err)
	}
	defer reader.Close()
	if len(reader.File) != len(names) {
		t.Fatalf("entries = %d, want %d", len(reader.File), len(names))
	}
	contents := make(map[string]string, len(reader.File))
	for _, entry := range reader.File {
		file, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(file)
		file.Close()
		if err != nil {
			t.Fatal(err)
		}
		contents[entry.Name] = string(body)
	}
	for _, name := range names {
		if contents[name] != payload {
			t.Fatalf("entry %q has %q, want %q", name, contents[name], payload)
		}
	}
}

func TestWriteTarGzRoundTripsEveryEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "archive.tar.gz")
	names := []string{"go/bin/go", "go/VERSION", "C:/evil.txt"}
	WriteTarGz(t, path, names...)

	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		t.Fatalf("the builder wrote unreadable gzip: %v", err)
	}
	defer gz.Close()

	archive := tar.NewReader(gz)
	contents := make(map[string]string, len(names))
	for {
		header, err := archive.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("the builder wrote an unreadable tar: %v", err)
		}
		if header.Typeflag != tar.TypeReg {
			t.Fatalf("entry %q typeflag = %c, want a regular file", header.Name, header.Typeflag)
		}
		if header.Mode&0o777 != 0o644 {
			t.Fatalf("entry %q mode = %o, want 644", header.Name, header.Mode&0o777)
		}
		body, err := io.ReadAll(archive)
		if err != nil {
			t.Fatal(err)
		}
		contents[header.Name] = string(body)
	}
	for _, name := range names {
		if contents[name] != payload {
			t.Fatalf("entry %q has %q, want %q", name, contents[name], payload)
		}
	}
}

func TestWritersKeepHostileNamesUnchanged(t *testing.T) {
	if len(HostileNames) == 0 {
		t.Fatal("HostileNames is empty: the extractors would lose their escape cases")
	}
	for index, name := range HostileNames {
		t.Run(fmt.Sprintf("%d", index), func(t *testing.T) {
			base := t.TempDir()
			zipPath := filepath.Join(base, "hostile.zip")
			WriteZip(t, zipPath, name)
			reader, err := zip.OpenReader(zipPath)
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			if len(reader.File) != 1 || reader.File[0].Name != name {
				t.Fatalf("zip entry = %+v, want %q", reader.File, name)
			}

			tarPath := filepath.Join(base, "hostile.tar.gz")
			WriteTarGz(t, tarPath, name)
			file, err := os.Open(tarPath)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			gz, err := gzip.NewReader(file)
			if err != nil {
				t.Fatal(err)
			}
			defer gz.Close()
			header, err := tar.NewReader(gz).Next()
			if err != nil {
				t.Fatal(err)
			}
			if header.Name != name {
				t.Fatalf("tar entry = %q, want %q", header.Name, name)
			}
		})
	}
}

// The zip reader must refuse a truncated archive: an extractor cannot trust a partial download.
func TestWrittenZipIsRejectedWhenTruncated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.zip")
	WriteZip(t, path, "go/VERSION")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data[:len(data)/2], 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := zip.OpenReader(path); err == nil {
		t.Fatal("a truncated zip opened successfully")
	}
}

func TestWrittenTarGzIsRejectedWhenCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.tar.gz")
	WriteTarGz(t, path, "go/VERSION")
	if err := os.WriteFile(path, []byte("not a gzip stream"), 0o644); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := gzip.NewReader(file); err == nil {
		t.Fatal("a corrupt tar.gz opened successfully")
	}
}

// Restores the archive the way the extractors do, into an empty temporary directory.
func TestWrittenArchivesRestoreIntoEmptyDirectory(t *testing.T) {
	names := []string{"go/bin/go", "go/VERSION"}
	base := t.TempDir()
	zipPath := filepath.Join(base, "restore.zip")
	WriteZip(t, zipPath, names...)

	destination := filepath.Join(base, "restored")
	if err := os.MkdirAll(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	for _, entry := range reader.File {
		file, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(file)
		file.Close()
		if err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(destination, filepath.FromSlash(entry.Name))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range names {
		restored, err := os.ReadFile(filepath.Join(destination, filepath.FromSlash(name)))
		if err != nil {
			t.Fatalf("entry %q was not restored: %v", name, err)
		}
		if string(restored) != payload {
			t.Fatalf("entry %q restored %q, want %q", name, restored, payload)
		}
	}
}

// A missing directory must fail the calling test through t.Fatal, not leave a half-written archive.
// The only way to observe a t.Fatal is a child test process.
func TestWritersFailOnMissingDirectory(t *testing.T) {
	mode := os.Getenv("ARCHIVETEST_MISSING_DIR")
	if mode != "" {
		target := filepath.Join(t.TempDir(), "absent", "archive."+mode)
		if mode == "zip" {
			WriteZip(t, target, "go/VERSION")
			return
		}
		WriteTarGz(t, target, "go/VERSION")
		return
	}

	for _, format := range []string{"zip", "tar.gz"} {
		t.Run(format, func(t *testing.T) {
			child := exec.Command(os.Args[0], "-test.run=^TestWritersFailOnMissingDirectory$", "-test.v")
			child.Env = append(os.Environ(), "ARCHIVETEST_MISSING_DIR="+format)
			output, err := child.CombinedOutput()
			if err == nil {
				t.Fatalf("writer to a missing directory succeeded:\n%s", output)
			}
			if !strings.Contains(string(output), "--- FAIL") {
				t.Fatalf("child did not fail through the testing framework:\n%s", output)
			}
		})
	}
}
