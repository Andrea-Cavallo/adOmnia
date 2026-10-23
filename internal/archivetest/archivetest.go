// Package archivetest builds small hostile and benign archives for the extraction tests
// (SDK downloads, app updates), so each extractor does not carry its own copy of the writers.
package archivetest

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"os"
	"testing"
)

// HostileNames are entry names a malicious archive uses to write outside the destination. They
// are judged as on any OS: an archive built on Windows is extracted on Linux and the other way round.
var HostileNames = []string{"../evil.txt", "a/../../evil.txt", "/abs-evil.txt", "..\\evil.txt", "C:/evil.txt"}

const payload = "pwned"

// WriteZip writes a zip at path with one small file per name.
func WriteZip(t *testing.T, path string, names ...string) {
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
		_, _ = entry.Write([]byte(payload))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
}

// WriteTarGz writes a tar.gz at path with one small regular file per name.
func WriteTarGz(t *testing.T, path string, names ...string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz := gzip.NewWriter(file)
	archive := tar.NewWriter(gz)
	for _, name := range names {
		if err := archive.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(payload))}); err != nil {
			t.Fatal(err)
		}
		_, _ = archive.Write([]byte(payload))
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
}
