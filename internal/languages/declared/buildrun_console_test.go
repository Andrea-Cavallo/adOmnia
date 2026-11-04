package declared

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

func TestRealBuildRunConsoleDoesNotEchoRecipes(t *testing.T) {
	makeBinary, err := exec.LookPath("make")
	if err != nil {
		t.Skip("GNU make unavailable")
	}
	compiler, err := exec.LookPath("clang++")
	if err != nil {
		compiler, err = exec.LookPath("g++")
	}
	if err != nil {
		t.Skip("C++ compiler unavailable")
	}
	root := t.TempDir()
	source := filepath.Join(root, "hello.cpp")
	if err := os.WriteFile(source, []byte("#include <cstdio>\nint main() { puts(\"repeat\"); puts(\"repeat\"); }\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	output, makefile, err := writeBuildRunMakefile(root, source, compiler, []string{source})
	if err != nil {
		t.Fatal(err)
	}
	run := func() (string, string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		command := procutil.CommandContext(ctx, makeBinary, "-f", makefile, "run")
		command.Dir = root
		var stdout, stderr bytes.Buffer
		command.Stdout, command.Stderr = &stdout, &stderr
		err := command.Run()
		return strings.ReplaceAll(stdout.String(), "\r\n", "\n"), stderr.String(), err
	}
	stdout, stderr, err := run()
	if err != nil {
		t.Fatalf("real build/run failed: %v\n%s", err, stderr)
	}
	if stdout != "repeat\nrepeat\n" {
		t.Fatalf("expected only program output, got %q", stdout)
	}
	if err := os.WriteFile(source, []byte("int main() { invalid syntax here; }\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Force this diagnostic check to compile even on coarse-timestamp filesystems.
	if err := os.Remove(output); err != nil {
		t.Fatal(err)
	}
	_, stderr, err = run()
	if err == nil || !strings.Contains(strings.ToLower(stderr), "error") {
		t.Fatalf("compiler failures must remain visible: err=%v stderr=%q", err, stderr)
	}
}
