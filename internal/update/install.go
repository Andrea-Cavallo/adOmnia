package update

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
)

// How this copy of adOmnia was installed. It decides whether the in-app updater may
// replace the application, and what the UI offers when it may not.
const (
	InstallInstaller = "installer"  // the per-user Windows setup.exe
	InstallPortable  = "portable"   // a user-owned executable (portable .exe, ~/.local/bin, install.ps1)
	InstallBundle    = "app-bundle" // a macOS .app the user can write to
	InstallManaged   = "managed"    // a location adOmnia cannot write: package manager, Program Files, /opt
)

var errInstallNotWritable = errors.New("adOmnia cannot write to the folder it is installed in. Download the installer from the release page to update")

// Install is reported to the UI with every update state.
type Install struct {
	Kind       string `json:"kind"`
	SelfUpdate bool   `json:"selfUpdate"`
	// Reason says why SelfUpdate is false, in words the user can act on.
	Reason string `json:"reason"`
}

// DetectInstall classifies the executable that is running now.
func DetectInstall(exe string) Install {
	target, _, err := installTarget(exe)
	if err != nil {
		return Install{Kind: InstallManaged, Reason: err.Error()}
	}
	if !dirWritable(filepath.Dir(target)) {
		return Install{Kind: InstallManaged, Reason: errInstallNotWritable.Error()}
	}
	if runtime.GOOS == "darwin" {
		return Install{Kind: InstallBundle, SelfUpdate: true}
	}
	if registeredInstall(target) {
		return Install{Kind: InstallInstaller, SelfUpdate: true}
	}
	return Install{Kind: InstallPortable, SelfUpdate: true}
}

func detectRunningInstall() Install {
	exe, err := os.Executable()
	if err != nil {
		return Install{Kind: InstallManaged, Reason: "adOmnia cannot locate its own executable, so it cannot update itself"}
	}
	return DetectInstall(exe)
}

// dirWritable probes with a real file: permission bits and Windows ACLs both lie.
func dirWritable(dir string) bool {
	probe, err := os.CreateTemp(dir, ".adomnia-write-test-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	_ = probe.Close()   // empty probe, nothing to flush
	_ = os.Remove(name) // best effort: a leftover zero-byte probe is harmless
	return true
}
