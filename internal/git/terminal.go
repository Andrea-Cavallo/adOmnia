package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type TerminalResult struct {
	Command  string `json:"command"`
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
}

// RunTerminalCommand executes an explicit user-entered command with the
// repository as CWD. It is deliberately bounded so a forgotten command cannot
// leave a hidden desktop process running forever.
func RunTerminalCommand(repoPath, command string) (TerminalResult, error) {
	if _, err := os.Stat(filepath.Join(repoPath, ".git")); err != nil {
		return TerminalResult{}, fmt.Errorf("not a git repository: %s", repoPath)
	}
	command = strings.TrimSpace(command)
	if command == "" {
		return TerminalResult{}, fmt.Errorf("command is empty")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command)
	} else {
		cmd = exec.CommandContext(ctx, "/bin/sh", "-lc", command)
	}
	configureHiddenCommand(cmd)
	cmd.Dir = repoPath
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	output := strings.TrimSpace(stdout.String() + stderr.String())
	result := TerminalResult{Command: command, Output: output, ExitCode: 0}
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exit.ExitCode()
			return result, nil
		}
		if ctx.Err() != nil {
			return result, fmt.Errorf("command timed out after 5 minutes")
		}
		return result, err
	}
	return result, nil
}
