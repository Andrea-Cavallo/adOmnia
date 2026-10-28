package workspace

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"time"
	"unicode/utf8"
)

// MaxDocumentBytes is the largest file Code Studio opens in the editor.
const MaxDocumentBytes int64 = 16 * 1024 * 1024

// DiskChangeKind segue workspace/didChangeWatchedFiles: 1 creato, 2 modificato, 3 eliminato.
type DiskChangeKind int

const (
	FileCreated DiskChangeKind = 1
	FileChanged DiskChangeKind = 2
	FileDeleted DiskChangeKind = 3
)

// DiskChange è un file del progetto cambiato su disco.
type DiskChange struct {
	Path         string         `json:"path"`
	RelativePath string         `json:"relativePath"`
	Kind         DiskChangeKind `json:"kind"`
}

// ReadTextFile reads a UTF-8 document no larger than MaxDocumentBytes and returns its text, file info and disk token.
func ReadTextFile(path string) (string, os.FileInfo, string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", nil, "", fmt.Errorf("could not read the document: %w", err)
	}
	if info.Size() > MaxDocumentBytes {
		return "", nil, "", fmt.Errorf("document too large: limit %d bytes", MaxDocumentBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", nil, "", fmt.Errorf("could not read the document: %w", err)
	}
	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return "", nil, "", fmt.Errorf("the file is not a UTF-8 text document")
	}
	return string(data), info, DiskToken(data, info), nil
}

// DiskToken identifies a version of a file on disk (mtime, size and a content hash).
func DiskToken(data []byte, info os.FileInfo) string {
	hash := sha256.Sum256(data)
	return fmt.Sprintf("%d-%d-%s", info.ModTime().UnixNano(), info.Size(), hex.EncodeToString(hash[:8]))
}

// NewID returns prefix-<24 random hex digits>, used for session, document and request ids.
func NewID(prefix string) string {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(random)
}
