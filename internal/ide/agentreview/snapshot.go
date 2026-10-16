package agentreview

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
	"unicode/utf8"
)

const (
	// maxSnapshotFiles e maxSnapshotBytes limitano la baseline in memoria: oltre, la review del turno
	// non è disponibile (meglio dirlo che mostrare una review incompleta).
	maxSnapshotFiles = 20_000
	maxSnapshotBytes = 64 << 20
	// maxTextFileBytes: i file più grandi entrano nella baseline solo come impronta (dimensione e data).
	maxTextFileBytes = 1 << 20
	// binarySniffBytes: stessa euristica di Git, un byte NUL all'inizio indica un file binario.
	binarySniffBytes = 8000
)

// skippedDirs non entrano nella baseline: metadati VCS, dipendenze scaricate e output di build.
var skippedDirs = map[string]bool{
	".git": true, ".hg": true, ".svn": true, "node_modules": true, "vendor": true,
	".idea": true, ".next": true, ".nuxt": true, ".cache": true, ".gradle": true, "target": true, "dist": true,
}

var errProjectTooLarge = errors.New("project too large")

// fingerprint riconosce un file senza leggerlo.
type fingerprint struct {
	size    int64
	modTime time.Time
}

// baselineFile è un file com'era all'inizio del turno. text è nil per i file binari o troppo grandi.
type baselineFile struct {
	fingerprint
	text *string
}

// scanProject elenca i file regolari del progetto con la loro impronta, in percorsi relativi con "/".
// I symlink non vengono seguiti.
func scanProject(root string) (map[string]fingerprint, error) {
	files := map[string]fingerprint{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if path == root {
				return walkErr
			}
			return nil // una cartella illeggibile non blocca la review del resto
		}
		if entry.IsDir() {
			if path != root && skippedDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if len(files) >= maxSnapshotFiles {
			return errProjectTooLarge
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		files[filepath.ToSlash(relative)] = fingerprint{size: info.Size(), modTime: info.ModTime()}
		return nil
	})
	return files, err
}

// captureBaseline legge il contenuto dei file di testo del progetto all'inizio del turno.
func captureBaseline(root string) (map[string]baselineFile, error) {
	files, err := scanProject(root)
	if err != nil {
		return nil, err
	}
	baseline := make(map[string]baselineFile, len(files))
	total := int64(0)
	for relative, print := range files {
		file := baselineFile{fingerprint: print}
		if print.size <= maxTextFileBytes {
			if text, ok := readText(filepath.Join(root, filepath.FromSlash(relative))); ok {
				total += int64(len(text))
				if total > maxSnapshotBytes {
					return nil, errProjectTooLarge
				}
				file.text = &text
			}
		}
		baseline[relative] = file
	}
	return baseline, nil
}

// readText legge un file di testo UTF-8; false per file assenti, binari o troppo grandi.
func readText(path string) (string, bool) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxTextFileBytes {
		return "", false
	}
	data, err := os.ReadFile(path)
	if err != nil || isBinary(data) {
		return "", false
	}
	return string(data), true
}

func isBinary(data []byte) bool {
	sniff := data
	if len(sniff) > binarySniffBytes {
		sniff = sniff[:binarySniffBytes]
	}
	return bytes.IndexByte(sniff, 0) >= 0 || !utf8.Valid(data)
}

func unavailableMessage(err error) string {
	if errors.Is(err, errProjectTooLarge) {
		return fmt.Sprintf("Agent changes cannot be reviewed in this project: it has more than %d files or %d MB of text outside ignored folders.", maxSnapshotFiles, maxSnapshotBytes>>20)
	}
	return "Agent changes cannot be reviewed: " + err.Error()
}
