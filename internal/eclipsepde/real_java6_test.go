package eclipsepde

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// The whole flow on the real tools: the Eclipse compiler of a Kepler target on a real Java 6.
// Opt-in: ADOMNIA_TEST_KEPLER=<eclipse folder>, ADOMNIA_TEST_JDK6=<JDK 6 home>.
func realJava6(t *testing.T) (kepler, java string) {
	t.Helper()
	kepler, home := os.Getenv("ADOMNIA_TEST_KEPLER"), os.Getenv("ADOMNIA_TEST_JDK6")
	if kepler == "" || home == "" {
		t.Skip("ADOMNIA_TEST_KEPLER and ADOMNIA_TEST_JDK6 are not set")
	}
	return kepler, filepath.Join(home, "bin", "java")
}

// runCompile runs one planned step as the app does and returns the problems the parser finds.
func runCompile(t *testing.T, java string, step CompileStep) ([]run.Diagnostic, string) {
	t.Helper()
	if err := step.Prepare(); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(java, step.Arguments...)
	command.Dir = step.Directory
	output, _ := command.CombinedOutput() // the compiler exits non-zero on errors: the parser decides
	parse := EcjDiagnostics()
	var found []run.Diagnostic
	for line := range strings.Lines(string(output)) {
		if diagnostic, ok := parse(line); ok {
			found = append(found, diagnostic)
		}
	}
	return found, string(output)
}

