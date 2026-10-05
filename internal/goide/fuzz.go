package goide

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"adomnia/internal/languages/golang"
)

// Fuzzing Studio: elenca i target fuzz del progetto con il loro corpus (testdata/fuzz e cache di Go),
// mostra gli input, li promuove in testdata e li cancella. Nessun processo viene avviato qui:
// fuzzing e replay passano dalle normali run di test, avviate dall'utente.

const (
	maxFuzzTargets     = 500
	maxFuzzInputs      = 300
	maxFuzzInputBytes  = 1 << 20
	fuzzSourceTestdata = "testdata"
	fuzzSourceCache    = "cache"
)

// FuzzInput è un file del corpus. Duplicate indica un altro input con lo stesso contenuto.
type FuzzInput struct {
	Name      string    `json:"name"`
	Source    string    `json:"source"`
	Size      int64     `json:"size"`
	Modified  time.Time `json:"modified"`
	Duplicate string    `json:"duplicate,omitempty"`
}

// FuzzTarget è una funzione FuzzX con il corpus del suo package.
type FuzzTarget struct {
	Name        string      `json:"name"`
	PackageDir  string      `json:"packageDir"`
	ImportPath  string      `json:"importPath,omitempty"`
	File        string      `json:"file"`
	Line        int         `json:"line"`
	Seeds       []FuzzInput `json:"seeds"`
	Cached      []FuzzInput `json:"cached"`
	CachedTotal int         `json:"cachedTotal"`
	CacheDir    string      `json:"cacheDir,omitempty"`
}

// FuzzInputContent è un input interpretato, con il testo originale per la copia.
type FuzzInputContent struct {
	Values []golang.FuzzValue `json:"values"`
	Raw    string             `json:"raw"`
	Error  string             `json:"error,omitempty"`
}

// ListFuzzTargets trova le funzioni Fuzz* nei file di test del progetto e ne legge il corpus.
func (s *Service) ListFuzzTargets(sessionID string) ([]FuzzTarget, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	root := session.Project.RealPath
	cache := golang.GoBuildCache(nil)
	targets := make([]FuzzTarget, 0)
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || len(targets) >= maxFuzzTargets {
			return nil
		}
		if entry.IsDir() {
			name := entry.Name()
			if path != root && (strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "testdata") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), "_test.go") {
			return nil
		}
		for _, decl := range golang.FuzzTargetsInFile(path) {
			directory := filepath.Dir(path)
			importPath := packageImportPath(root, directory)
			target := FuzzTarget{Name: decl.Name, PackageDir: relativeOrDot(root, directory), ImportPath: importPath, File: relativeWithin(root, path), Line: decl.Line}
			target.Seeds, _ = listFuzzInputs(filepath.Join(directory, "testdata", "fuzz", decl.Name), fuzzSourceTestdata)
			if dir := golang.FuzzCacheDir(cache, importPath, decl.Name); dir != "" {
				target.CacheDir = dir
				target.Cached, target.CachedTotal = listFuzzInputs(dir, fuzzSourceCache)
			}
			markDuplicateFuzzInputs(&target, directory, cache)
			targets = append(targets, target)
		}
		return nil
	})
	sort.Slice(targets, func(left, right int) bool {
		if targets[left].PackageDir != targets[right].PackageDir {
			return targets[left].PackageDir < targets[right].PackageDir
		}
		return targets[left].Name < targets[right].Name
	})
	return targets, nil
}

// ReadFuzzInput restituisce i valori di un input del corpus.
func (s *Service) ReadFuzzInput(sessionID, packageDir, target, source, name string) (FuzzInputContent, error) {
	path, err := s.fuzzInputPath(sessionID, packageDir, target, source, name, false)
	if err != nil {
		return FuzzInputContent{}, err
	}
	data, err := readLimited(path, maxFuzzInputBytes)
	if err != nil {
		return FuzzInputContent{}, err
	}
	values, parseErr := golang.ParseFuzzInput(data)
	content := FuzzInputContent{Values: values, Raw: string(data)}
	if parseErr != nil {
		content.Error = parseErr.Error()
	}
	if content.Values == nil {
		content.Values = []golang.FuzzValue{}
	}
	return content, nil
}

// PromoteFuzzInput copia un input generato dalla cache in testdata/fuzz: da quel momento
// ogni `go test` lo esegue come caso di regressione.
func (s *Service) PromoteFuzzInput(sessionID, packageDir, target, name string) (string, error) {
	source, err := s.fuzzInputPath(sessionID, packageDir, target, fuzzSourceCache, name, true)
	if err != nil {
		return "", err
	}
	destination, err := s.fuzzInputPath(sessionID, packageDir, target, fuzzSourceTestdata, name, true)
	if err != nil {
		return "", err
	}
	data, err := readLimited(source, maxFuzzInputBytes)
	if err != nil {
		return "", err
	}
	if _, err := golang.ParseFuzzInput(data); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return "", fmt.Errorf("creazione di testdata/fuzz fallita: %w", err)
	}
	if err := os.WriteFile(destination, data, 0o644); err != nil {
		return "", fmt.Errorf("scrittura dell'input fallita: %w", err)
	}
	session, _ := s.session(sessionID)
	return relativeWithin(session.Project.RealPath, destination), nil
}

