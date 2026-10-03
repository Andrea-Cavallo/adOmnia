package goide

import (
	"archive/zip"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

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
	writeTestZip(t, archive, map[string]string{"go/bin/" + goExecutableName(): "go-binary"})
	destination := filepath.Join(root, "safe")
	if err := extractToolchainArchive(archive, destination); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(destination, "go", "bin", goExecutableName())); err != nil || string(data) != "go-binary" {
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
	binary := filepath.Join(root, version, "go", "bin", goExecutableName())
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

func TestSelectInstalledToolchainPinsItsOwnGOROOT(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	if err := service.ConfigureToolchainStorage(root); err != nil {
		t.Fatal(err)
	}
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module example.com/pinned\n\ngo 1.26\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	version := "go1.27.1"
	binary := filepath.Join(root, version, "go", "bin", goExecutableName())
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := service.SelectInstalledToolchain(string(session.ID), version); err != nil {
		t.Fatal(err)
	}
	config := service.toolchain.Configuration(session.ID)
	if config.Environment["GOROOT"] != filepath.Join(root, version, "go") {
		t.Fatalf("GOROOT gestito inatteso: %q", config.Environment["GOROOT"])
	}
	if config.Environment["GOTOOLCHAIN"] != "local" {
		t.Fatalf("GOTOOLCHAIN non confinato: %q", config.Environment["GOTOOLCHAIN"])
	}
}
