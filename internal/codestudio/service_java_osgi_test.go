package codestudio

import (
	"archive/zip"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/idetest"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

func TestJavaOsgiNeedsTrustThenPersistsTheTarget(t *testing.T) {
	root := t.TempDir()
	target := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)

	if _, err := service.JavaOsgiWorkspace(id); err == nil {
		t.Fatal("an untrusted project must not read the target platform")
	}
	if _, err := service.SetJavaOsgiTarget(id, target); err == nil {
		t.Fatal("an untrusted project must not write the target settings")
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(eclipsepde.TargetSettingsFile))); !os.IsNotExist(err) {
		t.Fatalf("settings written for an untrusted project: %v", err)
	}

	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetJavaOsgiTarget(id, target); err != nil {
		t.Fatal(err)
	}
	report, err := service.JavaOsgiWorkspace(id)
	if err != nil {
		t.Fatal(err)
	}
	if !report.HasTarget || report.TargetPath != target {
		t.Fatalf("report = %+v", report)
	}
}

// fakeJVM compiles a stand-in for java: it prints a compiler error on the source folder it gets, as ecj does.
func fakeJVM(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	source := filepath.Join(t.TempDir(), "main.go")
	program := `package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	source := os.Args[len(os.Args)-1]
	fmt.Fprintf(os.Stderr, "----------\n1. ERROR in %s (at line 1)\n\tclass A {}\n\t^\nboom in %s\n----------\n", filepath.Join(source, "A.java"), filepath.Base(filepath.Dir(source)))
	os.Exit(255)
}
`
	if err := os.WriteFile(source, []byte(program), 0o644); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(home, "bin", sdk.ExecutableName("java"))
	if output, err := exec.Command("go", "build", "-o", binary, source).CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, output)
	}
	if err := os.WriteFile(filepath.Join(home, "release"), []byte(`JAVA_VERSION="1.6.0_119"`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return home
}

func writeOsgiBundle(t *testing.T, root, name string, headers ...string) {
	t.Helper()
	files := map[string]string{
		".project":             "<projectDescription><name>" + name + "</name></projectDescription>",
		".classpath":           `<classpath><classpathentry kind="src" path="src"/><classpathentry kind="output" path="bin"/></classpath>`,
		"src/A.java":           "class A {}\n",
		"META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nBundle-ManifestVersion: 2\nBundle-SymbolicName: " + name + "\nBundle-Version: 1.0.0\nBundle-RequiredExecutionEnvironment: JavaSE-1.6\n" + strings.Join(headers, "\n") + "\n",
	}
	for path, text := range files {
		idetest.WriteFile(t, filepath.Join(root, name), path, text)
	}
}

func writeOsgiTarget(t *testing.T) string {
	t.Helper()
	target := t.TempDir()
	file, err := os.Create(filepath.Join(target, "org.eclipse.jdt.core_3.9.2.jar"))
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	entry, err := archive.Create("META-INF/MANIFEST.MF")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("Manifest-Version: 1.0\nBundle-SymbolicName: org.eclipse.jdt.core\nBundle-Version: 3.9.2\n")); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return target
}

func TestJavaOsgiBuildChainsBundlesAndKeepsEveryError(t *testing.T) {
	root := t.TempDir()
	writeOsgiBundle(t, root, "core", "Export-Package: core")
	writeOsgiBundle(t, root, "app", "Require-Bundle: core")
	events := make(chan EventEnvelope, 256)
	service := NewService(&memoryStore{}, func(event EventEnvelope) {
		select {
		case events <- event:
		default: // only the build events matter, and they are few
		}
	})
	defer service.Shutdown()
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.StartJavaOsgiBuild(id); err == nil {
		t.Fatal("an untrusted project must not start the compiler")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartJavaOsgiBuild(id); err == nil || !strings.Contains(err.Error(), "Select JDK") {
		t.Fatalf("without a JVM: %v", err)
	}
	if err := service.SetJavaJDK(id, fakeJVM(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetJavaOsgiTarget(id, writeOsgiTarget(t)); err != nil {
		t.Fatal(err)
	}

	if _, err := service.StartJavaOsgiBuild(id); err != nil {
		t.Fatal(err)
	}
	var finished *OsgiBuildEvent
	var last BuildDiagnostics
	for finished == nil || len(last.Reports) < 2 {
		select {
		case event := <-events:
			if payload, ok := event.Payload.(OsgiBuildEvent); ok && payload.Finished {
				finished = &payload
			}
			if payload, ok := event.Payload.(BuildDiagnostics); ok {
				last = payload
			}
		case <-time.After(30 * time.Second):
			t.Fatalf("build did not finish: finished=%+v diagnostics=%+v", finished, last)
		}
	}
	if finished.Total != 2 || finished.Errors != 2 {
		t.Fatalf("outcome = %+v", finished)
	}
	// The last run reports the errors of both bundles: Problems replaces its content at each run.
	if last.Reports[0].RelativePath != "app/src/A.java" || last.Reports[1].RelativePath != "core/src/A.java" {
		t.Fatalf("reports = %+v", last.Reports)
	}
	if source := last.Reports[0].Diagnostics[0].Source; source != "ecj" {
		t.Fatalf("source = %q", source)
	}
}

func TestJavaOsgiRunNeedsTrust(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	defer service.Shutdown()
	session, err := service.OpenProject(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartJavaOsgiRun(string(session.ID)); err == nil {
		t.Fatal("an untrusted project must not start the framework")
	}
}

func TestJavaJDKsReportsTheBundleEnvironmentAndABrowsedJVM(t *testing.T) {
	root := t.TempDir()
	writeOsgiBundle(t, root, "app")
	home := fakeJVM(t)
	service := NewService(&memoryStore{}, nil)
	defer service.Shutdown()
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if err := service.SetJavaJDK(id, home); err != nil {
		t.Fatal(err)
	}
	report, err := service.JavaJDKs(id)
	if err != nil {
		t.Fatal(err)
	}
	if report.BundleEnvironment != "JavaSE-1.6" || report.Required != 6 {
		t.Fatalf("report = %+v", report)
	}
	if !slices.ContainsFunc(report.Installed, func(jdk java.JDK) bool { return jdk.Home == home && jdk.Major == 6 }) {
		t.Fatalf("the chosen JVM must be listed: %+v", report.Installed)
	}
	if ok, err := service.IsJavaOsgiProject(id); err != nil || !ok {
		t.Fatalf("IsJavaOsgiProject = %v, %v", ok, err)
	}
}

func TestJavaOsgiP2NeedsTrustAndConfirmation(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.PreviewJavaOsgiP2(id); err == nil {
		t.Fatal("an untrusted project must not read its .target")
	}
	if _, err := service.ReindexJavaOsgiTarget(id); err == nil {
		t.Fatal("an untrusted project must not index its target")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.DownloadJavaOsgiP2(id, false); err == nil {
		t.Fatal("a download without confirmation must be refused")
	}
	// A folder target has no p2 location to download.
	if _, err := service.SetJavaOsgiTarget(id, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.DownloadJavaOsgiP2(id, true); err == nil {
		t.Fatal("a folder target has nothing to download from p2")
	}
	if _, err := service.ReindexJavaOsgiTarget(id); err != nil {
		t.Fatal(err)
	}
	service.CancelJavaOsgiP2(id) // no download running: a no-op
}
