package java

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/language"
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
