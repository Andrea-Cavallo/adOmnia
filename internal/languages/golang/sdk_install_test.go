package golang

import (
	"archive/zip"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

func TestGoReleaseOrderUsesNumericVersions(t *testing.T) {
	versions := []string{"go1.9.9", "go1.26.5", "go1.25.10", "go1.25.9"}
	sort.Slice(versions, func(left, right int) bool { return newerGoVersion(versions[left], versions[right]) })
	want := []string{"go1.26.5", "go1.25.10", "go1.25.9", "go1.9.9"}
	for index, version := range versions {
		if version != want[index] {
			t.Fatalf("release order: got %v, want %v", versions, want)
		}
	}
}

func writeTestZip(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, content := range entries {
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := entry.Write([]byte(content)); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestOfficialToolchainDownload(t *testing.T) {
	if os.Getenv("ADOMNIA_TEST_GO_DOWNLOAD") != "1" {
		t.Skip("download ufficiale eseguito soltanto nel collaudo esplicito")
	}
	installer := NewToolchainInstaller(nil)
	if err := installer.ConfigureRoot(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	releases, err := installer.ListReleases(ctx)
	cancel()
	if err != nil || len(releases) == 0 {
		t.Fatalf("catalogo ufficiale non disponibile: %v", err)
	}
	completed := make(chan struct {
		binary string
		err    error
	}, 1)
	_, err = installer.Start(InstallToolchainRequest{SessionID: "test", Version: releases[0].Version, Confirmed: true}, releases[0], func(binary string, installErr error) {
		completed <- struct {
			binary string
			err    error
		}{binary, installErr}
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-completed:
		if result.err != nil {
			t.Fatal(result.err)
		}
		output, commandErr := exec.Command(result.binary, "version").CombinedOutput()
		if commandErr != nil {
			t.Fatalf("toolchain installata non eseguibile: %s: %v", output, commandErr)
		}
	case <-time.After(15 * time.Minute):
		t.Fatal("timeout installazione toolchain ufficiale")
	}
}

func TestToolchainArchiveExtractionAndTraversal(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(root, "go.zip")
	writeTestZip(t, archive, map[string]string{"go/bin/" + GoExecutableName(): "go-binary"})
	destination := filepath.Join(root, "safe")
	if err := extractToolchainArchive(archive, destination); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(destination, "go", "bin", GoExecutableName())); err != nil || string(data) != "go-binary" {
		t.Fatalf("estrazione toolchain incompleta: %q, %v", data, err)
	}

	unsafeArchive := filepath.Join(root, "unsafe.zip")
	writeTestZip(t, unsafeArchive, map[string]string{"../outside.txt": "escape"})
	if err := extractToolchainArchive(unsafeArchive, filepath.Join(root, "unsafe")); err == nil {
		t.Fatal("archivio con traversal accettato")
	}
	if _, err := os.Stat(filepath.Join(root, "outside.txt")); !os.IsNotExist(err) {
		t.Fatalf("l'archivio ha scritto fuori dalla destinazione: %v", err)
	}
}

func TestInstalledToolchainsAreIsolatedAndRemovable(t *testing.T) {
	root := t.TempDir()
	installer := NewToolchainInstaller(nil)
	if err := installer.ConfigureRoot(root); err != nil {
		t.Fatal(err)
	}
	version := "go1.26.5"
	binary := filepath.Join(root, version, "go", "bin", GoExecutableName())
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	installed, err := installer.ListInstalled()
	if err != nil || len(installed) != 1 || installed[0].Version != version {
		t.Fatalf("toolchain installate inattese: %#v, %v", installed, err)
	}
	if err := installer.Remove(version, false); err == nil {
		t.Fatal("rimozione senza conferma accettata")
	}
	if err := installer.Remove(version, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, version)); !os.IsNotExist(err) {
		t.Fatalf("toolchain non rimossa: %v", err)
	}
}
