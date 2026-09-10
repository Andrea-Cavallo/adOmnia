// Package sourcemap resolves a stack-trace frame to a file inside a
// repository the user chose, and opens it at the right line in their editor.
//
// A stack trace records the path of the build machine, not of this machine:
// /home/ci/app/internal/orders/service.go rarely exists locally, while its
// tail internal/orders/service.go usually does. Resolution is therefore a
// suffix match against a user-selected root, never a blind path open.
package sourcemap

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Walking a monorepo is cheap only if it stays bounded.
const maxVisitedFiles = 120_000

var skippedDirs = map[string]bool{
	".git": true, "node_modules": true, "vendor": true, "target": true,
	"build": true, "dist": true, ".gradle": true, ".idea": true, ".venv": true,
	"__pycache__": true, ".next": true, "bin": true, "obj": true,
}

type resolveRequest struct {
	Roots []string `json:"roots"`
	// Repository-relative candidates, longest (most specific) first.
	Candidates []string `json:"candidates"`
}

type ResolveResult struct {
	Found bool   `json:"found"`
	Path  string `json:"path"`
	Root  string `json:"root"`
	// Candidate that matched, so the UI can explain an approximate hit.
	Matched string `json:"matched"`
	// Other files that matched the same candidate: the choice is not certain.
	Ambiguous []string `json:"ambiguous"`
	Error     string   `json:"error"`
}

type openRequest struct {
	Roots []string `json:"roots"`
	Path  string   `json:"path"`
	Line  int      `json:"line"`
	// Editor command template, e.g. `code -g {file}:{line}`. Empty uses the OS
	// default handler, which cannot jump to a line.
	Editor string `json:"editor"`
}

type indexEntry struct {
	root  string
	files []string
}

var (
	indexMu sync.Mutex
	indexes = map[string]indexEntry{}
)

func normalize(path string) string {
	return strings.ReplaceAll(path, "\\", "/")
}

// indexRoot lists the files under root once and caches the result. The cache
// is per root and cleared by ClearIndex, so a rebuilt checkout is not stale
// forever.
func indexRoot(root string) ([]string, error) {
	clean := filepath.Clean(root)
	info, err := os.Stat(clean)
	if err != nil {
		return nil, fmt.Errorf("repository %q is not reachable: %w", root, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("repository %q is not a directory", root)
	}

	indexMu.Lock()
	cached, ok := indexes[clean]
	indexMu.Unlock()
	if ok {
		return cached.files, nil
	}

	var files []string
	visited := 0
	err = filepath.WalkDir(clean, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil // an unreadable directory must not abort the whole scan
		}
		if entry.IsDir() {
			if path != clean && skippedDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		visited++
		if visited > maxVisitedFiles {
			return errors.New("too many files")
		}
		files = append(files, normalize(path))
		return nil
	})
	if err != nil && err.Error() != "too many files" {
		return nil, err
	}

	indexMu.Lock()
	indexes[clean] = indexEntry{root: clean, files: files}
	indexMu.Unlock()
	return files, nil
}

// ClearIndex drops the cached file list of every root.
func ClearIndex() {
	indexMu.Lock()
	indexes = map[string]indexEntry{}
	indexMu.Unlock()
}

// Resolve returns the first file under one of the roots whose path ends with
// one of the candidates. Candidates must be ordered from most to least
// specific; ambiguous hits are reported instead of being silently picked.
func Resolve(roots, candidates []string) ResolveResult {
	if len(roots) == 0 {
		return ResolveResult{Error: "no repository selected"}
	}
	var lastErr string
	for _, candidate := range candidates {
		suffix := "/" + strings.TrimPrefix(normalize(candidate), "/")
		if suffix == "/" {
			continue
		}
		var matches []string
		var matchedRoot string
		for _, root := range roots {
			files, err := indexRoot(root)
			if err != nil {
				lastErr = err.Error()
				continue
			}
			for _, file := range files {
				if strings.HasSuffix(file, suffix) {
					matches = append(matches, file)
					if matchedRoot == "" {
						matchedRoot = filepath.Clean(root)
					}
				}
			}
		}
		if len(matches) > 0 {
			return ResolveResult{
				Found:     true,
				Path:      matches[0],
				Root:      matchedRoot,
				Matched:   candidate,
				Ambiguous: matches[1:],
			}
		}
	}
	return ResolveResult{Error: lastErr}
}

func withinRoots(path string, roots []string) bool {
	target, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	for _, root := range roots {
		base, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		relative, err := filepath.Rel(base, target)
		if err != nil {
			continue
		}
		if relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func osOpenCommand(path string) *exec.Cmd {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path)
	case "linux":
		return exec.Command("xdg-open", path)
	default:
		return exec.Command("cmd", "/c", "start", "", path)
	}
}

// editorCommand expands {file} and {line} in the template. The template is
// split on spaces: it configures an editor invocation, not a shell.
func editorCommand(template, path string, line int) (*exec.Cmd, error) {
	fields := strings.Fields(template)
	if len(fields) == 0 {
		return nil, errors.New("empty editor command")
	}
	args := make([]string, 0, len(fields)-1)
	for _, field := range fields[1:] {
		field = strings.ReplaceAll(field, "{file}", path)
		field = strings.ReplaceAll(field, "{line}", fmt.Sprint(line))
		args = append(args, field)
	}
	return exec.Command(fields[0], args...), nil
}

// Open launches the configured editor on path:line. The path must live inside
// one of the roots the user selected — a stack trace is untrusted input.
func Open(roots []string, path string, line int, editor string) error {
	if path == "" {
		return errors.New("no file to open")
	}
	if !withinRoots(path, roots) {
		return fmt.Errorf("%q is outside the selected repositories", path)
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("file not found: %w", err)
	}
	cmd, err := editorCommand(editor, path, line)
	if err != nil {
		cmd = osOpenCommand(path)
	}
	hideConsole(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not launch the editor: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// RegisterHandlers wires the source-mapping endpoints onto the local sidecar.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/sourcemap/resolve", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, ResolveResult{Error: "POST required"})
			return
		}
		var request resolveRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeJSON(w, http.StatusBadRequest, ResolveResult{Error: "invalid request"})
			return
		}
		writeJSON(w, http.StatusOK, Resolve(request.Roots, request.Candidates))
	})

	mux.HandleFunc("/sourcemap/open", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
			return
		}
		var request openRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		if err := Open(request.Roots, request.Path, request.Line, request.Editor); err != nil {
			writeJSON(w, http.StatusOK, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"error": ""})
	})

	mux.HandleFunc("/sourcemap/reindex", func(w http.ResponseWriter, r *http.Request) {
		ClearIndex()
		writeJSON(w, http.StatusOK, map[string]string{"error": ""})
	})
}
