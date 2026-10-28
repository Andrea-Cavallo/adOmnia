package java

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
)

var _ language.ServerProvider = (*Language)(nil)

func fakeJava(t *testing.T, version string) {
	t.Helper()
	oldLook, oldVersion := lookPath, javaVersion
	t.Cleanup(func() { lookPath, javaVersion = oldLook, oldVersion })
	t.Setenv("JAVA_HOME", "")
	lookPath = func(string) (string, error) { return "/usr/bin/java", nil }
	javaVersion = func(string) (string, error) { return version, nil }
}

func installFakeJdtls(t *testing.T, tools string) {
	t.Helper()
	write(t, filepath.Join(tools, jdtlsDir, "plugins", "org.eclipse.equinox.launcher_1.7.0.jar"), "x")
	write(t, filepath.Join(tools, jdtlsDir, "bundles", debugPluginName), "x")
	write(t, filepath.Join(tools, jdtlsDir, "bundles", lombokName), "x")
}

func TestLocateServerAsksForInstallWhenJdtlsIsMissing(t *testing.T) {
	fakeJava(t, "21.0.4")
	info := New().LocateServer("", t.TempDir())
	if info.Available || !strings.Contains(info.Error, "not installed") {
		t.Fatalf("missing JDT LS must say so: %+v", info)
	}
}

func TestLocateServerNeedsAJdkNewEnoughToRunIt(t *testing.T) {
	tools := t.TempDir()
	installFakeJdtls(t, tools)
	fakeJava(t, "17.0.2")
	if info := New().LocateServer("", tools); info.Available || !strings.Contains(info.Error, "21") {
		t.Fatalf("Java 17 must be refused with the reason: %+v", info)
	}
	fakeJava(t, "21.0.4")
	if info := New().LocateServer("", tools); !info.Available {
		t.Fatalf("Java 21 + installed JDT LS must be available: %+v", info)
	}
}

func TestServerSpecKeepsTheWorkspaceInTheToolsFolder(t *testing.T) {
	tools := t.TempDir()
	installFakeJdtls(t, tools)
	fakeJava(t, "21.0.4")
	spec, err := New().ServerSpec(filepath.Join(t.TempDir(), "orders"), tools)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(spec.Arguments, " ")
	for _, want := range []string{"-jar", "equinox.launcher", "-configuration", filepath.Join(tools, "jdtls-data")} {
		if !strings.Contains(joined, want) {
			t.Errorf("arguments miss %q: %s", want, joined)
		}
	}
	if spec.Language != ID || !spec.WatchesFile("pom.xml") || spec.WatchesFile("notes.txt") {
		t.Errorf("spec identity/watch rules wrong: %+v", spec)
	}
}

func TestInstallPlanIsOneVisibleCommandAndNeedsAJdk(t *testing.T) {
	fakeJava(t, "21.0.4")
	tools := t.TempDir()
	plan, err := New().InstallPlan(tools)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.Command, "download.eclipse.org") || plan.Directory != filepath.Join(tools, jdtlsDir) || plan.Languages[0] != ID {
		t.Fatalf("unexpected plan: %+v", plan)
	}
	if err := plan.Prepare(); err != nil {
		t.Fatal(err)
	}
	lookPath = func(string) (string, error) { return "", errors.New("no java") }
	if _, err := New().InstallPlan(tools); err == nil {
		t.Error("without a JDK the install must be refused with the reason")
	}
}

func TestAnInstallWithoutTheDebugBundleAsksForAnUpdate(t *testing.T) {
	fakeJava(t, "21.0.4")
	tools := t.TempDir()
	installFakeJdtls(t, tools)
	if err := os.Remove(filepath.Join(tools, jdtlsDir, "bundles", debugPluginName)); err != nil {
		t.Fatal(err)
	}
	if info := New().LocateServer("", tools); info.Available || !strings.Contains(info.Error, "debug") {
		t.Fatalf("an install without the debug bundle must ask to install again: %+v", info)
	}
}

func TestServerSpecLoadsTheDebugBundleIntoJdtls(t *testing.T) {
	fakeJava(t, "21.0.4")
	tools := t.TempDir()
	installFakeJdtls(t, tools)
	spec, err := New().ServerSpec(t.TempDir(), tools)
	if err != nil {
		t.Fatal(err)
	}
	options, _ := spec.InitializationOptions.(map[string]any)
	bundles, _ := options["bundles"].([]string)
	if len(bundles) != 1 || !strings.HasSuffix(bundles[0], debugPluginName) {
		t.Fatalf("bundles = %v", options)
	}
	if !strings.Contains(strings.Join(spec.Arguments, " "), "-javaagent:"+filepath.Join(tools, jdtlsDir, "bundles", lombokName)) {
		t.Errorf("Lombok must load as a javaagent: %v", spec.Arguments)
	}
}

func TestClassFilePathKeepsModuleAndPackage(t *testing.T) {
	for uri, want := range map[string]string{
		"jdt://contents/java.base/java.util/Map.class?=app/%5C/usr/jdk%5C/lib%5C/jrt-fs.jar": "java.base/java/util/Map.java",
		"jdt://contents/java.base/java.lang.reflect/Field.java?=app/x":                       "java.base/java/lang/reflect/Field.java",
		"jdt://contents/x": "",
	} {
		if got := classFilePath(uri); got != want {
			t.Errorf("classFilePath(%q) = %q, want %q", uri, got, want)
		}
	}
}
