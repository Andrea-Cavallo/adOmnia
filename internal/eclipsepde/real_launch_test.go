package eclipsepde

import (
	"bufio"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const startedMarker = "ADOMNIA-BUNDLE-STARTED"

// The generated configuration must really start a bundle in Equinox, from its output folder.
// Opt-in, like the differential test: ADOMNIA_TEST_EQUINOX=<org.eclipse.osgi_3.9.x.jar>, java on PATH.
func TestRealEquinoxStartsTheWorkspaceBundle(t *testing.T) {
	osgiJar := os.Getenv("ADOMNIA_TEST_EQUINOX")
	if osgiJar == "" {
		t.Skip("ADOMNIA_TEST_EQUINOX is not set: point it to org.eclipse.osgi_3.9.x.jar (Kepler)")
	}
	root, target := t.TempDir(), t.TempDir()
	framework, err := os.ReadFile(osgiJar)
	if err != nil {
		t.Fatal(err)
	}
	writeText(t, filepath.Join(target, filepath.Base(osgiJar)), string(framework))
	project := writeProject(t, root, "hello", bundleManifest("hello", "Bundle-Activator: hello.Activator", "Import-Package: org.osgi.framework"), map[string]string{
		".classpath": sourcesClasspath,
		"src/hello/Activator.java": `package hello;
public class Activator implements org.osgi.framework.BundleActivator {
  public void start(org.osgi.framework.BundleContext context) { System.out.println("` + startedMarker + `"); }
  public void stop(org.osgi.framework.BundleContext context) {}
}
`,
	})
	if _, err := SetTarget(root, target); err != nil {
		t.Fatal(err)
	}
	compile := exec.Command("javac", "--release", "8", "-nowarn", "-cp", osgiJar, "-d", filepath.Join(project, "bin"), filepath.Join(project, "src", "hello", "Activator.java"))
	if output, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("javac: %v\n%s", err, output)
	}
	launch, err := PrepareLaunch(root, LaunchJVM{})
	if err != nil {
		t.Fatal(err)
	}
	// The product refuses a JVM newer than 8. The test may run on one, if told what Equinox cannot detect by itself.
	arguments := append([]string{"-Dorg.osgi.framework.executionenvironment=OSGi/Minimum-1.0,J2SE-1.5,JavaSE-1.6", "--add-opens", "java.base/java.net=ALL-UNNAMED", "--add-opens", "java.base/java.lang=ALL-UNNAMED"}, launch.Arguments...)
	command := exec.Command("java", arguments...)
	command.Dir = launch.Directory
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = command.Stdout
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
	var seen strings.Builder
	timeout := time.After(60 * time.Second)
	for {
		select {
		case line, open := <-lines:
			if !open {
				t.Fatalf("the framework exited without starting the bundle:\n%s", seen.String())
			}
			seen.WriteString(line)
			if strings.Contains(line, startedMarker) {
				return
			}
		case <-timeout:
			t.Fatalf("the bundle did not start:\n%s", seen.String())
		}
	}
}
