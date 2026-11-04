package eclipsepde

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

func bundleManifest(name string, headers ...string) string {
	return "Manifest-Version: 1.0\nBundle-ManifestVersion: 2\nBundle-SymbolicName: " + name + "\nBundle-Version: 1.0.0\n" + strings.Join(headers, "\n") + "\n"
}

const sourcesClasspath = `<classpath><classpathentry kind="src" path="src"/><classpathentry kind="output" path="bin"/></classpath>`

// keplerWorkspace is a workspace of two bundles, app depending on core, on a target with
// the Eclipse compiler, the framework, an unrelated bundle and SWT with a fragment per platform.
func keplerWorkspace(t *testing.T) (root, target string) {
	t.Helper()
	root, target = t.TempDir(), t.TempDir()
	writeProject(t, root, "app", bundleManifest("app", "Bundle-RequiredExecutionEnvironment: JavaSE-1.6", "Require-Bundle: core, org.eclipse.swt", "Import-Package: javax.xml.parsers"),
		map[string]string{".classpath": sourcesClasspath, "src/App.java": "class App {}", "src/app.properties": "a=1", "lib/own.jar": "x"})
	writeProject(t, root, "core", bundleManifest("core", "Bundle-RequiredExecutionEnvironment: J2SE-1.5, JavaSE-1.6", "Export-Package: core"),
		map[string]string{".classpath": sourcesClasspath, "src/Core.java": "class Core {}"})
	writeJar(t, filepath.Join(target, "plugins", "org.eclipse.jdt.core_3.9.2.jar"), bundleManifest("org.eclipse.jdt.core"))
	writeJar(t, filepath.Join(target, "plugins", "org.eclipse.osgi_3.9.1.jar"), bundleManifest("org.eclipse.osgi"))
	writeJar(t, filepath.Join(target, "plugins", "unrelated_1.0.0.jar"), bundleManifest("unrelated"))
	writeJar(t, filepath.Join(target, "plugins", "org.eclipse.swt_3.102.jar"), bundleManifest("org.eclipse.swt"))
	here := p2Environment(false)["osgi.os"]
	writeJar(t, filepath.Join(target, "plugins", "swt.here.jar"), bundleManifest("swt.here", "Fragment-Host: org.eclipse.swt", "Eclipse-PlatformFilter: (osgi.os="+here+")"))
	writeJar(t, filepath.Join(target, "plugins", "swt.other.jar"), bundleManifest("swt.other", "Fragment-Host: org.eclipse.swt", "Eclipse-PlatformFilter: (osgi.os=none)"))
	if _, err := SetTarget(root, target); err != nil {
		t.Fatal(err)
	}
	return root, target
}

func argumentAfter(t *testing.T, arguments []string, flag string) string {
	t.Helper()
	index := slices.Index(arguments, flag)
	if index < 0 || index+1 == len(arguments) {
		t.Fatalf("%s not in %v", flag, arguments)
	}
	return arguments[index+1]
}

func TestPlanBuildCompilesDependenciesFirstAtTheBundleLevel(t *testing.T) {
	root, target := keplerWorkspace(t)
	plan, err := PlanBuild(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Steps) != 2 || plan.Steps[0].Bundle != "core" || plan.Steps[1].Bundle != "app" {
		t.Fatalf("order = %+v", plan.Steps)
	}
	core, app := plan.Steps[0], plan.Steps[1]
	if !slices.Contains(core.Arguments, "-1.5") || !slices.Contains(app.Arguments, "-1.6") {
		t.Fatalf("levels: core %v, app %v", core.Arguments, app.Arguments)
	}
	if got := argumentAfter(t, app.Arguments, "-cp"); got != filepath.Join(target, "plugins", "org.eclipse.jdt.core_3.9.2.jar") {
		t.Fatalf("compiler = %s", got)
	}
	classpath := filepath.SplitList(argumentAfter(t, app.Arguments, "-classpath"))
	want := []string{
		filepath.Join(root, "core", "bin"),
		filepath.Join(target, "plugins", "org.eclipse.swt_3.102.jar"),
		filepath.Join(target, "plugins", "swt.here.jar"),
	}
	for _, path := range want {
		if !slices.Contains(classpath, path) {
			t.Errorf("classpath misses %s: %v", path, classpath)
		}
	}
	for _, path := range classpath {
		if strings.Contains(path, "unrelated") || strings.Contains(path, "swt.other") {
			t.Errorf("classpath has %s, which the bundle does not require", path)
		}
	}
	for _, problem := range plan.Problems {
		if problem.Severity == "error" {
			t.Errorf("unexpected problem: %s", problem)
		}
	}
}

