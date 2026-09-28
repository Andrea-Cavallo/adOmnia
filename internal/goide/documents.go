package goide

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const MaxDocumentBytes int64 = 16 * 1024 * 1024

type DocumentManager struct {
	mu        sync.RWMutex
	documents map[DocumentID]Document
}

func NewDocumentManager() *DocumentManager {
	return &DocumentManager{documents: make(map[DocumentID]Document)}
}

// ResolveProjectPath convalida un percorso esistente rispetto alla radice reale del progetto.
func (m *DocumentManager) ResolveProjectPath(project Project, candidate string) (string, error) {
	root := project.RealPath
	if root == "" {
		return "", fmt.Errorf("radice reale del progetto non disponibile")
	}
	path := candidate
	if !filepath.IsAbs(path) {
		path = filepath.Join(project.RootPath, path)
	}
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", fmt.Errorf("percorso documento non valido: %w", err)
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("impossibile risolvere il documento: %w", err)
	}
	if err := ensureWithinRoot(root, realPath); err != nil {
		return "", err
	}
	info, err := os.Stat(realPath)
	if err != nil {
		return "", fmt.Errorf("impossibile leggere il documento: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("il percorso richiesto è una cartella")
	}
	if info.Size() > MaxDocumentBytes {
		return "", fmt.Errorf("documento troppo grande: limite %d byte", MaxDocumentBytes)
	}
	return realPath, nil
}

func ensureWithinRoot(root, candidate string) error {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return fmt.Errorf("impossibile verificare il percorso: %w", err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("il percorso richiesto è esterno al progetto")
	}
	return nil
}
