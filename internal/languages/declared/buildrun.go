package declared

import (
	"crypto/sha256"
	"encoding/hex"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// KindBuildRun compiles one C/C++ source (and the other sources of its folder) and runs the program.
// It gives a file with main a Play action without requiring a pre-built executable.
const KindBuildRun = "build-run"

// BuildRunOptions are the LanguageOptions of a build-and-run.
type BuildRunOptions struct {
	// Source is the file with main, inside the project, relative to the working directory or absolute.
	Source string `json:"source"`
}

// mainDefinition matches a C/C++ main definition at the start of a line, not a call (`main();`).
var mainDefinition = regexp.MustCompile(`(?m)^[ \t]*(?:int[ \t]+)?main[ \t]*\([^;{)]*\)[ \t]*(?:\{|$)`)

func buildRunOptions(data jsonv1.RawMessage) (BuildRunOptions, error) {
	var options BuildRunOptions
	if len(data) > 0 {
		if err := json.Unmarshal(data, &options); err != nil {
			return options, fmt.Errorf("enter valid build and run options")
		}
	}
	options.Source = strings.TrimSpace(options.Source)
	if options.Source == "" || strings.HasPrefix(options.Source, "-") || strings.ContainsAny(options.Source, "\x00\r\n") {
		return options, fmt.Errorf("select the source file to build and run")
	}
	return options, nil
}

// buildRunCommandSpec compiles through a generated Makefile: one `make` process runs the compiler and
// then the program, so the Run console keeps a single execution and the exit code is the program's.
// The Makefile lives in the system temp folder, never in the project.
func (n nativeAdapter) buildRunCommandSpec(request run.Request) (run.CommandSpec, error) {
	options, err := buildRunOptions(request.LanguageOptions)
	if err != nil {
		return run.CommandSpec{}, err
	}
	source, err := resolveProgram(request.Root, request.WorkingDirectory, options.Source)
	if err != nil {
		return run.CommandSpec{}, err
	}
	ext := strings.ToLower(filepath.Ext(source))
	compiler, err := firstOnPath(compilerCandidates(ext))
	if err != nil {
		return run.CommandSpec{}, err
	}
	makeBinary, err := lookPath("make")
	if err != nil {
		return run.CommandSpec{}, fmt.Errorf("make is not on PATH: install GNU make to build and run C/C++ files")
	}
	sources, err := buildRunSources(source)
	if err != nil {
		return run.CommandSpec{}, err
	}
	output, makefile, err := writeBuildRunMakefile(request.Root, source, compiler, sources)
	if err != nil {
		return run.CommandSpec{}, err
	}
	workingDirectory := request.WorkingDirectory
	if workingDirectory == "" {
		workingDirectory = filepath.Dir(source)
	}
	display := compiler + " " + strings.Join(sources, " ") + " -o " + output + " && " + output
	return run.CommandSpec{
		Executable: makeBinary, Arguments: []string{"-f", makefile, "run"},
		WorkingDirectory: workingDirectory, Environment: append([]string(nil), request.Environment...),
		DisplayCommand: display,
	}, nil
}

// compilerCandidates are the compilers tried in order for a source extension.
func compilerCandidates(ext string) []string {
	switch ext {
	case ".c", ".m":
		return []string{"clang", "gcc", "cc"}
	case ".cpp", ".cc", ".cxx", ".mm":
		return []string{"clang++", "g++", "c++"}
	}
	return nil
}

func firstOnPath(candidates []string) (string, error) {
	for _, candidate := range candidates {
		if binary, err := lookPath(candidate); err == nil {
			return binary, nil
		}
	}
	if len(candidates) == 0 {
		return "", fmt.Errorf("no C or C++ compiler for this file")
	}
	return "", fmt.Errorf("%s is not on PATH: install a C/C++ compiler to build and run this file", candidates[0])
}

// buildRunSources keeps a single file for C/Objective-C; a C++ source brings the other C++ sources of
// its folder when only one of them defines main (a small multi-file program), and stands alone when
// the folder holds several programs.
func buildRunSources(source string) ([]string, error) {
	switch strings.ToLower(filepath.Ext(source)) {
	case ".cpp", ".cc", ".cxx", ".mm":
	default:
		return []string{source}, nil
	}
	entries, err := os.ReadDir(filepath.Dir(source))
	if err != nil {
		return []string{source}, nil
	}
	candidates, mains := make([]string, 0, len(entries)), 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		switch strings.ToLower(filepath.Ext(entry.Name())) {
		case ".cpp", ".cc", ".cxx", ".mm":
		default:
			continue
		}
		path := filepath.Join(filepath.Dir(source), entry.Name())
		candidates = append(candidates, path)
		if data, err := readHead(path, clangdScanBytes); err == nil && mainDefinition.Match(data) {
			mains++
		}
	}
	if len(candidates) == 0 || mains > 1 {
		return []string{source}, nil
	}
	sort.Strings(candidates)
	return candidates, nil
}

// writeBuildRunMakefile writes the generated Makefile and returns the output path and the Makefile
// path. Every source gets its own folder, so two files with the same name never collide.
func writeBuildRunMakefile(root, source, compiler string, sources []string) (output, makefile string, err error) {
	relative, relErr := filepath.Rel(root, source)
	if relErr != nil {
		relative = source
	}
	sum := sha256.Sum256([]byte(filepath.ToSlash(relative)))
	directory := filepath.Join(os.TempDir(), "adomnia-build", hex.EncodeToString(sum[:6]))
	if err = os.MkdirAll(directory, 0o755); err != nil {
		return "", "", fmt.Errorf("could not prepare the build folder: %w", err)
	}
	name := strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	output = filepath.Join(directory, name)
	parts := []string{makePath(compiler)}
	if strings.EqualFold(filepath.Ext(source), ".c") || strings.EqualFold(filepath.Ext(source), ".m") {
		parts = append(parts, "-Wno-implicit-int")
	}
	for _, item := range sources {
		parts = append(parts, makePath(item))
	}
	compilerCommand := strings.Join(append(parts, "-o", makePath(output)), " ")
	lines := []string{".PHONY: run", "run:", "\t@" + compilerCommand, "\t@" + makePath(output), ""}
	makefile = filepath.Join(directory, "Makefile")
	if err = os.WriteFile(makefile, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		return "", "", fmt.Errorf("could not write the build file: %w", err)
	}
	return output, makefile, nil
}

// makePath quotes a path for the shell make runs recipes in (MSYS sh on Windows) and escapes the
// dollar sign that Make would otherwise expand.
func makePath(path string) string {
	path = strings.ReplaceAll(filepath.ToSlash(path), "$", "$$")
	return "'" + strings.ReplaceAll(path, "'", `'\''`) + "'"
}