func TestPlanBuildFailsFastWithAReasonTheUserCanActOn(t *testing.T) {
	root, target := keplerWorkspace(t)
	if _, err := PlanBuild(root, 21); err == nil || !strings.Contains(err.Error(), "Select JDK") {
		t.Fatalf("Java 21: %v", err)
	}
	if err := os.Remove(filepath.Join(target, "plugins", "org.eclipse.jdt.core_3.9.2.jar")); err != nil {
		t.Fatal(err)
	}
	if _, err := PlanBuild(root, 6); err == nil || !strings.Contains(err.Error(), compilerBundle) {
		t.Fatalf("no compiler: %v", err)
	}
	if _, err := PlanBuild(t.TempDir(), 6); err == nil || !strings.Contains(err.Error(), "target platform") {
		t.Fatalf("no target: %v", err)
	}
}

func TestOutputFolderStaysInTheProject(t *testing.T) {
	for _, output := range []string{"../../elsewhere", "."} {
		project := &EclipseProject{Name: "p", Dir: t.TempDir(), ClasspathEntries: []ClasspathEntry{{Kind: "output", Path: output}}}
		if _, err := project.outputFolder(); err == nil {
			t.Errorf("output %q must be refused: the build writes there", output)
		}
	}
}

func TestSourceFoldersIgnoreOtherProjectsAndFolderEscapes(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	project := &EclipseProject{Dir: dir, ClasspathEntries: []ClasspathEntry{{Kind: "src", Path: "src"}, {Kind: "src", Path: "/other"}, {Kind: "src", Path: "../x"}, {Kind: "output", Path: "bin"}}}
	if got := project.sourceFolders(); len(got) != 1 || got[0] != filepath.Join(dir, "src") {
		t.Fatalf("source folders = %v", got)
	}
	noSources := &EclipseProject{Dir: dir, ClasspathEntries: []ClasspathEntry{{Kind: "output", Path: "bin"}}}
	if got := noSources.sourceFolders(); len(got) != 0 {
		t.Fatalf("a project without source folders must not compile its root: %v", got)
	}
}

