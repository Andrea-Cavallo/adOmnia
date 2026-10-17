package codestudio

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ReadProjectPDF is an explicit local file open, using the project's symlink-safe boundary.
func (s *Service) ReadProjectPDF(sessionID, candidate string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	path, err := s.documents.resolveProjectPathLimit(session.Project, candidate, 100<<20)
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".pdf") {
		return "", fmt.Errorf("expected a PDF file")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("PDF must be a regular file")
	}
	const limit = 100 << 20
	bytes, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return "", err
	}
	if len(bytes) > limit {
		return "", fmt.Errorf("PDF exceeds 100 MiB")
	}
	if !strings.HasPrefix(string(bytes[:min(len(bytes), 1024)]), "%PDF-") {
		return "", fmt.Errorf("invalid PDF header")
	}
	return base64.StdEncoding.EncodeToString(bytes), nil
}
