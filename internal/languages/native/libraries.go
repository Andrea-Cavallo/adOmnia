// Package native reads the external dependencies of C/C++ projects without running the build: CMake
// find_package/FetchContent/CPM, pkg-config, vcpkg manifests, Conan requires and Meson dependencies.
package native

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Declaration è una dipendenza dichiarata da un progetto C/C++.
type Declaration struct {
	Name    string
	Version string
	// Kind è "cmake", "pkgconfig", "fetchcontent", "cpm", "vcpkg", "conan" o "meson".
	Kind string
	// Manifest è il file della dichiarazione, relativo alla radice del progetto.
	Manifest string
	Line     int
	// Directory è il codice della dipendenza trovato nel progetto (FetchContent o vcpkg), "" se è
	// una libreria di sistema o non è ancora stata scaricata.
	Directory string
}

const maxManifestBytes = 1 << 20

var (
	cmakeFindPackage = regexp.MustCompile(`(?m)find_package\s*\(\s*([A-Za-z0-9_][A-Za-z0-9_.+-]*)(?:\s+([0-9][A-Za-z0-9_.+-]*))?`)
	cmakePkgModules  = regexp.MustCompile(`(?s)pkg_check_modules\s*\(\s*[A-Za-z0-9_]+\s+([^)]*)\)`)
	cmakeFetch       = regexp.MustCompile(`(?s)FetchContent_Declare\s*\(\s*([A-Za-z0-9_.+-]+)(.*?)\)`)
	cmakeCPM         = regexp.MustCompile(`(?s)CPMAddPackage\s*\((.*?)\)`)
	cmakeGitTag      = regexp.MustCompile(`(?i)\bGIT_TAG\s+"?([^"\s)]+)"?`)
	cmakeVersion     = regexp.MustCompile(`(?i)\bVERSION\s+"?([^"\s)]+)"?`)
	cmakeNameArg     = regexp.MustCompile(`(?i)\bNAME\s+"?([A-Za-z0-9_.+-]+)"?`)
	cmakeRepoArg     = regexp.MustCompile(`(?i)\b(?:GITHUB_REPOSITORY|GIT_REPOSITORY)\s+"?([^"\s)]+)"?`)
	mesonDependency  = regexp.MustCompile(`dependency\s*\(\s*["']([^"']+)["'](?:\s*,\s*version\s*:\s*["']([^"']+)["'])?`)
	conanPyRequires  = regexp.MustCompile(`(?m)(?:tool_)?requires\s*=\s*(\[[^\]]*\]|["'][^"']*["'])`)
	quoted           = regexp.MustCompile(`["']([^"']+)["']`)
)

// Declarations elenca le dipendenze dichiarate sotto la radice dell'unità. Solo filesystem e testo:
// nessun processo, nessuna configurazione del build.
func Declarations(unitRoot string) []Declaration {
	var declarations []Declaration
	_ = filepath.WalkDir(unitRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if path != unitRoot && ignoredDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		relative, relErr := filepath.Rel(unitRoot, path)
		if relErr != nil {
			return nil
		}
		relative = filepath.ToSlash(relative)
		switch {
		case entry.Name() == "CMakeLists.txt" || strings.HasSuffix(entry.Name(), ".cmake"):
			if data, readErr := readLimited(path); readErr == nil {
				declarations = append(declarations, cmakeDeclarations(string(data), relative)...)
			}
		case entry.Name() == "meson.build":
			if data, readErr := readLimited(path); readErr == nil {
				declarations = append(declarations, mesonDeclarations(string(data), relative)...)
			}
		case entry.Name() == "vcpkg.json":
			if data, readErr := readLimited(path); readErr == nil {
				declarations = append(declarations, vcpkgDeclarations(data, relative)...)
			}
		case entry.Name() == "conanfile.txt":
			if data, readErr := readLimited(path); readErr == nil {
				declarations = append(declarations, conanTextDeclarations(string(data), relative)...)
			}
		case entry.Name() == "conanfile.py":
			if data, readErr := readLimited(path); readErr == nil {
				declarations = append(declarations, conanPyDeclarations(string(data), relative)...)
			}
		}
		return nil
	})
	return merge(unitRoot, declarations)
}

// ignoredDirectory sono le cartelle generate o non del progetto (la cache di vcpkg non è un manifest).
func ignoredDirectory(name string) bool {
	switch strings.ToLower(name) {
	case ".git", ".svn", ".hg", "build", "out", "cmake-build-debug", "cmake-build-release",
		"node_modules", "vcpkg_installed", "_deps", ".cache", ".gradle", ".idea", "target", "dist":
		return true
	}
	return strings.HasPrefix(name, "cmake-build-")
}

