package update

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeExecutable(t *testing.T, dir string) string {
	t.Helper()
	name := "adomnia"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	exe := filepath.Join(dir, name)
	if err := os.WriteFile(exe, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	return exe
}

func TestUserOwnedExecutableUpdatesItself(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("macOS updates only an .app bundle")
	}
	dir := t.TempDir()
	install := DetectInstall(writeExecutable(t, dir))
	if install.Kind != InstallPortable || !install.SelfUpdate || install.Reason != "" {
		t.Fatalf("install = %+v, want a self-updating portable copy", install)
	}
	if leftovers, _ := filepath.Glob(filepath.Join(dir, ".adomnia-write-test-*")); len(leftovers) != 0 {
		t.Fatalf("write probe left behind: %v", leftovers)
	}
}

func TestReadOnlyInstallIsManagedOutsideTheApp(t *testing.T) {
	if runtime.GOOS != "linux" || os.Geteuid() == 0 {
		t.Skip("needs a non-root Linux user: root writes to read-only folders")
	}
	dir := t.TempDir()
	exe := writeExecutable(t, dir)
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	install := DetectInstall(exe)
	if install.Kind != InstallManaged || install.SelfUpdate || install.Reason == "" {
		t.Fatalf("install = %+v, want a managed copy with a reason", install)
	}
}

func TestSystemPackageIsManagedOutsideTheApp(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("system package paths are a Linux concept")
	}
	install := DetectInstall("/usr/bin/sh")
	if install.Kind != InstallManaged || install.SelfUpdate || !strings.Contains(install.Reason, "package manager") {
		t.Fatalf("install = %+v, want a package-managed copy", install)
	}
}

func TestManagedInstallNeverDownloads(t *testing.T) {
	m := NewManager(t.TempDir(), "v1.0.0")
	m.install = Install{Kind: InstallManaged, Reason: "managed elsewhere"}
	m.selected = release{Tag: "v1.1.0"}
	if _, err := m.Download(); err == nil || err.Error() != "managed elsewhere" {
		t.Fatalf("Download() error = %v, want the install reason", err)
	}
	if phase := m.Status().Phase; phase == "downloading" {
		t.Fatal("a managed install started a download")
	}
}
