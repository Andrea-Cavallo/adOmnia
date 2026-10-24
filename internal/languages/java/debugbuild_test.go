package java

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDebugBuildMovesVMOptionsOutOfBatchCommand(t *testing.T) {
	args, cleanup, err := PrepareDebugBuild("mvn.cmd", []string{"spring-boot:run", `-Dspring-boot.run.jvmArguments=-Xmx512m "-Dconfig=C:\Program Files\app" -Dmarker=a&b`})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	file := strings.TrimPrefix(args[1], "-Dspring-boot.run.jvmArguments=@")
	data, err := os.ReadFile(file)
	if err != nil || !strings.Contains(string(data), `-Xmx512m`) || !strings.Contains(string(data), `Program Files`) {
		t.Fatalf("%v %s", err, data)
	}
	if strings.ContainsAny(args[1], "&\"") {
		t.Fatalf("shell characters leaked: %v", args)
	}
	cleanup()
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("argument file not removed")
	}
}
func TestSplitVMOptionsRejectsBrokenQuoting(t *testing.T) {
	for _, text := range []string{`-Dkey="broken`, "-Dkey=one\n-two"} {
		if _, err := splitVMOptions(text); err == nil {
			t.Fatalf("accepted %q", text)
		}
	}
}
func TestResolveAttachProjectUsesJDTProjectIdentity(t *testing.T) {
	for _, test := range []struct {
		raw, want string
		bad       bool
	}{
		{`[{"projectName":"module-a"},{"projectName":"module-a"}]`, "module-a", false},
		{`[{"projectName":"module-a"},{"projectName":"module-b"}]`, "", true},
		{`[]`, "", false},
	} {
		name, err := ResolveAttachProject("file:///workspace/module", func(command string, args ...any) (json.RawMessage, error) {
			if command != CommandResolveMainClass || args[0] != "file:///workspace/module" {
				t.Fatalf("wrong resolution: %s %v", command, args)
			}
			return json.RawMessage(test.raw), nil
		})
		if name != test.want || (err != nil) != test.bad {
			t.Fatalf("%s: %s %v", test.raw, name, err)
		}
	}
}

func TestGradleTaskModuleNarrowsTheDebugScope(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"app", "libs/core", "docs"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range []string{"app/build.gradle", "libs/core/build.gradle.kts"} {
		if err := os.WriteFile(filepath.Join(root, file), []byte("plugins {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct {
		arguments []string
		want      string
	}{
		{[]string{":app:bootRun", "--debug-jvm"}, filepath.Join(root, "app")},
		{[]string{":libs:core:test"}, filepath.Join(root, "libs", "core")},
		{[]string{"bootRun"}, root},
		{[]string{":docs:run"}, root},
		{[]string{":../outside:run"}, root},
		{[]string{":run"}, root},
	} {
		if got := GradleTaskModule(root, test.arguments); got != test.want {
			t.Fatalf("%v: got %s want %s", test.arguments, got, test.want)
		}
	}
}
