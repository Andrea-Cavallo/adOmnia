package java

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

// Ant and Eclipse projects have no build tool that runs tests and writes reports. Their tests run on the
// JUnit Console Launcher (JUnit Platform, with the Vintage engine for JUnit 3/4) with the classpath the
// Java language server resolves, and the launcher's JUnit XML reports fill the shared test tree.

const (
	junitLauncherVersion = "1.11.4"
	junitLauncherTask    = "java-junit-launcher"
	junitLauncherFolder  = "junit-launcher"
	// junitReportsFolder ends like Gradle's, so the report reader recognises it.
	junitReportsFolder = "build/test-results/adomnia"
)

var (
	junitLauncherName = "junit-platform-console-standalone-" + junitLauncherVersion + ".jar"
	junitLauncherURL  = "https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/" + junitLauncherVersion + "/" + junitLauncherName
)

// JUnitLauncherJar is where the launcher is installed in adOmnia's tools folder.
func JUnitLauncherJar(toolsRoot string) string {
	return filepath.Join(toolsRoot, junitLauncherFolder, junitLauncherName)
}

// TestRunnerInstallPlan implements language.TestRunnerInstaller: one visible download from Maven Central,
// pinned, into the tools folder, never into the project.
func (*Language) TestRunnerInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("adOmnia tools folder not configured")
	}
	folder := filepath.Join(toolsRoot, junitLauncherFolder)
	chain := fmt.Sprintf("curl -fL --retry 2 -o %s %s", junitLauncherName, junitLauncherURL)
	executable, arguments := shellCommand(chain)
	return lsp.InstallPlan{
		Task: junitLauncherTask, Title: "Install the JUnit Console Launcher?", Label: "Installing JUnit launcher…",
		Note:    "Downloads the JUnit Platform Console Launcher " + junitLauncherVersion + " (about 3 MB) from Maven Central into adOmnia's own tools folder. It runs the JUnit 3, 4 and 5 tests of Ant and Eclipse projects with the classpath of the Java language server. The output appears in the Run console.",
		Command: chain, Executable: executable, Arguments: arguments, Directory: folder,
		Prepare:   func() error { return os.MkdirAll(folder, 0o755) },
		Languages: []string{ID},
	}, nil
}

// UsesServerTests reports whether the module's tests run on the launcher: an Ant or Eclipse project with no
// Maven or Gradle build.
func UsesServerTests(module string) bool {
	if _, managed := unitIn(module); managed {
		return false
	}
	if _, ant := antUnitIn(module); ant {
		return true
	}
	_, eclipse := readEclipseProject(module)
	return eclipse
}

// ServerTestClass is the class of a test file of an Ant/Eclipse module, from its source folders.
func ServerTestClass(module, file string) (string, bool) {
	absolute := file
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Join(module, filepath.FromSlash(file))
	}
	for _, folder := range antSourceFolders(module) {
		relative, err := filepath.Rel(folder, absolute)
		if err != nil || strings.HasPrefix(relative, "..") || !strings.HasSuffix(relative, ".java") {
			continue
		}
		return strings.ReplaceAll(strings.TrimSuffix(filepath.ToSlash(relative), ".java"), "/", "."), true
	}
	return "", false
}

// AnyServerTestClass is a class of the module that the language server can resolve the classpath from when
// every test runs: the first *Test source, else any source.
// fallback: JDT decide quando è ready (JS-6) — only a name to ask the server with, read from the file names.
func AnyServerTestClass(module string) (string, bool) {
	var first string
	for _, folder := range antSourceFolders(module) {
		_ = filepath.WalkDir(folder, func(path string, entry os.DirEntry, err error) error {
			if err != nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".java") {
				return nil
			}
			class, ok := ServerTestClass(module, path)
			if !ok {
				return nil
			}
			if first == "" {
				first = class
			}
			if strings.HasSuffix(strings.TrimSuffix(entry.Name(), ".java"), "Test") {
				first = class
				return filepath.SkipAll
			}
			return nil
		})
	}
	return first, first != ""
}

// EclipseProjectName is the JDT project of an Eclipse module (its .project name), "" for an Ant project
// without Eclipse metadata (the language server finds it from the class).
func EclipseProjectName(module string) string {
	project, ok := readEclipseProject(module)
	if !ok {
		return ""
	}
	return project.Name
}

