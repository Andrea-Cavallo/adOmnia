//go:build !windows

package goide

import (
	"os"
	"os/exec"
	"syscall"
)

func configureProcess(command *exec.Cmd, _ bool) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateProcessTree(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	return terminateProcessTreeByPID(command.Process.Pid)
}

// terminateProcessTreeByPID arresta l'intero process group a partire dal PID
// indicato, usato dal terminale PTY che non possiede un *exec.Cmd.
func terminateProcessTreeByPID(pid int) error {
	if pid <= 0 {
		return nil
	}
	return syscall.Kill(-pid, syscall.SIGKILL)
}

// defaultShell restituisce la shell interattiva predefinita della piattaforma.
func defaultShell() (string, []string) {
	if shell := os.Getenv("SHELL"); shell != "" {
		return shell, []string{"-i"}
	}
	return "/bin/sh", nil
}
