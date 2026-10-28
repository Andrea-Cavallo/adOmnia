package codestudio

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	golang "github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	modulepath "golang.org/x/mod/module"
)

// DependencySourceFile è un file navigabile dentro il sorgente di una dipendenza.
type DependencySourceFile struct {
	// Path è relativo alla cartella del modulo, sempre con separatori "/".
	Path string `json:"path"`
	Name string `json:"name"`
}

// DependencySource indica dove si trova il codice sorgente di una dipendenza del go.mod.
type DependencySource struct {
	Found bool `json:"found"`
	// Kind è "project" (altro modulo dello stesso progetto), "local" (replace verso una cartella)
	// oppure "module-cache" (sorgente scaricato in GOMODCACHE).
	Kind       string `json:"kind"`
	ModulePath string `json:"modulePath"`
	Version    string `json:"version,omitempty"`
	// Replaced dice che il sorgente segue una direttiva replace del go.mod.
	Replaced bool `json:"replaced,omitzero"`
	// Directory è la cartella radice del modulo sorgente, assoluta.
	Directory string `json:"directory,omitempty"`
	// RelativeDir e EntryRelative sono relativi al progetto quando il sorgente vive al suo interno.
	RelativeDir   string `json:"relativeDir,omitempty"`
	EntryFile     string `json:"entryFile,omitempty"`
	EntryPath     string `json:"entryPath,omitempty"`
	EntryRelative string `json:"entryRelative,omitempty"`
	// Downloaded è false quando il modulo è richiesto ma non ancora presente nella module cache.
	Downloaded bool                   `json:"downloaded"`
	Files      []DependencySourceFile `json:"files"`
	Reason     string                 `json:"reason,omitempty"`
}

// maxDependencySourceFiles limita la lista dei file sfogliabili di una dipendenza.
const maxDependencySourceFiles = 400

// ResolveDependencySource localizza il codice di una dipendenza del go.mod: il target di una
// replace locale, un altro modulo del progetto oppure il sorgente nella module cache. Non esegue
// comandi e non tocca la rete: legge solo il filesystem, quindi non richiede i tool autorizzati.
func (s *Service) ResolveDependencySource(sessionID, moduleDirectory, modulePath string) (DependencySource, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DependencySource{}, err
	}
	modCache := ""
	if info, ok := s.toolchain.LastDetected(session.ID); ok {
		modCache = info.GOMODCACHE
	}
	return resolveDependencySource(session.Project, moduleDirectory, modulePath, modCache)
}

