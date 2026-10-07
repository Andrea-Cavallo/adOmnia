//go:build windows

package goide

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"

	"adomnia/internal/ide/remote"
)

func detectTerminalProfiles() []TerminalProfile {
	var profiles []TerminalProfile
	if path, err := exec.LookPath("pwsh.exe"); err == nil {
		profiles = append(profiles, TerminalProfile{ID: "pwsh", Name: "PowerShell", Kind: "powershell", Shell: path, Arguments: []string{"-NoLogo"}})
	}
	if path, err := exec.LookPath("powershell.exe"); err == nil {
		profiles = append(profiles, TerminalProfile{ID: "powershell", Name: "Windows PowerShell", Kind: "powershell", Shell: path, Arguments: []string{"-NoLogo"}})
	}
	cmd := os.Getenv("COMSPEC")
	if cmd == "" {
		cmd = "cmd.exe"
	}
	profiles = append(profiles, TerminalProfile{ID: "cmd", Name: "Command Prompt", Kind: "cmd", Shell: cmd})
	if bash := gitBashPath(); bash != "" {
		profiles = append(profiles, TerminalProfile{ID: "gitbash", Name: "Git Bash", Kind: "bash", Shell: bash, Arguments: []string{"--login", "-i"}})
	}
	if wsl, err := exec.LookPath("wsl.exe"); err == nil {
		for _, distro := range remote.WSLDistributions(context.Background()) {
			profiles = append(profiles, TerminalProfile{ID: "wsl:" + distro, Name: distro + " (WSL)", Kind: "wsl", Shell: wsl, Arguments: []string{"-d", distro}})
		}
	}
	return profiles
}

// gitBashPath trova bash.exe di Git for Windows (non la bash di WSL in System32).
func gitBashPath() string {
	candidates := []string{}
	if git, err := exec.LookPath("git.exe"); err == nil {
		// …\Git\cmd\git.exe → …\Git\bin\bash.exe
		candidates = append(candidates, filepath.Join(filepath.Dir(filepath.Dir(git)), "bin", "bash.exe"))
	}
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "LocalAppData"} {
		if base := os.Getenv(env); base != "" {
			candidates = append(candidates, filepath.Join(base, "Git", "bin", "bash.exe"), filepath.Join(base, "Programs", "Git", "bin", "bash.exe"))
		}
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}
