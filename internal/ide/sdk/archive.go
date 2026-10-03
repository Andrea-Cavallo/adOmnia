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

	"adomnia/internal/ide/project"
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
		return fmt.Errorf("archivio %s oltre il limite consentito", label)
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
		return fmt.Errorf("archivio %s oltre il limite consentito", label)
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), expectedSHA256) {
		return fmt.Errorf("checksum SHA-256 non valido")
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
	return fmt.Errorf("formato archivio %s non supportato", label)
}

func extractZip(ctx context.Context, label, archivePath, destination string, maxBytes int64) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer reader.Close()
	var expanded uint64
	for _, entry := range reader.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		expanded += entry.UncompressedSize64
		if expanded > uint64(maxBytes) {
			return fmt.Errorf("archivio %s espanso oltre il limite consentito", label)
		}
		target := filepath.Join(destination, filepath.FromSlash(entry.Name))
		if err := project.EnsureWithin(destination, target); err != nil {
			return fmt.Errorf("archivio %s non sicuro: %w", label, err)
		}
		if entry.FileInfo().Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("archivio %s contiene un symlink non consentito", label)
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		source, err := entry.Open()
		if err != nil {
			return err
		}
		destinationFile, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, entry.Mode().Perm())
		if err == nil {
			_, err = io.Copy(destinationFile, io.LimitReader(source, maxBytes))
			_ = destinationFile.Close()
		}
		_ = source.Close()
		if err != nil {
			return err
		}
	}
	return nil
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
		target := filepath.Join(destination, filepath.FromSlash(header.Name))
		if err := project.EnsureWithin(destination, target); err != nil {
			return fmt.Errorf("archivio %s non sicuro: %w", label, err)
		}
		if header.Size < 0 || expanded+header.Size > maxBytes {
			return fmt.Errorf("archivio %s espanso oltre il limite consentito", label)
		}
		expanded += header.Size
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(header.Mode).Perm())
			if err == nil {
				_, err = io.Copy(output, io.LimitReader(reader, maxBytes))
				_ = output.Close()
			}
			if err != nil {
				return err
			}
		default:
			return fmt.Errorf("archivio %s contiene un elemento non consentito", label)
		}
	}
}
