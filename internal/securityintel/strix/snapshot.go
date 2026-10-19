package strix

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"adomnia/internal/procutil"
)

const (
	maxSnapshotFiles = 20000
	maxSnapshotFile  = 5 << 20   // oltre 5 MiB un file non è codice sorgente
	maxSnapshotBytes = 250 << 20 // la stessa soglia del cloud di Strix
)

// skippedDirs sono cartelle che non contengono il codice del progetto (dipendenze, build, VCS).
var skippedDirs = map[string]bool{
	".git": true, "node_modules": true, "vendor": true, "target": true, "build": true, "dist": true, "out": true,
	".gradle": true, ".idea": true, ".venv": true, "venv": true, "__pycache__": true, "strix_runs": true, ".next": true,
}

// secretFile riconosce file che non devono mai lasciare il computer: la copia è il pezzo che Strix e il modello vedono.
func secretFile(name string) bool {
	lower := strings.ToLower(name)
	if lower == ".env" || strings.HasPrefix(lower, ".env.") && !strings.HasSuffix(lower, ".example") && !strings.HasSuffix(lower, ".sample") {
		return true
	}
	for _, suffix := range []string{".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"} {
		if strings.HasSuffix(lower, suffix) {
			return true
		}
	}
	return lower == "id_rsa" || lower == "id_ed25519" || lower == "credentials.json"
}

// Snapshot è l'esito della copia del progetto.
type Snapshot struct {
	Files   int
	Bytes   int64
	Skipped int
}

// CopyProject copia in dst il codice del progetto: i file tracciati e non ignorati da Git, oppure, fuori da
// un repository, una visita che salta dipendenze e build. Segreti e file enormi restano fuori.
func CopyProject(ctx context.Context, root, dst string) (Snapshot, error) {
	paths, err := gitFiles(ctx, root)
	if err != nil {
		paths, err = walkFiles(root)
		if err != nil {
			return Snapshot{}, err
		}
	}
	var snapshot Snapshot
	for _, relative := range paths {
		if err := ctx.Err(); err != nil {
			return snapshot, err
		}
		if !copyable(relative) {
			snapshot.Skipped++
			continue
		}
		source := filepath.Join(root, filepath.FromSlash(relative))
		info, err := os.Lstat(source)
		if err != nil || !info.Mode().IsRegular() || info.Size() > maxSnapshotFile {
			snapshot.Skipped++
			continue
		}
		if snapshot.Files >= maxSnapshotFiles || snapshot.Bytes+info.Size() > maxSnapshotBytes {
			return snapshot, fmt.Errorf("the project is too large for a Strix scan (over %d files or %d MiB): pick a subfolder", maxSnapshotFiles, maxSnapshotBytes>>20)
		}
		if err := copyFile(source, filepath.Join(dst, filepath.FromSlash(relative))); err != nil {
			return snapshot, err
		}
		snapshot.Files++
		snapshot.Bytes += info.Size()
	}
	if snapshot.Files == 0 {
		return snapshot, errors.New("no source files to scan in this folder")
	}
	return snapshot, nil
}

// copyable esclude i segreti e le cartelle di dipendenze anche quando Git li elenca.
func copyable(relative string) bool {
	parts := strings.Split(relative, "/")
	for _, part := range parts[:len(parts)-1] {
		if skippedDirs[part] {
			return false
		}
	}
	return !secretFile(parts[len(parts)-1])
}

func gitFiles(ctx context.Context, root string) ([]string, error) {
	if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
		return nil, err
	}
	command := procutil.CommandContext(ctx, "git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
	output, err := command.Output()
	if err != nil {
		return nil, err
	}
	var paths []string
	scanner := bufio.NewScanner(bytes.NewReader(output))
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		if i := bytes.IndexByte(data, 0); i >= 0 {
			return i + 1, data[:i], nil
		}
		if atEOF && len(data) > 0 {
			return len(data), data, nil
		}
		return 0, nil, nil
	})
	for scanner.Scan() {
		paths = append(paths, scanner.Text())
	}
	return paths, scanner.Err()
}

func walkFiles(root string) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != root && skippedDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err == nil {
			paths = append(paths, filepath.ToSlash(relative))
		}
		if len(paths) > maxSnapshotFiles*2 {
			return fs.SkipAll
		}
		return nil
	})
	return paths, err
}

func copyFile(source, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}
