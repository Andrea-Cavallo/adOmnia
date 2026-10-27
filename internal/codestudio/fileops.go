package codestudio

import (
	"errors"
	"fmt"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
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
		return "", nil, fmt.Errorf("invalid path: %q", relativePath)
	}
	path := filepath.Join(project.RealPath, clean)
	info, err := os.Lstat(path)
	if err != nil {
		return "", nil, fmt.Errorf("%s no longer exists", filepath.ToSlash(clean))
	}
	realParent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return "", nil, fmt.Errorf("could not resolve the folder: %w", err)
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
		return fmt.Errorf("could not create the folder: %w", err)
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
		return fmt.Errorf("cannot move a folder into itself")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("could not create the destination folder: %w", err)
	}
	rewrites, err := planMovedPackageImports(project, from, to, info.IsDir())
	if err != nil {
		return err
	}
	if err := os.Rename(source, target); err != nil {
		return fmt.Errorf("could not rename: %w", err)
	}
	for index, rewrite := range rewrites {
		path := rewrite.path
		if sameOrChildPath(path, source) {
			relative, _ := filepath.Rel(source, path)
			path = filepath.Join(target, relative)
		}
		if err := os.WriteFile(path, rewrite.updated, rewrite.mode); err != nil {
			for previous := range index {
				restorePath := rewrites[previous].path
				if sameOrChildPath(restorePath, source) {
					relative, _ := filepath.Rel(source, restorePath)
					restorePath = filepath.Join(target, relative)
				}
				_ = os.WriteFile(restorePath, rewrites[previous].original, rewrites[previous].mode)
			}
			_ = os.Rename(target, source)
			return fmt.Errorf("move cancelled: could not update the imports in %s: %w", filepath.Base(path), err)
		}
	}
	return nil
}

type importRewrite struct {
	path              string
	original, updated []byte
	mode              fs.FileMode
}

type byteReplacement struct {
	start, end int
	text       string
}

func sameOrChildPath(candidate, parent string) bool {
	relative, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(candidate))
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

// moduleImportPath ricava l'import path della cartella dal modulo più interno che la contiene.
func moduleImportPath(project Project, relativeDirectory string) (string, bool) {
	directory := filepath.Join(project.RealPath, filepath.FromSlash(strings.Trim(relativeDirectory, "/")))
	var owner *GoModule
	modules := goLayoutOf(project).Modules
	for index := range modules {
		module := &modules[index]
		if module.ModulePath == "" || !sameOrChildPath(directory, module.Path) {
			continue
		}
		if owner == nil || len(filepath.Clean(module.Path)) > len(filepath.Clean(owner.Path)) {
			copy := *module
			owner = &copy
		}
	}
	if owner == nil {
		return "", false
	}
	relative, err := filepath.Rel(owner.Path, directory)
	if err != nil {
		return "", false
	}
	if relative == "." {
		return owner.ModulePath, true
	}
	return strings.TrimSuffix(owner.ModulePath, "/") + "/" + filepath.ToSlash(relative), true
}

// planMovedPackageImports cambia esclusivamente i literal degli import Go che puntano al package
// spostato (o a un suo sotto-package). Commenti e stringhe ordinarie restano intatti.
func planMovedPackageImports(project Project, from, to string, directory bool) ([]importRewrite, error) {
	if !directory {
		return nil, nil
	}
	oldImport, oldOK := moduleImportPath(project, from)
	newImport, newOK := moduleImportPath(project, to)
	if !oldOK || !newOK || oldImport == newImport {
		return nil, nil
	}
	var rewrites []importRewrite
	err := filepath.WalkDir(project.RealPath, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != project.RealPath && (entry.Name() == ".git" || entry.Name() == "vendor" || entry.Name() == "node_modules") {
				return fs.SkipDir
			}
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 || !strings.HasSuffix(strings.ToLower(entry.Name()), ".go") {
			return nil
		}
		original, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files := token.NewFileSet()
		parsed, err := parser.ParseFile(files, path, original, parser.ImportsOnly)
		if err != nil {
			return nil // un file incompleto non deve impedire lo spostamento degli altri
		}
		var replacements []byteReplacement
		for _, spec := range parsed.Imports {
			value, err := strconv.Unquote(spec.Path.Value)
			if err != nil || (value != oldImport && !strings.HasPrefix(value, oldImport+"/")) {
				continue
			}
			suffix := strings.TrimPrefix(value, oldImport)
			replacements = append(replacements, byteReplacement{start: files.Position(spec.Path.Pos()).Offset, end: files.Position(spec.Path.End()).Offset, text: strconv.Quote(newImport + suffix)})
		}
		if len(replacements) == 0 {
			return nil
		}
		sort.Slice(replacements, func(i, j int) bool { return replacements[i].start > replacements[j].start })
		updated := append([]byte(nil), original...)
		for _, replacement := range replacements {
			updated = append(updated[:replacement.start], append([]byte(replacement.text), updated[replacement.end:]...)...)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		rewrites = append(rewrites, importRewrite{path: path, original: original, updated: updated, mode: info.Mode().Perm()})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("could not analyze the project imports: %w", err)
	}
	return rewrites, nil
}

// DuplicatePath copia un file o una cartella in un nuovo percorso del progetto (symlink esclusi).
func (m *DocumentManager) DuplicatePath(project Project, from, to string) error {
	source, info, err := resolveExistingEntry(project, from)
	if err != nil {
		return err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return fmt.Errorf("symbolic links are not duplicated")
	}
	target, err := resolveNewFilePath(project, to)
	if err != nil {
		return err
	}
	if info.IsDir() && ensureWithinRoot(source, target) == nil {
		return fmt.Errorf("cannot copy a folder into itself")
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
		return fmt.Errorf("duplication failed: %w", err)
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
		return fmt.Errorf("could not delete: %w", err)
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
		command = exec.Command("explorer", "/select,", path) // NOSONAR -- OS file manager launched by bare name through PATH; the path argument is the file the user revealed
	case "darwin":
		command = exec.Command("open", "-R", path) // NOSONAR -- OS file manager launched by bare name through PATH; the path argument is the file the user revealed
	default:
		command = exec.Command("xdg-open", filepath.Dir(path)) // NOSONAR -- OS file manager launched by bare name through PATH; the path argument is the file the user revealed
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("could not open the file manager: %w", err)
	}
	go func() { _ = command.Wait() }()
	return nil
}
