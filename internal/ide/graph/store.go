package graph

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// skippedDirs non contengono sorgenti del progetto (o sono enormi).
var skippedDirs = map[string]bool{".git": true, "node_modules": true, "vendor": true, ".adomnia": true, ".idea": true, ".vscode": true}

// Fingerprint riassume i file sorgente (percorso, dimensione, data di modifica): se non
// cambia, il grafo salvato è ancora valido. match sceglie i file che contano.
func Fingerprint(root string, match func(rel string) bool) (string, error) {
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil // una cartella illeggibile non invalida il resto
		}
		if entry.IsDir() {
			if path != root && (skippedDirs[entry.Name()] || strings.HasPrefix(entry.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if !match(rel) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		fmt.Fprintf(hash, "%s\x00%d\x00%d\n", rel, info.Size(), info.ModTime().UnixNano())
		return nil
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// Store salva un grafo per progetto in una cartella dell'app (mai nel progetto dell'utente).
type Store struct {
	dir string
}

func NewStore(dir string) *Store { return &Store{dir: dir} }

func (s *Store) path(root, language string) string {
	sum := sha256.Sum256([]byte(language + "\x00" + filepath.Clean(root)))
	return filepath.Join(s.dir, hex.EncodeToString(sum[:12])+".json")
}

// Load restituisce il grafo salvato, se esiste.
func (s *Store) Load(root, language string) (Graph, bool) {
	if s == nil || s.dir == "" {
		return Graph{}, false
	}
	data, err := os.ReadFile(s.path(root, language))
	if err != nil {
		return Graph{}, false
	}
	var graph Graph
	if json.Unmarshal(data, &graph) != nil || graph.Root != root {
		return Graph{}, false
	}
	return graph, true
}

// Save scrive in modo atomico; un grafo non salvato si ricostruisce, quindi gli errori sono solo riportati.
func (s *Store) Save(graph Graph) error {
	if s == nil || s.dir == "" {
		return errors.New("graph store not configured")
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(graph)
	if err != nil {
		return err
	}
	target := s.path(graph.Root, graph.Language)
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