func cmakeDeclarations(text, manifest string) []Declaration {
	var declarations []Declaration
	for _, match := range cmakeFindPackage.FindAllStringSubmatchIndex(text, -1) {
		name := text[match[2]:match[3]]
		version := ""
		if match[4] >= 0 {
			version = text[match[4]:match[5]]
		}
		declarations = append(declarations, Declaration{Name: name, Version: version, Kind: "cmake", Manifest: manifest, Line: lineAt(text, match[0])})
	}
	for _, match := range cmakePkgModules.FindAllStringSubmatchIndex(text, -1) {
		line := lineAt(text, match[0])
		for _, token := range strings.Fields(text[match[2]:match[3]]) {
			if isPkgConfigKeyword(token) {
				continue
			}
			name, version := splitConstraint(token)
			if name != "" {
				declarations = append(declarations, Declaration{Name: name, Version: version, Kind: "pkgconfig", Manifest: manifest, Line: line})
			}
		}
	}
	for _, match := range cmakeFetch.FindAllStringSubmatchIndex(text, -1) {
		name, version := text[match[2]:match[3]], firstSubmatch(cmakeGitTag, text[match[4]:match[5]])
		if version == "" {
			version = firstSubmatch(cmakeVersion, text[match[4]:match[5]])
		}
		declarations = append(declarations, Declaration{Name: name, Version: version, Kind: "fetchcontent", Manifest: manifest, Line: lineAt(text, match[0])})
	}
	for _, match := range cmakeCPM.FindAllStringSubmatchIndex(text, -1) {
		arguments := text[match[2]:match[3]]
		name := firstSubmatch(cmakeNameArg, arguments)
		if name == "" {
			if repository := firstSubmatch(cmakeRepoArg, arguments); repository != "" {
				parts := strings.FieldsFunc(repository, func(r rune) bool { return r == '/' || r == '\\' })
				if len(parts) > 0 {
					name = strings.TrimSuffix(parts[len(parts)-1], ".git")
				}
			}
		}
		if name == "" {
			continue
		}
		version := firstSubmatch(cmakeVersion, arguments)
		if version == "" {
			version = firstSubmatch(cmakeGitTag, arguments)
		}
		declarations = append(declarations, Declaration{Name: name, Version: version, Kind: "cpm", Manifest: manifest, Line: lineAt(text, match[0])})
	}
	return declarations
}

func mesonDeclarations(text, manifest string) []Declaration {
	var declarations []Declaration
	for _, match := range mesonDependency.FindAllStringSubmatchIndex(text, -1) {
		version := ""
		if match[4] >= 0 {
			version = text[match[4]:match[5]]
		}
		declarations = append(declarations, Declaration{Name: text[match[2]:match[3]], Version: version, Kind: "meson", Manifest: manifest, Line: lineAt(text, match[0])})
	}
	return declarations
}

// vcpkgDependency è una voce di dependencies: una stringa o un oggetto con nome e versione minima.
type vcpkgDependency struct {
	Name      string `json:"name"`
	VersionGE string `json:"version>="`
	Version   string `json:"version"`
}

