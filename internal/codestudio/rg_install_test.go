package codestudio

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestRipgrepAssetIsPinnedForThisPlatform(t *testing.T) {
	file, ok := RipgrepInstallable()
	if !ok {
		t.Skip("no ripgrep build for this platform")
	}
	asset, ok := ripgrepAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok || asset.file != file || len(asset.sha256) != 64 {
		t.Fatalf("asset = %+v (%q)", asset, file)
	}
}

func TestExtractRipgrepBinaryFromZipAndTar(t *testing.T) {
	work := t.TempDir()
	var zipped bytes.Buffer
	zipWriter := zip.NewWriter(&zipped)
	entry, err := zipWriter.Create("ripgrep-14.1.1-x86_64-pc-windows-msvc/rg.exe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("zip-binary")); err != nil {
		t.Fatal(err)
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	zipPath := filepath.Join(work, "rg.zip")
	if err := os.WriteFile(zipPath, zipped.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	binary, err := extractRipgrepBinary(zipPath, "rg.zip", work, "rg.exe")
	if err != nil || string(binary) != "zip-binary" {
		t.Fatalf("zip: %q %v", binary, err)
	}

	var tarred bytes.Buffer
	gzipWriter := gzip.NewWriter(&tarred)
	tarWriter := tar.NewWriter(gzipWriter)
	payload := []byte("tar-binary")
	if err := tarWriter.WriteHeader(&tar.Header{Name: "ripgrep-14.1.1/rg", Mode: 0o755, Size: int64(len(payload)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	tarPath := filepath.Join(work, "rg.tar.gz")
	if err := os.WriteFile(tarPath, tarred.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	binary, err = extractRipgrepBinary(tarPath, "rg.tar.gz", work, "rg")
	if err != nil || string(binary) != "tar-binary" {
		t.Fatalf("tar: %q %v", binary, err)
	}
}
