package goide

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	maxDuplicateEntries   = 5000
	maxDeleteHistoryFiles = 200
)

// resolveExistingEntry valida un file o una cartella esistente del progetto (mai la radice).
// Lavora sul collegamento stesso (Lstat): rinominare o eliminare un symlink non tocca il suo target.
func resolveExistingEntry(project Project, relativePath string) (string, os.FileInfo, error) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(relativePath)))
	rooted := filepath.IsAbs(clean) || filepath.VolumeName(clean) != "" || strings.HasPrefix(clean, string(filepath.Separator))
	if clean == "." || clean == "" || rooted || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || strings.ContainsRune(clean, 0) {
		return "", nil, fmt.Errorf("percorso non valido: %q", relativePath)
	}
	path := filepath.Join(project.RealPath, clean)
	info, err := os.Lstat(path)
	if err != nil {
		return "", nil, fmt.Errorf("%s non esiste più", filepath.ToSlash(clean))
	}
	realParent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return "", nil, fmt.Errorf("impossibile risolvere la cartella: %w", err)
	}
	if err := ensureWithinRoot(project.RealPath, realParent); err != nil {
		return "", nil, err
	}
	return path, info, nil
}

// CreateDirectory crea una cartella (e le intermedie) nel progetto.
func (m *DocumentManager) CreateDirectory(project Project, relativePath string) error {
	path, err := resolveNewFilePath(project, relativePath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return fmt.Errorf("impossibile creare la cartella: %w", err)
	}
	return nil
}

// MovePath rinomina o sposta un file o una cartella dentro il progetto; non sovrascrive mai.
func (m *DocumentManager) MovePath(project Project, from, to string) error {
	source, info, err := resolveExistingEntry(project, from)
	if err != nil {
		return err
	}
	target, err := resolveNewFilePath(project, to)
	if err != nil {
		return err
	}
	if info.IsDir() && ensureWithinRoot(source, target) == nil {
		return fmt.Errorf("impossibile spostare una cartella dentro sé stessa")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("impossibile creare la cartella di destinazione: %w", err)
	}
	if err := os.Rename(source, target); err != nil {
		return fmt.Errorf("impossibile rinominare: %w", err)
	}
	return nil
}

// DuplicatePath copia un file o una cartella in un nuovo percorso del progetto (symlink esclusi).
func (m *DocumentManager) DuplicatePath(project Project, from, to string) error {
	source, info, err := resolveExistingEntry(project, from)
	if err != nil {
		return err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return fmt.Errorf("i collegamenti simbolici non vengono duplicati")
	}
	target, err := resolveNewFilePath(project, to)
	if err != nil {
		return err
	}
	if info.IsDir() && ensureWithinRoot(source, target) == nil {
		return fmt.Errorf("impossibile copiare una cartella dentro sé stessa")
	}
	count := 0
	err = filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		if count++; count > maxDuplicateEntries {
			return fmt.Errorf("troppi elementi da copiare (limite %d)", maxDuplicateEntries)
		}
		rel, _ := filepath.Rel(source, path)
		destination := filepath.Join(target, rel)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		return copyFileExclusive(path, destination)
	})
	if err != nil {
		_ = os.RemoveAll(target)
		return fmt.Errorf("duplicazione non riuscita: %w", err)
	}
	return nil
}

func copyFileExclusive(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	return errors.Join(copyErr, out.Close())
}

// DeletePath elimina un file o una cartella del progetto. Prima dell'eliminazione il testo dei
// file (fino a MaxDocumentBytes) viene passato a keep, così resta nella local history.
func (m *DocumentManager) DeletePath(project Project, relativePath string, keep func(relativePath, content string)) error {
	path, info, err := resolveExistingEntry(project, relativePath)
	if err != nil {
		return err
	}
	if keep != nil && info.Mode()&fs.ModeSymlink == 0 {
		kept := 0
		_ = filepath.WalkDir(path, func(file string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil || entry.IsDir() || entry.Type()&fs.ModeSymlink != 0 {
				return nil
			}
			// ponytail: solo i primi file finiscono nella history, una cartella enorme non la satura.
			if kept++; kept > maxDeleteHistoryFiles {
				return fs.SkipAll
			}
			if text, _, _, err := readTextFile(file); err == nil {
				rel, _ := filepath.Rel(project.RealPath, file)
				keep(filepath.ToSlash(rel), text)
			}
			return nil
		})
	}
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("impossibile eliminare: %w", err)
	}
	return nil
}

// RevealPath mostra il file o la cartella nel file manager del sistema.
func (m *DocumentManager) RevealPath(project Project, relativePath string) error {
	path := project.RealPath
	if strings.TrimSpace(relativePath) != "" {
		resolved, _, err := resolveExistingEntry(project, relativePath)
		if err != nil {
			return err
		}
		path = resolved
	}
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("explorer", "/select,", path)
	case "darwin":
		command = exec.Command("open", "-R", path)
	default:
		command = exec.Command("xdg-open", filepath.Dir(path))
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("impossibile aprire il file manager: %w", err)
	}
	go func() { _ = command.Wait() }()
	return nil
}
