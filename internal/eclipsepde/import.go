package eclipsepde

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ImportResult reports what ImportPlugins copied and what it left out.
type ImportResult struct {
	// Imported are the destinations relative to the workspace root, e.g. "plugins/core".
	Imported []string `json:"imported"`
	// Skipped is one readable line per folder that was not imported.
	Skipped []string `json:"skipped"`
}

// importSkipNames are the folders an import never copies: version-control metadata (a plugin would
// become a nested repository) and the output folders Eclipse, Maven and npm regenerate.
var importSkipNames = map[string]bool{
	".git": true, ".svn": true, ".hg": true,
	"bin": true, "target": true, "node_modules": true,
}

// maxImportDepth keeps the walk inside the plug-in project: a link or a junction to a parent
// folder would otherwise copy the whole disk.
const maxImportDepth = 32

// ImportPlugins copies each Eclipse plug-in project into <root>/plugins/<name>, so a workspace that
// keeps a single root can hold the bundles of several repositories and resolve them against each
// other. Nothing is overwritten: an existing destination is reported and skipped, and a failed copy
// removes what it wrote instead of leaving half a bundle behind.
func ImportPlugins(root string, sources []string) (ImportResult, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return ImportResult{}, err
	}
	if info, err := os.Stat(absRoot); err != nil || !info.IsDir() {
		return ImportResult{}, fmt.Errorf("%s: not a directory", absRoot)
	}
	result := ImportResult{Imported: []string{}, Skipped: []string{}}
	for _, source := range sources {
		source = strings.TrimSpace(source)
		if source == "" {
			continue
		}
		absSource, err := filepath.Abs(source)
		if err != nil {
			result.Skipped = append(result.Skipped, fmt.Sprintf("%s: not a folder", source))
			continue
		}
		name, reason := importablePlugin(absRoot, absSource)
		if reason != "" {
			result.Skipped = append(result.Skipped, fmt.Sprintf("%s: %s", absSource, reason))
			continue
		}
		destination := filepath.Join(absRoot, "plugins", name)
		if _, err := os.Stat(destination); err == nil {
			result.Skipped = append(result.Skipped, fmt.Sprintf("%s: %s already exists in the workspace", absSource, name))
			continue
		}
		if err := os.MkdirAll(filepath.Join(absRoot, "plugins"), 0o755); err != nil {
			return result, fmt.Errorf("create plugins folder: %w", err)
		}
		if err := copyPluginTree(absSource, destination); err != nil {
			_ = os.RemoveAll(destination)
			return result, fmt.Errorf("copy %s: %w", absSource, err)
		}
		relative, err := filepath.Rel(absRoot, destination)
		if err != nil {
			relative = destination
		}
		result.Imported = append(result.Imported, filepath.ToSlash(relative))
	}
	return result, nil
}

// importablePlugin says whether source can be copied into the workspace, and under which name.
func importablePlugin(absRoot, absSource string) (name, reason string) {
	info, err := os.Stat(absSource)
	if err != nil {
		return "", "not readable"
	}
	if !info.IsDir() {
		return "", "not a folder: choose the plug-in project folder"
	}
	if insideFolder(absRoot, absSource) {
		return "", "already inside the project"
	}
	if _, err := os.Stat(filepath.Join(absSource, ".project")); err != nil {
		return "", "not an Eclipse plug-in project (.project missing)"
	}
	name = filepath.Base(absSource)
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "", "the folder has no name"
	}
	return name, ""
}

// insideFolder is true when path is folder or one of its descendants, ignoring case (Windows).
func insideFolder(folder, path string) bool {
	folder = strings.TrimSuffix(strings.ToLower(folder), string(filepath.Separator))
	return path == folder || strings.HasPrefix(strings.ToLower(path)+string(filepath.Separator), folder+string(filepath.Separator))
}

func copyPluginTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return os.MkdirAll(destination, 0o755)
		}
		if strings.Count(relative, string(filepath.Separator)) >= maxImportDepth {
			return filepath.SkipDir
		}
		if entry.IsDir() {
			if importSkipNames[strings.ToLower(entry.Name())] {
				return filepath.SkipDir
			}
			return os.MkdirAll(filepath.Join(destination, relative), 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		// Links are not followed and not recreated: an import must copy files, not a graph.
		if !info.Mode().IsRegular() {
			return nil
		}
		return copyPluginFile(path, filepath.Join(destination, relative), info.Mode())
	})
}

func copyPluginFile(source, destination string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode.Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}
