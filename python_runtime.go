package main

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// IsRuntimeReady returns true if the embedded Python runtime is extracted and usable.
func (pb *PythonBridge) IsRuntimeReady() bool {
	runtimeDir := filepath.Join(dataDir(), "python-runtime")
	versionFile := filepath.Join(runtimeDir, ".version")

	if _, err := os.Stat(versionFile); err != nil {
		return false
	}

	// Check the actual python binary exists
	var pythonBin string
	if runtime.GOOS == "windows" {
		pythonBin = filepath.Join(runtimeDir, "python.exe")
	} else {
		pythonBin = filepath.Join(runtimeDir, "python3")
	}

	if _, err := os.Stat(pythonBin); err != nil {
		return false
	}

	return true
}

// BootstrapRuntime handles first-boot setup of the embedded Python runtime.
// It checks for the runtime, extracts it from a bundled zip if needed,
// installs the SDK, and writes a version marker.
func (pb *PythonBridge) BootstrapRuntime() error {
	runtimeDir := filepath.Join(dataDir(), "python-runtime")
	versionFile := filepath.Join(runtimeDir, ".version")

	// Step 1: Check if runtime is already set up
	if _, err := os.Stat(versionFile); err == nil {
		log.Printf("[python-runtime] runtime already bootstrapped at %s", runtimeDir)
		return nil
	}

	// Step 2: Check for bundled zip archive
	zipPath := filepath.Join(dataDir(), "python-runtime.zip")
	if _, err := os.Stat(zipPath); os.IsNotExist(err) {
		return fmt.Errorf("python runtime archive not found at %s; place python-runtime.zip in the data directory or install Python manually", zipPath)
	}

	log.Printf("[python-runtime] extracting runtime from %s to %s", zipPath, runtimeDir)

	// Step 3: Extract the zip archive
	if err := extractZip(zipPath, runtimeDir); err != nil {
		return fmt.Errorf("failed to extract python runtime: %w", err)
	}

	// Step 4: Determine the python binary path
	var pythonBin string
	if runtime.GOOS == "windows" {
		pythonBin = filepath.Join(runtimeDir, "python.exe")
	} else {
		pythonBin = filepath.Join(runtimeDir, "python3")
	}

	if _, err := os.Stat(pythonBin); os.IsNotExist(err) {
		return fmt.Errorf("extracted runtime is missing python binary at %s", pythonBin)
	}

	// Step 5: Get Python version for the .version file
	version, err := getPythonVersion(pythonBin)
	if err != nil {
		return fmt.Errorf("failed to determine python version: %w", err)
	}

	// Step 6: Install the SDK into the runtime's site-packages
	sdkDir := filepath.Join(appDir(), "python-sdk")
	if _, err := os.Stat(sdkDir); err == nil {
		sitePackages := filepath.Join(runtimeDir, "lib", "site-packages")
		os.MkdirAll(sitePackages, 0755)

		log.Printf("[python-runtime] installing SDK from %s", sdkDir)
		installCmd := exec.Command(pythonBin, "-m", "pip", "install", sdkDir, "--target", sitePackages)
		installCmd.Stdout = log.Writer()
		installCmd.Stderr = log.Writer()

		if err := installCmd.Run(); err != nil {
			return fmt.Errorf("failed to install python SDK: %w", err)
		}
		log.Printf("[python-runtime] SDK installed successfully")
	} else {
		log.Printf("[python-runtime] SDK directory not found at %s, skipping SDK install", sdkDir)
	}

	// Step 7: Write the version file
	if err := os.WriteFile(versionFile, []byte(version), 0644); err != nil {
		return fmt.Errorf("failed to write version file: %w", err)
	}

	log.Printf("[python-runtime] bootstrap complete (version=%s)", version)
	return nil
}

// extractZip extracts a zip archive to the destination directory.
func extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("failed to open zip: %w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		// Sanitize the path to prevent zip slip attacks
		targetPath := filepath.Join(destDir, f.Name)
		if !strings.HasPrefix(filepath.Clean(targetPath), filepath.Clean(destDir)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path in zip: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(targetPath, 0755)
			continue
		}

		// Ensure parent directory exists
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			return fmt.Errorf("failed to create directory for %s: %w", f.Name, err)
		}

		outFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return fmt.Errorf("failed to create file %s: %w", f.Name, err)
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return fmt.Errorf("failed to open zip entry %s: %w", f.Name, err)
		}

		_, err = io.Copy(outFile, rc)
		rc.Close()
		outFile.Close()
		if err != nil {
			return fmt.Errorf("failed to extract %s: %w", f.Name, err)
		}
	}

	return nil
}

// getPythonVersion runs `python --version` and returns the version string.
func getPythonVersion(pythonBin string) (string, error) {
	out, err := exec.Command(pythonBin, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("failed to run python --version: %w", err)
	}
	version := strings.TrimSpace(string(out))
	// Output is typically "Python 3.11.5" — keep the full string
	return version, nil
}

// appDir returns the application directory (where the executable lives).
func appDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}