func TestRealKeplerCompilerOnJava6(t *testing.T) {
	kepler, java := realJava6(t)
	begin := time.Now()
	defer func() { t.Logf("total: %v", time.Since(begin).Round(time.Millisecond)) }()
	root := t.TempDir()
	writeProject(t, root, "core", bundleManifest("core", "Bundle-RequiredExecutionEnvironment: JavaSE-1.6", "Export-Package: core"), map[string]string{
		".classpath":              sourcesClasspath,
		"src/core/Greet.java":     "package core;\npublic class Greet { public static String hello() { return \"ciao\"; } }\n",
		"src/core/res.properties": "a=1\n",
	})
	writeProject(t, root, "app", bundleManifest("app", "Bundle-RequiredExecutionEnvironment: JavaSE-1.6", "Bundle-Activator: app.Activator", "Require-Bundle: core, org.eclipse.core.runtime, org.eclipse.swt", "Import-Package: org.osgi.framework, javax.xml.parsers"), map[string]string{
		".classpath": sourcesClasspath,
		// Compiles against the SWT fragment: the org.eclipse.swt host holds no classes.
		"src/app/UsesSwt.java": "package app;\npublic class UsesSwt { int style = org.eclipse.swt.SWT.BORDER; }\n",
		"src/app/Activator.java": `package app;
import org.osgi.framework.*;
public class Activator implements BundleActivator {
  public void start(BundleContext context) throws Exception {
    javax.xml.parsers.DocumentBuilderFactory.newInstance();
    String swt = "no";
    try { Class.forName("org.eclipse.swt.SWT"); swt = "yes"; } catch (ClassNotFoundException missing) { swt = "no"; }
    org.eclipse.core.runtime.Path path = new org.eclipse.core.runtime.Path("a/b");
    System.out.println("` + startedMarker + ` " + core.Greet.hello() + " " + path.segmentCount() + " java=" + System.getProperty("java.version") + " swt=" + swt);
  }
  public void stop(BundleContext context) {}
}
`,
	})
	if _, err := SetTarget(root, kepler); err != nil {
		t.Fatal(err)
	}
	t.Logf("set target: %v", time.Since(begin).Round(time.Millisecond))
	plan, err := PlanBuild(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("plan: %v", time.Since(begin).Round(time.Millisecond))
	for _, problem := range plan.Problems {
		if problem.Severity == "error" {
			t.Errorf("plan problem: %s", problem)
		}
	}
	for _, step := range plan.Steps {
		found, output := runCompile(t, java, step)
		if len(found) != 0 || strings.Contains(output, "ERROR") {
			t.Fatalf("%s must compile:\n%s", step.Bundle, output)
		}
		if problems := step.BytecodeProblems(); len(problems) != 0 {
			t.Fatalf("bytecode: %v", problems)
		}
	}
	t.Logf("compiled: %v", time.Since(begin).Round(time.Millisecond))
	class, err := os.ReadFile(filepath.Join(root, "app", "bin", "app", "Activator.class"))
	if err != nil {
		t.Fatal(err)
	}
	if major, err := ClassFileVersion(class); err != nil || major != 50 {
		t.Fatalf("class version = %d, %v; want 50 (Java 6)", major, err)
	}
	if !fileExists(filepath.Join(root, "core", "bin", "core", "res.properties")) {
		t.Fatal("resources were not copied")
	}

	// The same bundles must run in Equinox on the same JVM.
	launch, err := PrepareLaunch(root, LaunchJVM{Major: 6, Arch: "x86_64"}) // the Zulu JDK of this test
	if err != nil {
		t.Fatal(err)
	}
	for _, problem := range launch.Problems {
		t.Logf("launch problem: %s", problem)
	}
	started := time.Now()
	seen := waitForFramework(t, java, launch)
	t.Logf("framework start: %v", time.Since(started).Round(time.Millisecond))
	t.Log(seen[:min(len(seen), 2500)])
	if !strings.Contains(seen, startedMarker+" ciao 2 java=1.6") {
		t.Fatalf("unexpected start line:\n%s", seen)
	}
	// SWT loads only if the target has its fragment for the architecture of this JVM, and the warning says so.
	warned := slices.ContainsFunc(launch.Problems, func(problem Problem) bool { return problem.Project == "org.eclipse.swt" })
	if want := map[bool]string{true: "swt=no", false: "swt=yes"}[warned]; !strings.Contains(seen, want) {
		t.Fatalf("warned=%v, want %s:\n%s", warned, want, seen)
	}
}

// Java 6 is the point of all this: newer syntax and newer APIs must fail, with clickable errors.
func TestRealKeplerCompilerRejectsWhatJava6DoesNotHave(t *testing.T) {
	kepler, java := realJava6(t)
	root := t.TempDir()
	writeProject(t, root, "legacy", bundleManifest("legacy", "Bundle-RequiredExecutionEnvironment: JavaSE-1.6"), map[string]string{
		".classpath":             sourcesClasspath,
		"src/legacy/Syntax.java": "package legacy;\nimport java.util.*;\npublic class Syntax {\n  List<String> list = new ArrayList<>();\n}\n",
		"src/legacy/Api.java":    "package legacy;\npublic class Api {\n  java.nio.file.Path path;\n}\n",
		"src/legacy/Plain.java":  "package legacy;\npublic class Plain {\n  int missing() { return nope; }\n}\n",
	})
	if _, err := SetTarget(root, kepler); err != nil {
		t.Fatal(err)
	}
	plan, err := PlanBuild(root, 6)
	if err != nil {
		t.Fatal(err)
	}
	found, output := runCompile(t, java, plan.Steps[0])
	t.Log(output)
	lineOf := func(file string) int {
		index := slices.IndexFunc(found, func(d run.Diagnostic) bool { return strings.HasSuffix(d.File, file) && d.Severity == 1 })
		if index < 0 {
			t.Fatalf("no error in %s:\n%s", file, output)
		}
		if !filepath.IsAbs(found[index].File) {
			t.Fatalf("the path must be absolute to be clickable: %q", found[index].File)
		}
		return found[index].Line
	}
	for file, line := range map[string]int{"Syntax.java": 4, "Api.java": 3, "Plain.java": 3} {
		if got := lineOf(file); got != line {
			t.Errorf("%s: error at line %d, want %d", file, got, line)
		}
	}
}

// waitForFramework starts the framework and returns its output up to the bundle's start line.
func waitForFramework(t *testing.T, java string, launch *Launch) string {
	t.Helper()
	command := exec.Command(java, launch.Arguments...)
	command.Dir = launch.Directory
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = command.Stdout
	// The console reads stdin: without an open one it would stop at once.
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stdin.Close() }() // the process is killed right after
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = command.Process.Kill() }() // osgi.noShutdown: the framework never exits by itself
	lines := make(chan string)
	go func() {
		defer close(lines)
		reader := bufio.NewReader(stdout)
		for {
			line, err := reader.ReadString('\n')
			if line != "" {
				lines <- line
			}
			if err != nil {
				if err != io.EOF {
					t.Log(err)
				}
				return
			}
		}
	}()
	var seen bytes.Buffer
	timeout := time.After(90 * time.Second)
	for {
		select {
		case line, open := <-lines:
			if !open {
				t.Fatalf("the framework exited:\n%s", seen.String())
			}
			seen.WriteString(line)
			if strings.Contains(line, startedMarker) {
				return seen.String()
			}
		case <-timeout:
			t.Fatalf("the bundle did not start:\n%s", seen.String())
		}
	}
}