// DeleteFuzzInput cancella un input dal corpus del progetto o dalla cache di Go.
func (s *Service) DeleteFuzzInput(sessionID, packageDir, target, source, name string) error {
	path, err := s.fuzzInputPath(sessionID, packageDir, target, source, name, true)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("cancellazione dell'input fallita: %w", err)
	}
	return nil
}

// fuzzInputPath costruisce il percorso dal target e dal nome: il frontend non passa mai percorsi assoluti.
func (s *Service) fuzzInputPath(sessionID, packageDir, target, source, name string, write bool) (string, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return "", err
	}
	if write && session.Project.Authorization != AuthorizationPermitted {
		return "", fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	if !golang.ValidFuzzTargetName(target) {
		return "", fmt.Errorf("target fuzz non valido: %q", target)
	}
	if name == "" || name != filepath.Base(name) || strings.ContainsAny(name, `/\:`) || name == "." || name == ".." {
		return "", fmt.Errorf("nome dell'input non valido: %q", name)
	}
	root := session.Project.RealPath
	directory := filepath.Clean(filepath.Join(root, filepath.FromSlash(packageDir)))
	if err := ensureWithinRoot(root, directory); err != nil {
		return "", fmt.Errorf("package fuori dal progetto: %w", err)
	}
	switch source {
	case fuzzSourceTestdata:
		return filepath.Join(directory, "testdata", "fuzz", target, name), nil
	case fuzzSourceCache:
		dir := golang.FuzzCacheDir(golang.GoBuildCache(nil), packageImportPath(root, directory), target)
		if dir == "" {
			return "", fmt.Errorf("cache del fuzzing non disponibile per questo package")
		}
		return filepath.Join(dir, name), nil
	}
	return "", fmt.Errorf("sorgente del corpus non valida: %q", source)
}

func listFuzzInputs(directory, source string) ([]FuzzInput, int) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return []FuzzInput{}, 0
	}
	inputs := make([]FuzzInput, 0, min(len(entries), maxFuzzInputs))
	total := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		total++
		inputs = append(inputs, FuzzInput{Name: entry.Name(), Source: source, Size: info.Size(), Modified: info.ModTime()})
	}
	// I più recenti per primi: un crash appena trovato è in cima.
	sort.Slice(inputs, func(left, right int) bool { return inputs[left].Modified.After(inputs[right].Modified) })
	if len(inputs) > maxFuzzInputs {
		inputs = inputs[:maxFuzzInputs]
	}
	return inputs, total
}

// markDuplicateFuzzInputs segnala input con contenuto identico (es. un crash già promosso in testdata).
func markDuplicateFuzzInputs(target *FuzzTarget, packageDir, cache string) {
	seen := make(map[string]string)
	mark := func(inputs []FuzzInput, directory string) {
		for index := range inputs {
			sum, err := fileDigest(filepath.Join(directory, inputs[index].Name))
			if err != nil {
				continue
			}
			if first, ok := seen[sum]; ok {
				inputs[index].Duplicate = first
				continue
			}
			seen[sum] = inputs[index].Source + "/" + inputs[index].Name
		}
	}
	mark(target.Seeds, filepath.Join(packageDir, "testdata", "fuzz", target.Name))
	if target.CacheDir != "" {
		mark(target.Cached, target.CacheDir)
	}
}

func fileDigest(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, io.LimitReader(file, maxFuzzInputBytes)); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func readLimited(path string, limit int64) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("input non trovato: %s", filepath.Base(path))
	}
	if info.IsDir() || info.Size() > limit {
		return nil, fmt.Errorf("input non valido o troppo grande (max %d KB)", limit>>10)
	}
	return os.ReadFile(path)
}

// packageImportPath ricava l'import path dal go.mod più vicino dentro il progetto.
func packageImportPath(root, directory string) string {
	for current := directory; ensureWithinRoot(root, current) == nil; current = filepath.Dir(current) {
		if modulePath := golang.ReadModulePath(filepath.Join(current, "go.mod")); modulePath != "" {
			rel, err := filepath.Rel(current, directory)
			if err != nil {
				return ""
			}
			if rel == "." {
				return modulePath
			}
			return modulePath + "/" + filepath.ToSlash(rel)
		}
		if parent := filepath.Dir(current); parent == current {
			break
		}
	}
	return ""
}

func relativeOrDot(root, directory string) string {
	if rel := relativeWithin(root, directory); rel != "" {
		return rel
	}
	return "."
}
