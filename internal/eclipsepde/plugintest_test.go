package eclipsepde

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestPluginTestRunsAFragmentsClassesInEquinox(t *testing.T) {
	root, target := keplerWorkspace(t)
	writeProject(t, root, "core.tests", bundleManifest("core.tests", "Fragment-Host: core", "Require-Bundle: org.junit"),
		map[string]string{".classpath": sourcesClasspath, "src/core/CoreTest.java": "package core; public class CoreTest {}"})
	for _, name := range []string{"app", "core", "core.tests"} {
		writeText(t, filepath.Join(root, name, "bin", "X.class"), "x")
	}

	test, err := PluginTestClassOf(root, "core.tests/src/core/CoreTest.java")
	if err != nil || test.Bundle != "core.tests" || test.TestPlugin != "core" || test.Class != "core.CoreTest" {
		t.Fatalf("test = %+v, %v", test, err)
	}
	spec := PluginTest{Bundle: test.Bundle, TestPlugin: test.TestPlugin, Classes: []string{test.Class}, Port: 4711}
	if _, err := PreparePluginTest(root, LaunchJVM{Major: 8}, spec); err == nil || !strings.Contains(err.Error(), "org.eclipse.pde.junit.runtime") {
		t.Fatalf("a target without the PDE test runtime must say so: %v", err)
	}

	for _, name := range pluginTestRuntime {
		writeJar(t, filepath.Join(target, "plugins", name+"_1.0.0.jar"), bundleManifest(name))
	}
	writeJar(t, filepath.Join(target, "plugins", "org.eclipse.core.runtime_3.9.jar"), bundleManifest("org.eclipse.core.runtime"))
	if _, err := ReindexReport(root); err != nil {
		t.Fatal(err)
	}
	launch, err := PreparePluginTest(root, LaunchJVM{Major: 8}, spec)
	if err != nil {
		t.Fatal(err)
	}
	if argumentAfter(t, launch.Arguments, "-application") != coreTestApplication || argumentAfter(t, launch.Arguments, "-testpluginname") != "core" ||
		argumentAfter(t, launch.Arguments, "-classNames") != "core.CoreTest" || argumentAfter(t, launch.Arguments, "-port") != "4711" ||
		argumentAfter(t, launch.Arguments, "-loaderpluginname") != junit4LoaderBundle {
		t.Fatalf("arguments = %v", launch.Arguments)
	}
	if !slices.Contains(launch.Arguments, "-Dosgi.noShutdown=false") || slices.Contains(launch.Arguments, "-console") {
		t.Fatalf("the framework ends with the test application: %v", launch.Arguments)
	}
	config, err := os.ReadFile(filepath.Join(root, ".adomnia", "osgi", "junit-core.tests", "configuration", "config.ini"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"core.tests", "org.eclipse.pde.junit.runtime", "org.junit", "eclipse.application=" + coreTestApplication} {
		if !strings.Contains(string(config), want) {
			t.Fatalf("config.ini misses %s:\n%s", want, config)
		}
	}

	spec.Method = "loads"
	if got := pluginTestArguments(spec); !slices.Contains(got, "-test") || argumentAfter(t, got, "-test") != "core.CoreTest:loads" {
		t.Fatalf("one method runs with -test class:method: %v", got)
	}
}
