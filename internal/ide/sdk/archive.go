package sdk

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Download scarica url in destination (file nuovo, mai sovrascritto), verifica la SHA-256 attesa e
// rifiuta archivi oltre maxBytes. progress riceve i byte scaricati, al più ogni 150 ms.
// label nomina l'SDK nei messaggi d'errore (es. "Go").
func Download(ctx context.Context, client *http.Client, label, url, destination, expectedSHA256 string, maxBytes int64, progress func(int64)) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("download %s fallito: %w", label, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: risposta HTTP %d", label, response.StatusCode)
	}
	if response.ContentLength > maxBytes {
		return fmt.Errorf("archive %s exceeds the allowed limit", label)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	reader := &progressReader{reader: io.LimitReader(response.Body, maxBytes+1), update: progress}
	written, copyErr := io.Copy(io.MultiWriter(file, hash), reader)
	closeErr := file.Close()
	if copyErr != nil {
		return fmt.Errorf("download %s interrotto: %w", label, copyErr)
	}
	if closeErr != nil {
		return closeErr
	}
	if written > maxBytes {
		return fmt.Errorf("archive %s exceeds the allowed limit", label)
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), expectedSHA256) {
		return fmt.Errorf("invalid SHA-256 checksum")
	}
	return nil
}

type progressReader struct {
	reader io.Reader
	read   int64
	last   time.Time
	update func(int64)
}

func (r *progressReader) Read(buffer []byte) (int, error) {
	count, err := r.reader.Read(buffer)
	r.read += int64(count)
	if r.update != nil && (time.Since(r.last) >= 150*time.Millisecond || err != nil) {
		r.last = time.Now()
		r.update(r.read)
	}
	return count, err
}

// ExtractArchive estrae uno .zip o un .tar.gz in destination rifiutando percorsi esterni, symlink,
// elementi speciali e contenuti espansi oltre maxBytes (zip bomb).
func ExtractArchive(ctx context.Context, label, archivePath, destination string, maxBytes int64) error {
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	lower := strings.ToLower(archivePath)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		return extractZip(ctx, label, archivePath, destination, maxBytes)
	case strings.HasSuffix(lower, ".tar.gz"):
		return extractTarGzip(ctx, label, archivePath, destination, maxBytes)
	}
	return fmt.Errorf("unsupported archive format %s", label)
}

// entryTarget turns an archive entry name into a path under cleanDestination. Archives are built on
// other machines, so the name is judged as on any OS: backslashes count as separators, and absolute
// names, drive letters and ".." segments are refused. skip is true for the root directory entry itself.
// The containment check stays here, next to the join that produces the path (Zip Slip).
func entryTarget(label, cleanDestination, name string) (target string, skip bool, err error) {
	normalized := strings.ReplaceAll(name, "\\", "/")
	if strings.HasPrefix(normalized, "/") || hasDriveLetter(normalized) || filepath.IsAbs(filepath.FromSlash(normalized)) || filepath.VolumeName(filepath.FromSlash(normalized)) != "" {
		return "", false, fmt.Errorf("archive %s is unsafe: absolute entry name", label)
	}
	for _, segment := range strings.Split(normalized, "/") {
		if segment == ".." {
			return "", false, fmt.Errorf("archive %s is unsafe: entry escapes the destination", label)
		}
	}
	target = filepath.Join(cleanDestination, filepath.FromSlash(normalized))
	if target == cleanDestination {
		return "", true, nil
	}
	if !strings.HasPrefix(target, cleanDestination+string(os.PathSeparator)) {
		return "", false, fmt.Errorf("archive %s is unsafe: entry escapes the destination", label)
	}
	return target, false, nil
}

// hasDriveLetter reports a Windows drive prefix such as "C:" at the start of the name.
func hasDriveLetter(name string) bool {
	if len(name) < 2 || name[1] != ':' {
		return false
	}
	letter := name[0] | 0x20
	return letter >= 'a' && letter <= 'z'
}

func extractZip(ctx context.Context, label, archivePath, destination string, maxBytes int64) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer reader.Close()
	cleanDestination := filepath.Clean(destination)
	var expanded uint64
	for _, entry := range reader.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		expanded += entry.UncompressedSize64
		if expanded > uint64(maxBytes) {
			return fmt.Errorf("archive %s expands beyond the allowed limit", label)
		}
		target, skip, err := entryTarget(label, cleanDestination, entry.Name)
		if err != nil {
			return err
		}
		if skip {
			continue // the root directory entry itself: nothing to extract
		}
		if err := writeZipEntry(label, entry, target, maxBytes); err != nil {
			return err
		}
	}
	return nil
}

// writeZipEntry creates the directory or file for one zip entry whose target entryTarget already confined.
func writeZipEntry(label string, entry *zip.File, target string, maxBytes int64) error {
	if entry.FileInfo().Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("archive %s contains a forbidden symlink", label)
	}
	if entry.FileInfo().IsDir() {
		return os.MkdirAll(target, 0o755)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	source, err := entry.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	destinationFile, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, entry.Mode().Perm())
	if err != nil {
		return err
	}
	_, err = io.Copy(destinationFile, io.LimitReader(source, maxBytes)) // nosemgrep: go.lang.security.decompression_bomb.potential-dos-via-decompression-bomb -- copy is bounded by io.LimitReader
	_ = destinationFile.Close()
	return err
}

func extractTarGzip(ctx context.Context, label, archivePath, destination string, maxBytes int64) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	reader := tar.NewReader(gzipReader)
	cleanDestination := filepath.Clean(destination)
	var expanded int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		target, skip, err := entryTarget(label, cleanDestination, header.Name)
		if err != nil {
			return err
		}
		if skip {
			continue // the root directory entry itself: nothing to extract
		}
		if header.Size < 0 || expanded+header.Size > maxBytes {
			return fmt.Errorf("archive %s expands beyond the allowed limit", label)
		}
		expanded += header.Size
		if err := writeTarEntry(label, reader, header, target, maxBytes); err != nil {
			return err
		}
	}
}

// writeTarEntry creates the directory or file for one tar entry whose target entryTarget already confined.
func writeTarEntry(label string, reader io.Reader, header *tar.Header, target string, maxBytes int64) error {
	switch header.Typeflag {
	case tar.TypeDir:
		return os.MkdirAll(target, 0o755) // NOSONAR -- target is confined to the destination by entryTarget (zip-slip guard)
	case tar.TypeReg:
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil { // NOSONAR -- same confinement: the parent of a path inside destination is inside destination
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(header.Mode).Perm()) // NOSONAR -- same confinement, O_EXCL refuses to follow an existing file
		if err != nil {
			return err
		}
		_, err = io.Copy(output, io.LimitReader(reader, maxBytes)) // nosemgrep: go.lang.security.decompression_bomb.potential-dos-via-decompression-bomb -- copy is bounded by io.LimitReader
		_ = output.Close()
		return err
	}
	return fmt.Errorf("archive %s contains a forbidden entry", label)
}
