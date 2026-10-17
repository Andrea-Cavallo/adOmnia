package codestudio

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ReadProjectKeystore reads opaque bytes only after an explicit file action. No password is stored.
func (s *Service) ReadProjectKeystore(sessionID, candidate string) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	const limit = 8 << 20
	filePath, err := s.documents.resolveProjectPathLimit(session.Project, candidate, limit)
	if err != nil {
		return "", err
	}
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".jks", ".p12", ".pfx":
	default:
		return "", fmt.Errorf("expected a JKS or PKCS12 file")
	}
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("keystore must be a regular file")
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return "", err
	}
	if len(data) == 0 || len(data) > limit {
		return "", fmt.Errorf("keystore must contain 1 byte to 8 MiB")
	}
	return base64.StdEncoding.EncodeToString(data), nil
}