// serverTestCommand runs the selected tests (or every test on the classpath folders) on the launcher.
func serverTestCommand(request idetesting.Request, options TestOptions) (run.CommandSpec, idetesting.EventParser, error) {
	if _, err := testClasses(request, options); err != nil { // the same limits and filters as Maven/Gradle
		return run.CommandSpec{}, nil, err
	}
	if len(options.ClassPaths) == 0 {
		return run.CommandSpec{}, nil, fmt.Errorf("the Java language server has not resolved the classpath of this project yet: wait for it to be ready, then run the tests again")
	}
	if options.Launcher == "" || !isFile(options.Launcher) {
		return run.CommandSpec{}, nil, fmt.Errorf("Ant and Eclipse projects run their tests on the JUnit Console Launcher: install it from Java → Install JUnit Console Launcher")
	}
	reports, err := os.MkdirTemp("", "adomnia-junit-")
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	reportsDir := filepath.Join(reports, filepath.FromSlash(junitReportsFolder))
	arguments, err := launcherArguments(request, options, reportsDir)
	if err != nil {
		_ = os.RemoveAll(reports) // nothing was started
		return run.CommandSpec{}, nil, err
	}
	argfile := filepath.Join(reports, "launcher.args")
	lines := make([]string, 0, len(arguments))
	for _, argument := range arguments {
		lines = append(lines, argfileLine(argument))
	}
	if err := os.WriteFile(argfile, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		return run.CommandSpec{}, nil, err
	}
	java := options.JavaExec
	if java == "" {
		java = "java"
	}
	parser := newReportParser(request.Root, request.WorkingDirectory)
	parser.reportsDir, parser.cleanup = reportsDir, reports
	return run.CommandSpec{
		Executable: java, Arguments: []string{"-jar", options.Launcher, "@" + argfile},
		WorkingDirectory: request.WorkingDirectory, Environment: request.Environment,
		DisplayCommand: "junit " + strings.Join(arguments[len(arguments)-countSelections(arguments):], " "),
	}, parser, nil
}

// launcherArguments are the launcher options, one per line of its argument file: the classpath is long.
func launcherArguments(request idetesting.Request, options TestOptions, reportsDir string) ([]string, error) {
	arguments := []string{
		"--disable-banner", "--details=none", "--disable-ansi-colors",
		"--class-path=" + argfilePath(strings.Join(options.ClassPaths, string(os.PathListSeparator))),
		"--reports-dir=" + argfilePath(reportsDir),
	}
	if len(options.Packages) == 0 {
		for _, folder := range options.ClassPaths {
			if isDirectory(folder) {
				arguments = append(arguments, "--scan-class-path="+argfilePath(folder))
				return arguments, nil // the project's own output folder: the libraries are not scanned
			}
		}
		return nil, fmt.Errorf("no compiled classes of the project on the classpath: build the project first")
	}
	methods := methodsOf(options.Run)
	for _, file := range options.Packages {
		if err := run.ValidateTarget(request.Root, request.WorkingDirectory, file); err != nil {
			return nil, err
		}
		class, ok := ServerTestClass(request.WorkingDirectory, file)
		if !ok {
			return nil, fmt.Errorf("%s is not in a source folder of the project", filepath.ToSlash(file))
		}
		if len(methods) == 0 {
			arguments = append(arguments, "--select-class="+class)
		}
		for _, method := range methods {
			arguments = append(arguments, "--select-method="+class+"#"+method)
		}
	}
	return arguments, nil
}

func countSelections(arguments []string) int {
	count := 0
	for _, argument := range arguments {
		if strings.HasPrefix(argument, "--select-") || strings.HasPrefix(argument, "--scan-") {
			count++
		}
	}
	return count
}

// argfilePath writes a path with forward slashes, which Java accepts on Windows too: no backslash reaches
// the launcher's argument file, where it would be an escape.
func argfilePath(path string) string { return filepath.ToSlash(path) }

// argfileLine is one argument of the launcher's argument file, quoted when it has spaces.
func argfileLine(argument string) string {
	if !strings.ContainsAny(argument, " \t") {
		return argument
	}
	return `"` + strings.ReplaceAll(argument, `"`, `\"`) + `"`
}
