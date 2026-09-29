package goide

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxNewFiles = 20

// NewFile è un file da creare nel progetto con il suo contenuto iniziale.
type NewFile struct {
	RelativePath string `json:"relativePath"`
	Content      string `json:"content"`
}

// resolveNewFilePath valida un percorso relativo per un file che non esiste ancora, confinato al progetto.
func resolveNewFilePath(project Project, relativePath string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(relativePath)))
	// Su Windows "\etc\passwd" ha una radice ma non è IsAbs: va rifiutato come gli assoluti.
	rooted := filepath.IsAbs(clean) || filepath.VolumeName(clean) != "" || strings.HasPrefix(clean, string(filepath.Separator))
	if clean == "." || clean == "" || rooted || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("percorso del nuovo file non valido: %q", relativePath)
	}
	if strings.ContainsRune(clean, 0) {
		return "", fmt.Errorf("percorso del nuovo file non valido")
	}
	path := filepath.Join(project.RealPath, clean)
	// La cartella esistente più vicina deve stare nel progetto anche dopo aver risolto i symlink.
	existing := filepath.Dir(path)
	for {
		if _, err := os.Stat(existing); err == nil {
			break
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return "", fmt.Errorf("cartella del nuovo file non valida")
		}
		existing = parent
	}
	realParent, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", fmt.Errorf("impossibile risolvere la cartella: %w", err)
	}
	if err := ensureWithinRoot(project.RealPath, realParent); err != nil {
		return "", err
	}
	if _, err := os.Lstat(path); err == nil {
		return "", fmt.Errorf("%s esiste già", filepath.ToSlash(clean))
	}
	return path, nil
}

// CreateFiles crea file nuovi nel progetto, tutti o nessuno: non sovrascrive mai un file esistente.
func (m *DocumentManager) CreateFiles(project Project, files []NewFile) error {
	if len(files) == 0 || len(files) > maxNewFiles {
		return fmt.Errorf("numero di file da creare non valido")
	}
	paths := make([]string, 0, len(files))
	for _, file := range files {
		if int64(len(file.Content)) > MaxDocumentBytes {
			return fmt.Errorf("%s: contenuto troppo grande", file.RelativePath)
		}
		path, err := resolveNewFilePath(project, file.RelativePath)
		if err != nil {
			return err
		}
		paths = append(paths, path)
	}
	written := make([]string, 0, len(paths))
	rollback := func(cause error) error {
		for _, path := range written {
			_ = os.Remove(path)
		}
		return cause
	}
	for index, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return rollback(fmt.Errorf("impossibile creare la cartella: %w", err))
		}
		handle, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			if errors.Is(err, os.ErrExist) {
				return rollback(fmt.Errorf("%s esiste già", files[index].RelativePath))
			}
			return rollback(fmt.Errorf("impossibile creare %s: %w", files[index].RelativePath, err))
		}
		written = append(written, path)
		_, writeErr := handle.WriteString(files[index].Content)
		closeErr := handle.Close()
		if writeErr != nil || closeErr != nil {
			return rollback(fmt.Errorf("impossibile scrivere %s", files[index].RelativePath))
		}
	}
	return nil
}
