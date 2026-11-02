package declared

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func writeProjectFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func clangdFallbackDirOf(args []string) string {
	for _, argument := range args {
		if directory, ok := strings.CutPrefix(argument, "--compile-commands-dir="); ok {
			return directory
		}
	}
	return ""
}

func TestClangdSuppressesImplicitIntForLegacyC(t *testing.T) {
	root, tools := t.TempDir(), t.TempDir()
	writeProjectFile(t, root, "helloworld.c", "main() {\n\treturn 0;\n}\n")

	args := clangdArguments(root, tools, []string{"--background-index"})
	directory := clangdFallbackDirOf(args)
	if directory == "" {
		t.Fatalf("legacy C project got no fallback flags: %v", args)
	}
	content, err := os.ReadFile(filepath.Join(directory, "compile_flags.txt"))
	if err != nil || string(content) != clangdFallbackFlag+"\n" {
		t.Fatalf("compile_flags.txt = %q, %v", content, err)
	}
	if !hasArgument(args, "--enable-config") {
		t.Fatalf("project .clangd files are not enabled: %v", args)
	}
}

func TestClangdLeavesTypedSourcesAlone(t *testing.T) {
	root, tools := t.TempDir(), t.TempDir()
	writeProjectFile(t, root, "main.c", "int main(void) {\n\treturn 0;\n}\n")
	writeProjectFile(t, root, "main.cpp", "int main() {\n\treturn 0;\n}\n")

	if directory := clangdFallbackDirOf(clangdArguments(root, tools, nil)); directory != "" {
		t.Fatalf("typed sources got fallback flags in %s", directory)
	}
}

func TestClangdRespectsAnExistingCompilationDatabase(t *testing.T) {
	for _, name := range []string{"compile_commands.json", "compile_flags.txt", ".clangd", "build/compile_commands.json", "cmake-build-debug/compile_commands.json"} {
		t.Run(name, func(t *testing.T) {
			root, tools := t.TempDir(), t.TempDir()
			writeProjectFile(t, root, "legacy.c", "usage() {\n}\n")
			writeProjectFile(t, root, name, "[]\n")
			if directory := clangdFallbackDirOf(clangdArguments(root, tools, nil)); directory != "" {
				t.Fatalf("%s: adOmnia overrode the project database with %s", name, directory)
			}
		})
	}
}

func TestClangdFallbackNeedsAProjectRoot(t *testing.T) {
	if directory := clangdFallbackDirOf(clangdArguments("", t.TempDir(), nil)); directory != "" {
		t.Fatalf("no root, but got %s", directory)
	}
}

func hasArgument(args []string, wanted string) bool {
	return slices.Contains(args, wanted)
}