func vcpkgDeclarations(data []byte, manifest string) []Declaration {
	var parsed struct {
		Dependencies []jsontext.Value `json:"dependencies"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil
	}
	var declarations []Declaration
	for _, raw := range parsed.Dependencies {
		var name string
		if err := json.Unmarshal(raw, &name); err == nil {
			if name != "" {
				declarations = append(declarations, Declaration{Name: name, Kind: "vcpkg", Manifest: manifest})
			}
			continue
		}
		var dependency vcpkgDependency
		if err := json.Unmarshal(raw, &dependency); err != nil || dependency.Name == "" {
			continue
		}
		version := dependency.VersionGE
		if version == "" {
			version = dependency.Version
		}
		declarations = append(declarations, Declaration{Name: dependency.Name, Version: version, Kind: "vcpkg", Manifest: manifest})
	}
	return declarations
}

func conanTextDeclarations(text, manifest string) []Declaration {
	var declarations []Declaration
	section := ""
	for index, raw := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.Trim(line, "[] "))
			continue
		}
		if section != "requires" && section != "tool_requires" && section != "build_requires" {
			continue
		}
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, version := splitConanReference(line)
		if name != "" {
			declarations = append(declarations, Declaration{Name: name, Version: version, Kind: "conan", Manifest: manifest, Line: index + 1})
		}
	}
	return declarations
}

func conanPyDeclarations(text, manifest string) []Declaration {
	var declarations []Declaration
	for _, match := range conanPyRequires.FindAllStringSubmatchIndex(text, -1) {
		body := text[match[2]:match[3]]
		for _, reference := range quoted.FindAllStringSubmatch(body, -1) {
			name, version := splitConanReference(reference[1])
			if name != "" {
				declarations = append(declarations, Declaration{Name: name, Version: version, Kind: "conan", Manifest: manifest, Line: lineAt(text, match[0])})
			}
		}
	}
	return declarations
}

// splitConanReference separa `pkg/1.2.3@user/channel`.
func splitConanReference(reference string) (string, string) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return "", ""
	}
	name, rest, _ := strings.Cut(reference, "/")
	version, _, _ := strings.Cut(rest, "@")
	return strings.TrimSpace(name), strings.TrimSpace(version)
}

// merge unisce le dichiarazioni per nome, preferendo quella con una versione e un codice trovato.
// Poi risolve FetchContent e vcpkg: sono le uniche con il codice nel progetto.
func merge(unitRoot string, declarations []Declaration) []Declaration {
	sources := SourceDirectories(unitRoot)
	merged := map[string]*Declaration{}
	order := []string{}
	for _, declaration := range declarations {
		name := declaration.Name
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		existing, known := merged[key]
		if !known {
			copy := declaration
			merged[key] = &copy
			order = append(order, key)
			continue
		}
		if existing.Version == "" && declaration.Version != "" {
			existing.Version = declaration.Version
		}
		if existing.Manifest == "" {
			existing.Manifest = declaration.Manifest
		}
		if existing.Kind == "cmake" && declaration.Kind != "cmake" {
			existing.Kind = declaration.Kind
		}
	}
	result := make([]Declaration, 0, len(order))
	for _, key := range order {
		declaration := *merged[key]
		declaration.Directory = sources[key]
		if declaration.Version == "" && declaration.Directory != "" {
			declaration.Version = VersionFromVcpkgSpdx(declaration.Directory)
		}
		result = append(result, declaration)
	}
	sort.SliceStable(result, func(i, j int) bool {
		left, right := result[i], result[j]
		if (left.Directory != "") != (right.Directory != "") {
			return left.Directory != ""
		}
		return strings.ToLower(left.Name) < strings.ToLower(right.Name)
	})
	return result
}

// SourceDirectories mappa il nome (minuscolo) al codice trovato nel progetto: `_deps/<name>-src` di
// FetchContent/CPM e `share/<name>` di vcpkg. Una sola scansione, condivisa da tutte le dichiarazioni.
func SourceDirectories(unitRoot string) map[string]string {
	sources := map[string]string{}
	_ = filepath.WalkDir(unitRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		switch strings.ToLower(entry.Name()) {
		case ".git", ".svn", ".hg", "node_modules", ".venv", "venv", "env", ".cache":
			return filepath.SkipDir
		}
		switch entry.Name() {
		case "_deps":
			addDependencySources(sources, path, "-src")
			return filepath.SkipDir
		case "vcpkg_installed":
			triplets, readErr := os.ReadDir(path)
			if readErr != nil {
				return filepath.SkipDir
			}
			for _, triplet := range triplets {
				if !triplet.IsDir() {
					continue
				}
				share := filepath.Join(path, triplet.Name(), "share")
				packages, shareErr := os.ReadDir(share)
				if shareErr != nil {
					continue
				}
				for _, pkg := range packages {
					if pkg.IsDir() {
						if _, exists := sources[strings.ToLower(pkg.Name())]; !exists {
							sources[strings.ToLower(pkg.Name())] = filepath.Join(share, pkg.Name())
						}
					}
				}
			}
			return filepath.SkipDir
		}
		return nil
	})
	return sources
}

func addDependencySources(sources map[string]string, directory, suffix string) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), suffix) {
			continue
		}
		name := strings.ToLower(entry.Name()[:len(entry.Name())-len(suffix)])
		if _, exists := sources[name]; !exists {
			sources[name] = filepath.Join(directory, entry.Name())
		}
	}
}

// SourceDirectory è il codice di una singola dipendenza, per la richiesta di apertura.
func SourceDirectory(unitRoot, name string) string {
	return SourceDirectories(unitRoot)[strings.ToLower(name)]
}

// VersionFromVcpkgSpdx legge la versione da share/<name>/vcpkg.spdx.json quando il manifest non la scrive.
func VersionFromVcpkgSpdx(directory string) string {
	data, err := readLimited(filepath.Join(directory, "vcpkg.spdx.json"))
	if err != nil {
		return ""
	}
	var document struct {
		Packages []struct {
			VersionInfo string `json:"versionInfo"`
		} `json:"packages"`
	}
	if err := json.Unmarshal(data, &document); err != nil || len(document.Packages) == 0 {
		return ""
	}
	return document.Packages[0].VersionInfo
}

func isPkgConfigKeyword(token string) bool {
	switch token {
	case "REQUIRED", "QUIET", "IMPORTED_TARGET", "GLOBAL", "NO_CMAKE_PATH", "NO_CMAKE_ENVIRONMENT_PATH", "NO_SYSTEM_ENVIRONMENT_PATH":
		return true
	}
	return false
}

func splitConstraint(token string) (string, string) {
	token = strings.TrimSpace(token)
	for index, char := range token {
		if strings.ContainsRune("<>=!", char) {
			return strings.TrimSpace(token[:index]), strings.TrimSpace(token[index:])
		}
	}
	return token, ""
}

func firstSubmatch(expression *regexp.Regexp, text string) string {
	if match := expression.FindStringSubmatch(text); match != nil {
		return strings.TrimSpace(match[1])
	}
	return ""
}

func lineAt(text string, offset int) int {
	if offset < 0 || offset > len(text) {
		return 0
	}
	return strings.Count(text[:offset], "\n") + 1
}

func readLimited(path string) ([]byte, error) {
	file, err := os.Open(path) // #nosec G304 -- read-only manifest inside the opened project
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, int64(maxManifestBytes)))
}
