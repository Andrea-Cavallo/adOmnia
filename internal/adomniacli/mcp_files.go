package adomniacli

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// File tools for Code Studio workspaces: reading and writing project files with a hard
// boundary (inside the workspace only, no symlink escape), size limits and SHA-256 conflict
// checks, so an agent can edit a large OSGi workspace without touching anything else.

// requireWrite enforces the explicit opt-in of the server.
func (s *mcpServer) requireWrite() error {
	if s.allowWrite {
		return nil
	}
	return fmt.Errorf("writing is disabled: start the server with `adomnia mcp --write` (or set ADOMNIA_MCP_WRITE=1) to allow it")
}

// secureWorkspacePath resolves a requested path inside root, refusing traversal and
// symlinks that leave the workspace.
func secureWorkspacePath(root, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return "", fmt.Errorf("path is required")
	}
	var joined string
	if filepath.IsAbs(requested) {
		joined = filepath.Clean(requested)
	} else {
		joined = filepath.Join(root, filepath.FromSlash(requested))
	}
	rootReal, err := filepath.EvalSymlinks(root)
	if err != nil {
		rootReal = root
	}
	// The parent must exist (or be creatable inside the root); resolving it catches a symlink
	// that points outside even when the file itself does not exist yet.
	parent := filepath.Dir(joined)
	resolvedParent, err := filepath.EvalSymlinks(parent)
	if err != nil {
		resolvedParent = parent
	}
	if !isWithin(rootReal, joined) {
		return "", fmt.Errorf("%s is outside the workspace", requested)
	}
	if filepath.Clean(joined) != filepath.Clean(rootReal) && !isWithin(rootReal, resolvedParent) {
		return "", fmt.Errorf("%s is outside the workspace", requested)
	}
	return joined, nil
}

// isWithin reports whether candidate is root or below it.
func isWithin(root, candidate string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}

func sha256Bytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (s *mcpServer) workspaceReadFile(args mcpWorkspaceArgs) (string, error) {
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	path, err := secureWorkspacePath(root, args.Path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("%s not found", args.Path)
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s is a folder: use workspace_list_files", args.Path)
	}
	if info.Size() > mcpMaxFileBytes {
		return "", fmt.Errorf("%s is larger than %d bytes", args.Path, mcpMaxFileBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(data) {
		return "", fmt.Errorf("%s is not UTF-8 text (binary file)", args.Path)
	}
	return jsonText(map[string]any{
		"path": filepath.ToSlash(args.Path), "bytes": len(data), "sha256": sha256Bytes(data),
		"content": string(data),
	})
}

func (s *mcpServer) workspaceWriteFile(args mcpWorkspaceArgs) (string, error) {
	if err := s.requireWrite(); err != nil {
		return "", err
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	path, err := secureWorkspacePath(root, args.Path)
	if err != nil {
		return "", err
	}
	data := []byte(args.Content)
	if len(data) > mcpMaxFileBytes {
		return "", fmt.Errorf("the content is larger than %d bytes", mcpMaxFileBytes)
	}
	created := false
	if existing, err := os.ReadFile(path); err == nil {
		if expected := strings.TrimSpace(args.ExpectedSHA256); expected != "" && !strings.EqualFold(expected, sha256Bytes(existing)) {
			return "", fmt.Errorf("the file changed meanwhile (current sha256 %s)", sha256Bytes(existing))
		}
	} else if !os.IsNotExist(err) {
		return "", err
	} else {
		created = true
	}
	createDirs := true
	if args.CreateDirs != nil {
		createDirs = *args.CreateDirs
	}
	if err := writeFileAtomic(path, data, createDirs); err != nil {
		return "", err
	}
	s.invalidateWorkspace(root)
	return jsonText(map[string]any{
		"path": filepath.ToSlash(args.Path), "bytes": len(data), "sha256": sha256Bytes(data), "created": created,
	})
}

func (s *mcpServer) workspaceListFiles(args mcpWorkspaceArgs) (string, error) {
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	folder, err := secureWorkspacePath(root, defaultString(strings.TrimSpace(args.Path), "."))
	if err != nil {
		return "", err
	}
	info, err := os.Stat(folder)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("%s is not a folder", args.Path)
	}
	depth := args.Depth
	if depth <= 0 {
		depth = 2
	}
	if depth > 6 {
		depth = 6
	}
	limit := args.Limit
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	var entries []map[string]any
	var walk func(directory string, level int) bool
	walk = func(directory string, level int) bool {
		if level > depth {
			return true
		}
		children, err := os.ReadDir(directory)
		if err != nil {
			return true
		}
		sort.Slice(children, func(i, j int) bool {
			if children[i].IsDir() != children[j].IsDir() {
				return children[i].IsDir()
			}
			return children[i].Name() < children[j].Name()
		})
		for _, child := range children {
			name := child.Name()
			if child.IsDir() && ignoredWorkspaceDir(name) {
				continue
			}
			path := filepath.Join(directory, name)
			relative, _ := filepath.Rel(root, path)
			entry := map[string]any{"path": filepath.ToSlash(relative), "directory": child.IsDir()}
			if info, err := child.Info(); err == nil && !child.IsDir() {
				entry["bytes"] = info.Size()
			}
			entries = append(entries, entry)
			if len(entries) >= limit {
				return false
			}
			if child.IsDir() && !walk(path, level+1) {
				return false
			}
		}
		return true
	}
	walk(folder, 1)
	return jsonText(map[string]any{"folder": filepath.ToSlash(defaultString(strings.TrimSpace(args.Path), ".")), "depth": depth, "entries": entries, "truncated": len(entries) >= limit})
}

// defaultString returns value, or fallback when it is empty.
func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// ignoredWorkspaceDir keeps large generated folders out of the listing.
func ignoredWorkspaceDir(name string) bool {
	switch strings.ToLower(name) {
	case ".git", ".svn", ".hg", "node_modules", "target", "bin", "build", "out", ".gradle", ".idea", ".adomnia":
		return true
	}
	return false
}

// writeFileAtomic writes data to path through a temporary file in the same folder, creating
// parent folders when createDirs is true.
func writeFileAtomic(path string, data []byte, createDirs bool) error {
	if createDirs {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
	}
	info, err := os.Stat(path)
	mode := os.FileMode(0o644)
	if err == nil {
		mode = info.Mode().Perm()
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".adomnia-mcp-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		_ = os.Remove(name)
		return err
	}
	if err := temporary.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	_ = os.Chmod(name, mode)
	if err := os.Rename(name, path); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}
