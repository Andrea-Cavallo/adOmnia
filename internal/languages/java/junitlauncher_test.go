package java

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"

	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

const launcherReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="JUnit Vintage" tests="2" failures="1">
  <testcase name="adds" classname="com.acme.CalcTest" time="0.01"/>
  <testcase name="divides" classname="com.acme.CalcTest" time="0.02"><failure message="expected 2" type="java.lang.AssertionError">java.lang.AssertionError: expected 2</failure></testcase>
</testsuite>`

func antTestModule(t *testing.T) (root, module, launcher string) {
	t.Helper()
	root = t.TempDir()
	module = filepath.Join(root, "billing")
	write(t, filepath.Join(module, "build.xml"), `<project name="billing" default="test"><target name="test"/></project>`)
	write(t, filepath.Join(module, "src", "com", "acme", "Calc.java"), "package com.acme; class Calc {}")
	write(t, filepath.Join(module, "test", "com", "acme", "CalcTest.java"), "package com.acme; class CalcTest {}")
	write(t, filepath.Join(module, ".project"), `<projectDescription><name>billing</name><natures><nature>org.eclipse.jdt.core.javanature</nature></natures></projectDescription>`)
	write(t, filepath.Join(module, ".classpath"), `<classpath><classpathentry kind="src" path="src"/><classpathentry kind="src" path="test"/><classpathentry kind="output" path="bin"/></classpath>`)
	if err := os.MkdirAll(filepath.Join(module, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	launcher = filepath.Join(t.TempDir(), junitLauncherName)
	write(t, launcher, "")
	return root, module, launcher
}

func TestAntTestsRunOnTheLauncherAndFillTheTree(t *testing.T) {
	root, module, launcher := antTestModule(t)
	if !UsesServerTests(module) {
		t.Fatal("an Ant project runs its tests on the launcher")
	}
	if class, ok := ServerTestClass(module, "test/com/acme/CalcTest.java"); !ok || class != "com.acme.CalcTest" {
		t.Fatalf("class = %q", class)
	}
	if class, ok := AnyServerTestClass(module); !ok || class != "com.acme.CalcTest" {
		t.Fatalf("any test class = %q", class)
	}
	options, _ := json.Marshal(TestOptions{
		Packages: []string{"test/com/acme/CalcTest.java"}, Run: "adds,divides",
		ClassPaths: []string{filepath.Join(module, "bin"), filepath.Join(module, "lib", "junit 4.jar")}, JavaExec: "/jdk/bin/java", Launcher: launcher,
	})
	spec, parser, err := (&Language{}).TestCommand(idetesting.Request{Root: root, WorkingDirectory: module, LanguageOptions: options})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Executable != "/jdk/bin/java" || spec.Arguments[0] != "-jar" || spec.Arguments[1] != launcher || !strings.HasPrefix(spec.Arguments[2], "@") {
		t.Fatalf("spec = %+v", spec)
	}
	argfile, err := os.ReadFile(strings.TrimPrefix(spec.Arguments[2], "@"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(argfile)
	for _, want := range []string{"--select-method=com.acme.CalcTest#adds", "--select-method=com.acme.CalcTest#divides", `"--class-path=`, "junit 4.jar"} {
		if !strings.Contains(text, want) {
			t.Fatalf("argfile misses %s:\n%s", want, text)
		}
	}
	reports := ""
	for line := range strings.Lines(text) {
		if after, ok := strings.CutPrefix(strings.TrimSpace(line), "--reports-dir="); ok {
			reports = filepath.FromSlash(after)
		}
	}
	write(t, filepath.Join(reports, "TEST-junit-vintage.xml"), launcherReport)
	finisher, ok := parser.(idetesting.Finisher)
	if !ok {
		t.Fatal("the launcher's reports are read when it exits")
	}
	events := finisher.Finish()
	results := map[string]string{}
	for _, event := range events {
		if event.Test != "" && event.Action != "run" {
			results[event.Test] = event.Action
		}
	}
	if results["adds"] != "pass" || results["divides"] != "fail" {
		t.Fatalf("events = %+v", events)
	}
	if _, err := os.Stat(filepath.Dir(filepath.Dir(filepath.Dir(reports)))); !os.IsNotExist(err) {
		t.Fatal("the temporary reports folder is removed")
	}
}

func TestAntTestsExplainWhatIsMissing(t *testing.T) {
	root, module, launcher := antTestModule(t)
	noClasspath, _ := json.Marshal(TestOptions{Launcher: launcher})
	if _, _, err := (&Language{}).TestCommand(idetesting.Request{Root: root, WorkingDirectory: module, LanguageOptions: noClasspath}); err == nil || !strings.Contains(err.Error(), "language server") {
		t.Fatalf("err = %v", err)
	}
	noLauncher, _ := json.Marshal(TestOptions{ClassPaths: []string{filepath.Join(module, "bin")}})
	if _, _, err := (&Language{}).TestCommand(idetesting.Request{Root: root, WorkingDirectory: module, LanguageOptions: noLauncher}); err == nil || !strings.Contains(err.Error(), "Install JUnit Console Launcher") {
		t.Fatalf("err = %v", err)
	}
	plan, err := (&Language{}).TestRunnerInstallPlan(t.TempDir())
	if err != nil || !strings.Contains(plan.Command, junitLauncherURL) || plan.Task != junitLauncherTask {
		t.Fatalf("plan = %+v, %v", plan, err)
	}
}
