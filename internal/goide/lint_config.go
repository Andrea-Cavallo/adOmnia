package goide

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Configurazioni iniziali: abilitano solo linter standard e restano facili da leggere e versionare.
const (
	golangciV2Config = `version: "2"

linters:
  default: standard
  # enable:
  #   - misspell
  #   - revive

issues:
  max-same-issues: 0
`
	golangciV1Config = `linters:
  enable-all: false
  # enable:
  #   - misspell
  #   - revive

issues:
  max-same-issues: 0
`
	staticcheckConfig = `# https://staticcheck.dev/docs/configuration/
checks = ["all", "-ST1000", "-ST1003"]
`
)

// LinterConfigFile restituisce il file di configurazione del linter del progetto (relativo al
// progetto). Se non esiste e create è vero, ne scrive uno minimo per il linter rilevato.
func (s *Service) LinterConfigFile(sessionID string, create bool) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	info, err := s.DetectLinter(sessionID)
	if err != nil {
		return "", err
	}
	if !info.Available {
		return "", errors.New(info.Error)
	}
	if info.ConfigPath != "" {
		return relativeWithin(session.Project.RealPath, info.ConfigPath), nil
	}
	if !create {
		return "", nil
	}
	name, content := ".golangci.yml", golangciV2Config
	switch {
	case info.Kind == LinterStaticcheck:
		name, content = "staticcheck.conf", staticcheckConfig
	case strings.HasPrefix(info.Version, "v1."):
		content = golangciV1Config
	}
	path := filepath.Join(session.Project.RealPath, name)
	if _, err := os.Stat(path); err == nil {
		return name, nil
	}
	if err := atomicWriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return name, nil
}
