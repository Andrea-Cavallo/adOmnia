package strix

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

var ansi = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)

// Info dice se Strix può partire e, se no, cosa manca.
type Info struct {
	Installed bool   `json:"installed"`
	Binary    string `json:"binary,omitempty"`
	Version   string `json:"version,omitempty"`
	// DockerReady: Strix esegue gli agenti in un sandbox Docker, quindi il daemon deve rispondere.
	DockerReady bool   `json:"dockerReady"`
	DockerNote  string `json:"dockerNote,omitempty"`
}

// InstallPlan è l'unico comando che l'utente conferma per installare Strix.
type InstallPlan struct {
	Command string   `json:"command"`
	Program string   `json:"program"`
	Args    []string `json:"args"`
	Note    string   `json:"note"`
}

// FindBinary cerca `strix` nel PATH e nelle cartelle dove pipx/uv/lo script ufficiale lo mettono.
func FindBinary() (string, error) {
	if path, err := exec.LookPath("strix"); err == nil {
		return path, nil
	}
	home, _ := os.UserHomeDir()
	name := "strix"
	if runtime.GOOS == "windows" {
		name = "strix.exe"
	}
	for _, dir := range []string{filepath.Join(home, ".local", "bin"), filepath.Join(home, ".strix", "bin"), filepath.Join(home, "go", "bin")} {
		candidate := filepath.Join(dir, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("Strix is not installed")
}

// Detect controlla Strix e Docker. Non avvia nulla di lungo: due chiamate con timeout breve.
func Detect(ctx context.Context) Info {
	info := Info{}
	if binary, err := FindBinary(); err == nil {
		info.Installed, info.Binary = true, binary
		info.Version = firstLine(captured(ctx, 5*time.Second, binary, "--version"))
	}
	if _, err := runErr(ctx, 6*time.Second, "docker", "info", "--format", "{{.ServerVersion}}"); err != nil {
		info.DockerNote = "Docker is not running or not installed: Strix runs its agents in a Docker sandbox."
	} else {
		info.DockerReady = true
	}
	return info
}

// PlanInstall sceglie come installare Strix: uv, poi pipx. Lo script `curl | bash` ufficiale non si usa mai:
// non è leggibile prima dell'esecuzione e non funziona su Windows.
func PlanInstall() (InstallPlan, error) {
	if path, err := exec.LookPath("uv"); err == nil {
		return InstallPlan{Command: "uv tool install strix-agent", Program: path, Args: []string{"tool", "install", "strix-agent"},
			Note: "Installs the strix-agent package from PyPI into an isolated uv tool environment."}, nil
	}
	if path, err := exec.LookPath("pipx"); err == nil {
		return InstallPlan{Command: "pipx install strix-agent", Program: path, Args: []string{"install", "strix-agent"},
			Note: "Installs the strix-agent package from PyPI into an isolated pipx environment."}, nil
	}
	return InstallPlan{}, fmt.Errorf("installing Strix needs uv or pipx (Python 3.12+): install one of them first, then retry")
}

func captured(ctx context.Context, timeout time.Duration, name string, args ...string) string {
	output, _ := runErr(ctx, timeout, name, args...)
	return output
}

func runErr(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	output, err := procutil.CommandContext(ctx, name, args...).CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

func firstLine(text string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(ansi.ReplaceAllString(text, "")), "\n")
	return strings.TrimSpace(line)
}