func resolveDependencySource(project Project, moduleDirectory, modulePath, modCache string) (DependencySource, error) {
	modulePath = strings.TrimSpace(modulePath)
	if !modulePathPattern.MatchString(modulePath) || strings.Contains(modulePath, "//") {
		return DependencySource{}, fmt.Errorf("invalid module path")
	}
	manager := NewDocumentManager()
	directory, err := manager.resolveDirectory(project, moduleDirectory)
	if err != nil {
		return DependencySource{}, err
	}
	state, err := readDependencyState(project, directory)
	if err != nil {
		return DependencySource{}, err
	}
	source := DependencySource{ModulePath: modulePath, Files: []DependencySourceFile{}}
	for _, dependency := range state.Dependencies {
		if dependency.Path == modulePath {
			source.Version = dependency.Version
			break
		}
	} // 1. replace locale: il sorgente è la cartella scelta dallo sviluppatore, dentro o fuori dal progetto.
	cachePath, cacheVersion := modulePath, source.Version
	for _, replacement := range state.Replacements {
		if replacement.Path != modulePath || replacement.Version != "" {
			continue
		}
		source.Replaced = true
		if replacement.Local {
			target := replacement.NewPath
			if !filepath.IsAbs(target) {
				target = filepath.Join(state.ModuleDirectory, target)
			}
			resolved, resolveErr := filepath.EvalSymlinks(filepath.Clean(target))
			if resolveErr != nil {
				source.Reason = "the local replacement folder does not exist"
				return source, nil
			}
			return describeDependencyDirectory(project, source, resolved, "local"), nil
		}
		cachePath, cacheVersion = replacement.NewPath, replacement.NewVersion
		break
	}
	// 2. modulo dello stesso progetto (workspace go.work o modulo fratello): si legge come codice proprio.
	for _, module := range goLayoutOf(project).Modules {
		if module.ModulePath == modulePath {
			return describeDependencyDirectory(project, source, module.Path, "project"), nil
		}
	}
	// 2b. modulo usato dal go.work, anche fuori dal progetto: è il sorgente che il workspace compila.
	for _, directory := range workspaceUseDirectories(project) {
		if golang.ReadModulePath(filepath.Join(directory, "go.mod")) == modulePath {
			return describeDependencyDirectory(project, source, directory, "local"), nil
		}
	}
	// 3. modulo remoto: il sorgente sta nella module cache, scaricato con `go mod download`.
	if cacheVersion == "" {
		source.Reason = "this module is not required by this go.mod"
		return source, nil
	}
	source.Version = cacheVersion
	source.Found = true
	if modCache == "" {
		source.Reason = "detect the Go SDK to browse this module's sources"
		return source, nil
	}
	escapedPath, err := modulepath.EscapePath(cachePath)
	if err != nil {
		return DependencySource{}, fmt.Errorf("invalid module path: %w", err)
	}
	escapedVersion, err := modulepath.EscapeVersion(cacheVersion)
	if err != nil {
		return DependencySource{}, fmt.Errorf("invalid module version: %w", err)
	}
	cached := filepath.Join(modCache, filepath.FromSlash(escapedPath)+"@"+escapedVersion)
	if info, err := os.Stat(cached); err != nil || !info.IsDir() {
		source.Directory = cached
		source.Reason = "the module is not in the Go module cache yet: download it to read the code"
		return source, nil
	}
	return describeDependencyDirectory(project, source, cached, "module-cache"), nil
}

// describeDependencyDirectory riempie un DependencySource con la cartella del modulo trovata:
// file di ingresso, elenco navigabile e percorsi relativi quando il sorgente è dentro il progetto.
// kind è dove il modulo è stato trovato ("project", "local", "module-cache"); diventa "project"
// quando la cartella comunque vive dentro il progetto, così da aprirne il codice in modifica.
func describeDependencyDirectory(project Project, source DependencySource, directory, kind string) DependencySource {
	source.Found = true
	source.Kind = kind
	source.Directory = directory
	source.Downloaded = true
	source.Files = dependencySourceFiles(directory)
	source.EntryFile = dependencyEntryFile(directory, source.Files)
	if source.EntryFile != "" {
		if relative, err := filepath.Rel(directory, source.EntryFile); err == nil {
			source.EntryPath = filepath.ToSlash(relative)
		}
	}
	source.RelativeDir = projectRelativePath(project, directory)
	source.EntryRelative = projectRelativePath(project, source.EntryFile)
	if source.RelativeDir != "" {
		source.Kind = "project"
	}
	return source
}

// projectRelativePath rende un assoluto relativo al progetto, o ” se ne è fuori.
func projectRelativePath(project Project, path string) string {
	if path == "" {
		return ""
	}
	for _, root := range []string{project.RealPath, project.RootPath} {
		if root == "" || ensureWithinRoot(root, path) != nil {
			continue
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			continue
		}
		relative = filepath.ToSlash(relative)
		if relative == "." {
			return ""
		}
		return relative
	}
	return ""
}

// dependencySourceFiles elenca i file sfogliabili di un modulo, in ampiezza limitata: i sorgenti
// della module cache possono essere molto grandi e qui serve solo il codice da leggere.
func dependencySourceFiles(root string) []DependencySourceFile {
	files := []DependencySourceFile{}
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			name := entry.Name()
			if path != root && (strings.HasPrefix(name, ".") || name == "vendor" || name == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		name := entry.Name()
		if !dependencySourceName(name) {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		if len(files) >= maxDependencySourceFiles {
			return fs.SkipAll
		}
		files = append(files, DependencySourceFile{Path: filepath.ToSlash(relative), Name: name})
		return nil
	})
	sort.Slice(files, func(left, right int) bool {
		leftDepth := strings.Count(files[left].Path, "/")
		rightDepth := strings.Count(files[right].Path, "/")
		if leftDepth != rightDepth {
			return leftDepth < rightDepth
		}
		return files[left].Path < files[right].Path
	})
	return files
}

