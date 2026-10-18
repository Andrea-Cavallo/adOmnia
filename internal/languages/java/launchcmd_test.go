package java

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func longClassPath(count int) []string {
	paths := make([]string, count)
	for i := range paths {
		paths[i] = filepath.Join(os.TempDir(), "repo", "lib", strings.Repeat("a", 40), "dep-"+strings.Repeat("x", 20)+".jar")
	}
	return paths
}

func TestShortLaunchStaysPlainAndModulesUseDashM(t *testing.T) {
	executable, arguments, cleanup, err := BuildLaunch(LaunchSpec{JavaExec: "java", MainClass: "mod.a/pkg.App", ModulePaths: []string{"m"}, ClassPaths: []string{"c"}, VMArgs: []string{"-Xmx1g"}, Args: []string{"--x"}})
	defer cleanup()
	if err != nil || executable != "java" || strings.Join(arguments, " ") != "-Xmx1g --module-path m -cp c -m mod.a/pkg.App --x" {
		t.Fatalf("%s %v %v", executable, arguments, err)
	}
}

func TestLongLaunchUsesAnArgFileOnModernJDK(t *testing.T) {
	spec := LaunchSpec{JavaExec: "java", MainClass: "a.App", ClassPaths: longClassPath(400), Args: []string{"hello world"}, TempDir: t.TempDir(), Major: 21}
	_, arguments, cleanup, err := BuildLaunch(spec)
	if err != nil || len(arguments) != 1 || !strings.HasPrefix(arguments[0], "@") {
		t.Fatalf("%v %v", arguments, err)
	}
	file := strings.TrimPrefix(arguments[0], "@")
	data, readErr := os.ReadFile(file)
	if readErr != nil || !strings.Contains(string(data), "-cp\n") || !strings.Contains(string(data), "\"hello world\"") {
		t.Fatalf("argfile = %q, %v", data, readErr)
	}
	cleanup()
	if _, statErr := os.Stat(file); !os.IsNotExist(statErr) {
		t.Fatal("cleanup must remove the argfile")
	}
}

func TestLongLaunchOnJDK8UsesAManifestOnlyJar(t *testing.T) {
	spec := LaunchSpec{JavaExec: "java", MainClass: "a.App", ClassPaths: longClassPath(400), TempDir: t.TempDir(), Major: 8}
	_, arguments, cleanup, err := BuildLaunch(spec)
	defer cleanup()
	if err != nil || len(arguments) != 3 || arguments[0] != "-cp" || !strings.HasSuffix(arguments[1], ".jar") || arguments[2] != "a.App" {
		t.Fatalf("%v %v", arguments, err)
	}
	reader, err := zip.OpenReader(arguments[1])
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	entry, _ := reader.File[0].Open()
	body, _ := io.ReadAll(entry)
	text := string(body)
	if reader.File[0].Name != "META-INF/MANIFEST.MF" || !strings.Contains(text, "Class-Path: file:///") {
		t.Fatalf("manifest = %q", text)
	}
	for _, line := range strings.Split(text, "\r\n") {
		if len(line) > 72 {
			t.Fatalf("manifest line over 72 bytes: %d", len(line))
		}
	}
}

func TestManifestLineWrapsAt72Bytes(t *testing.T) {
	wrapped := manifestLine("Class-Path: " + strings.Repeat("a", 200))
	for _, line := range strings.Split(wrapped, "\r\n") {
		if len(line) > 72 {
			t.Fatalf("line of %d bytes", len(line))
		}
	}
	if strings.ReplaceAll(wrapped, "\r\n ", "") != "Class-Path: "+strings.Repeat("a", 200) {
		t.Fatal("unwrapping must give back the original text")
	}
}
