package declared

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// clangdFallbackFlag suppresses -Wimplicit-int. Old C code writes `main()` without a return type,
// which ISO C99+ rejects, so clangd marks every such file with an error even when the project
// declares no standard at all. The flag is valid for C and C++ and leaves other diagnostics alone.
const clangdFallbackFlag = "-Wno-implicit-int"

// implicitIntDefinition matches a function definition that starts with its name instead of a return
// type (`main() {`, `static usage() {`). Prototypes end with ';' and typed definitions start with a
// type, so neither matches.
var implicitIntDefinition = regexp.MustCompile(`(?m)^[ \t]*(?:static[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*\([^;{}]*\)[ \t]*\{`)

const (
	clangdScanFiles = 200
	clangdScanBytes = 64 << 10
)

// clangdArguments adds the flags that let clangd understand a project with no compilation database.
// A project that has its own database, a .clangd config or a compile_flags.txt is left untouched.
func clangdArguments(root, toolsRoot string, args []string) []string {
	arguments := append(append([]string(nil), args...), "--enable-config")
	if root == "" || hasClangProjectConfig(root) || !hasImplicitIntSource(root) {
		return arguments
	}
	directory, err := writeClangdFallback(root, toolsRoot)
	if err != nil {
		return arguments
	}
	return append(arguments, "--compile-commands-dir="+directory)
}

// hasClangProjectConfig reports whether the project already says how to compile its sources.
func hasClangProjectConfig(root string) bool {
	for _, name := range []string{"compile_commands.json", "compile_flags.txt", ".clangd"} {
		if info, err := os.Stat(filepath.Join(root, name)); err == nil && !info.IsDir() {
			return true
		}
	}
	// CMake puts the database in its build folder, often one of these.
	for _, directory := range []string{"build", "out", "cmake-build-debug", "cmake-build-release"} {
		if info, err := os.Stat(filepath.Join(root, directory, "compile_commands.json")); err == nil && !info.IsDir() {
			return true
		}
	}
	if matches, _ := filepath.Glob(filepath.Join(root, "cmake-build-*", "compile_commands.json")); len(matches) > 0 {
		return true
	}
	return false
}

// hasImplicitIntSource scans a bounded number of C sources for a definition without a return type.
func hasImplicitIntSource(root string) bool {
	found, scanned := false, 0
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != root && project.SkipDirectory(filepath.Dir(path), entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if scanned >= clangdScanFiles {
			return filepath.SkipAll
		}
		switch strings.ToLower(filepath.Ext(entry.Name())) {
		case ".c":
		default:
			return nil
		}
		scanned++
		data, err := readHead(path, clangdScanBytes)
		if err != nil {
			return nil
		}
		if implicitIntDefinition.Match(data) {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

func readHead(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, limit))
}

// writeClangdFallback keeps the generated compile_flags.txt in adOmnia's own folders, never in the
// project: the project is not modified and the flags disappear with adOmnia's cache.
func writeClangdFallback(root, toolsRoot string) (string, error) {
	base := toolsRoot
	if base == "" {
		cache, err := os.UserCacheDir()
		if err != nil {
			base = os.TempDir()
		} else {
			base = filepath.Join(cache, "adomnia")
		}
	}
	sum := sha256.Sum256([]byte(filepath.Clean(root)))
	directory := filepath.Join(base, "clangd", hex.EncodeToString(sum[:8]))
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return "", err
	}
	content := clangdFallbackFlag + "\n"
	path := filepath.Join(directory, "compile_flags.txt")
	if existing, err := os.ReadFile(path); err == nil && string(existing) == content {
		return directory, nil
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return directory, nil
}