// dependencySourceName decide quali file di una dipendenza vale la pena mostrare: codice, moduli
// e documentazione, senza artefatti di build.
func dependencySourceName(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".go", ".mod", ".md":
		return true
	}
	upper := strings.ToUpper(name)
	for _, prefix := range []string{"LICENSE", "COPYING", "NOTICE", "AUTHORS", "README"} {
		if strings.HasPrefix(upper, prefix) {
			return true
		}
	}
	return false
}

// dependencyEntryFile sceglie il file da aprire per primo: doc.go, poi main.go, poi il package
// della radice, infine qualsiasi sorgente o il go.mod del modulo.
func dependencyEntryFile(root string, files []DependencySourceFile) string {
	for _, preferred := range []string{"doc.go", "main.go"} {
		for _, file := range files {
			if file.Path == preferred {
				return filepath.Join(root, filepath.FromSlash(file.Path))
			}
		}
	}
	for _, file := range files {
		if strings.HasSuffix(file.Path, ".go") && !strings.Contains(file.Path, "/") && !strings.HasSuffix(file.Path, "_test.go") {
			return filepath.Join(root, filepath.FromSlash(file.Path))
		}
	}
	for _, file := range files {
		if strings.HasSuffix(file.Path, ".go") {
			return filepath.Join(root, filepath.FromSlash(file.Path))
		}
	}
	for _, file := range files {
		if strings.HasSuffix(file.Path, ".mod") {
			return filepath.Join(root, filepath.FromSlash(file.Path))
		}
	}
	if len(files) > 0 {
		return filepath.Join(root, filepath.FromSlash(files[0].Path))
	}
	return ""
}

// localDependencyRoots sono le cartelle fuori dal progetto a cui puntano le replace locali dei suoi
// go.mod e i `use` del go.work: aprono in sola lettura come la module cache e lo SDK Go.
func localDependencyRoots(project Project) []string {
	roots := []string{}
	// Se il progetto non ha ancora le unità rilevate resta almeno il go.mod della radice.
	modules := goLayoutOf(project).Modules
	if len(modules) == 0 {
		modules = []GoModule{{Path: project.RealPath}}
	}
	for _, module := range modules {
		state, err := readDependencyState(project, module.Path)
		if err != nil {
			continue
		}
		for _, replacement := range state.Replacements {
			if !replacement.Local {
				continue
			}
			target := replacement.NewPath
			if !filepath.IsAbs(target) {
				target = filepath.Join(state.ModuleDirectory, target)
			}
			if resolved, err := filepath.EvalSymlinks(filepath.Clean(target)); err == nil {
				roots = append(roots, resolved)
			}
		}
	}
	roots = append(roots, workspaceUseDirectories(project)...)
	return roots
}

// workspaceUseDirectories sono le cartelle di `use` del go.work, dentro o fuori dal progetto:
// il workspace compila quei moduli locali invece delle loro versioni nella module cache.
func workspaceUseDirectories(project Project) []string {
	root := project.RootPath
	if layout := goLayoutOf(project); layout.GoWorkPath != "" {
		root = filepath.Dir(layout.GoWorkPath)
	}
	if root == "" {
		return nil
	}
	_, _, uses, err := readGoWork(root)
	if err != nil {
		return nil
	}
	directories := make([]string, 0, len(uses))
	for directory := range uses {
		candidate := directory
		if !filepath.IsAbs(candidate) {
			candidate = filepath.Join(root, filepath.FromSlash(candidate))
		}
		if resolved, err := filepath.EvalSymlinks(filepath.Clean(candidate)); err == nil {
			directories = append(directories, resolved)
		}
	}
	sort.Strings(directories)
	return directories
}
