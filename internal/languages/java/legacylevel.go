package java

import (
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

// unsupportedLevel is JDT's error for a compliance below the lowest it compiles
// ("Compiling for Java version '1.6' is no longer supported. Minimal supported version is '1.8'").
var unsupportedLevel = regexp.MustCompile(`no longer supported\. Minimal supported version is '([\d.]+)'`)

// legacyLevelRepair keeps Java 6/7 projects alive in JDT LS. m2e, Buildship and the Eclipse importer
// give the project its declared level, which JDT no longer compiles: every file would show only that
// error. The repair raises the level of JDT LS's own model to the minimum it supports (Java 6/7 sources
// are valid 1.8, as in the PDE and WTP shadows); the files and the real build keep the project's level.
// m2e resets the level on re-import, the error comes back and the repair runs again.
func legacyLevelRepair(uri string, diagnostics []lsp.Diagnostic) (lsp.DiagnosticsRepair, bool) {
	level := ""
	for _, diagnostic := range diagnostics {
		if match := unsupportedLevel.FindStringSubmatch(diagnostic.Message); match != nil {
			level = match[1]
			break
		}
	}
	if level == "" {
		return lsp.DiagnosticsRepair{}, false
	}
	project := projectFolderOf(pathFromFileURI(uri))
	if project == "" {
		return lsp.DiagnosticsRepair{}, false
	}
	return lsp.DiagnosticsRepair{
		Key: project, Command: "java.project.updateSettings",
		Arguments: []any{lsp.FileURI(project), map[string]string{
			"org.eclipse.jdt.core.compiler.compliance":             level,
			"org.eclipse.jdt.core.compiler.source":                 level,
			"org.eclipse.jdt.core.compiler.codegen.targetPlatform": level,
		}},
	}, true
}

// projectFolderOf is the nearest folder, from path upwards, that JDT imports as a project.
func projectFolderOf(path string) string {
	if path == "" {
		return ""
	}
	for dir := filepath.Dir(path); ; dir = filepath.Dir(dir) {
		for _, marker := range []string{"pom.xml", "build.gradle", "build.gradle.kts", ".project"} {
			if info, err := os.Stat(filepath.Join(dir, marker)); err == nil && !info.IsDir() {
				return dir
			}
		}
		if parent := filepath.Dir(dir); parent == dir {
			return ""
		}
	}
}

func pathFromFileURI(uri string) string {
	parsed, err := url.Parse(uri)
	if err != nil || parsed.Scheme != "file" {
		return ""
	}
	path := parsed.Path
	if len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	return filepath.FromSlash(strings.TrimSuffix(path, "/"))
}