func TestPrepareCopiesResourcesNotSources(t *testing.T) {
	root, _ := keplerWorkspace(t)
	plan, err := PlanBuild(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	app := plan.Steps[1]
	if err := app.Prepare(); err != nil {
		t.Fatal(err)
	}
	if !fileExists(filepath.Join(app.Output, "app.properties")) || fileExists(filepath.Join(app.Output, "App.java")) {
		t.Fatal("the output folder must get the resources and not the sources")
	}
}

func TestBytecodeProblemsFindClassesAboveTheBundleLevel(t *testing.T) {
	output := t.TempDir()
	writeClassFile(t, filepath.Join(output, "Old.class"), 50)
	writeClassFile(t, filepath.Join(output, "New.class"), 52)
	problems := CompileStep{Bundle: "app", Output: output, Environment: "JavaSE-1.6"}.BytecodeProblems()
	if len(problems) != 1 || !strings.Contains(problems[0], "New.class") {
		t.Fatalf("problems = %v", problems)
	}
}

// The output below is what the Eclipse compiler really prints.
func TestEcjDiagnosticsReadTheRealOutput(t *testing.T) {
	output := "----------\r\n" +
		"1. ERROR in C:\\work\\src\\Foo.java (at line 3)\r\n" +
		"\tString s = 1;\r\n" +
		"\t           ^\r\n" +
		"Type mismatch: cannot convert from int to String\r\n" +
		"----------\r\n" +
		"2. WARNING in C:\\work\\src\\Foo.java (at line 4)\r\n" +
		"\treturn missing;\r\n" +
		"\t       ^^^^^^^\r\n" +
		"missing cannot be resolved to a variable\r\n" +
		"----------\r\n" +
		"2 problems (1 error, 1 warning)\r\n"
	parse := EcjDiagnostics()
	var found []run.Diagnostic
	for line := range strings.Lines(output) {
		if diagnostic, ok := parse(line); ok {
			found = append(found, diagnostic)
		}
	}
	want := []run.Diagnostic{
		{File: `C:\work\src\Foo.java`, Line: 3, Column: 1, Severity: 1, Message: "Type mismatch: cannot convert from int to String", Source: "ecj"},
		{File: `C:\work\src\Foo.java`, Line: 4, Column: 1, Severity: 2, Message: "missing cannot be resolved to a variable", Source: "ecj"},
	}
	if !slices.Equal(found, want) {
		t.Fatalf("found %+v", found)
	}
}

func TestPrepareLaunchRefusesBundlesNotCompiled(t *testing.T) {
	root, _ := keplerWorkspace(t)
	if _, err := PrepareLaunch(root, 6); err == nil || !strings.Contains(err.Error(), "build the bundles first") {
		t.Fatalf("err = %v", err)
	}
}

func TestPrepareLaunchWritesTheEquinoxConfiguration(t *testing.T) {
	root, target := keplerWorkspace(t)
	for _, bundle := range []string{"app", "core"} {
		if err := os.MkdirAll(filepath.Join(root, bundle, "bin"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	launch, err := PrepareLaunch(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	if got := argumentAfter(t, launch.Arguments, "-jar"); got != filepath.Join(target, "plugins", "org.eclipse.osgi_3.9.1.jar") {
		t.Fatalf("framework = %s", got)
	}
	folder := filepath.Join(root, filepath.FromSlash(launchFolder))
	config, err := os.ReadFile(filepath.Join(folder, "configuration", "config.ini"))
	if err != nil {
		t.Fatal(err)
	}
	text := strings.ReplaceAll(string(config), `\:`, ":")
	if !strings.Contains(text, filepath.ToSlash(filepath.Join(root, "app"))+"@start") {
		t.Errorf("the workspace bundle must start by itself: %s", text)
	}
	if here := filepath.ToSlash(filepath.Join(target, "plugins", "swt.here.jar")); !strings.Contains(text, here) || strings.Contains(text, here+"@") {
		t.Errorf("the fragment of this platform must be installed and not started: %s", text)
	}
	for _, absent := range []string{"unrelated", "swt.other", "org.eclipse.osgi_3.9.1"} {
		if strings.Contains(text, absent) {
			t.Errorf("config.ini must not list %s: %s", absent, text)
		}
	}
	dev, err := os.ReadFile(filepath.Join(folder, "dev.properties"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(dev), "app=bin") || !strings.Contains(string(dev), "@ignoredot@=true") {
		t.Errorf("dev.properties = %s", dev)
	}
	if ignore, err := os.ReadFile(filepath.Join(folder, ".gitignore")); err != nil || string(ignore) != "*\n" {
		t.Errorf("the configuration has local paths and must stay out of Git: %q, %v", ignore, err)
	}
}

func TestEscapePropertyKeepsPathsReadableByJava(t *testing.T) {
	if got := escapeProperty(`reference:file:C:/Users/André/a=b.jar@1:start`); got != `reference\:file\:C\:/Users/Andr\u00e9/a\=b.jar@1\:start` {
		t.Fatalf("escaped = %s", got)
	}
}

func TestRequiredEnvironmentIsTheHighestCompileLevel(t *testing.T) {
	root, _ := keplerWorkspace(t)
	if got := RequiredEnvironment(root); got != "JavaSE-1.6" {
		t.Fatalf("environment = %q", got)
	}
	if !HasBundles(root) || HasBundles(t.TempDir()) {
		t.Fatal("HasBundles")
	}
}

func TestPrepareLaunchRefusesAJVMTheFrameworkCannotUse(t *testing.T) {
	root, _ := keplerWorkspace(t)
	if _, err := PrepareLaunch(root, 17); err == nil || !strings.Contains(err.Error(), "Select JDK") {
		t.Fatalf("err = %v", err)
	}
}

func TestCopyResourcesStaysInsideTheOutputFolder(t *testing.T) {
	source, output, outside := t.TempDir(), t.TempDir(), t.TempDir()
	writeText(t, filepath.Join(source, "pkg", "app.properties"), "a=1")
	if err := os.Symlink(outside, filepath.Join(output, "pkg")); err != nil {
		t.Skipf("symlinks are not available: %v", err)
	}
	if err := copyResources(source, output); err == nil {
		t.Fatal("a link in the output folder must stop the copy")
	}
	if fileExists(filepath.Join(outside, "app.properties")) {
		t.Fatal("the copy followed a link out of the output folder")
	}
}

func TestCopyResourcesSkipsLinksAmongTheSources(t *testing.T) {
	source, output := t.TempDir(), t.TempDir()
	secret := filepath.Join(t.TempDir(), "secret.txt")
	writeText(t, secret, "secret")
	if err := os.Symlink(secret, filepath.Join(source, "linked.txt")); err != nil {
		t.Skipf("symlinks are not available: %v", err)
	}
	if err := copyResources(source, output); err != nil {
		t.Fatal(err)
	}
	if fileExists(filepath.Join(output, "linked.txt")) {
		t.Fatal("a file from outside the project reached the output folder")
	}
}
