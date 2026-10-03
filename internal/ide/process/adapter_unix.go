//go:build !windows

package process

import (
	"os"
	"os/exec"
	"syscall"
)

func Configure(command *exec.Cmd, _ bool) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func TerminateTree(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	return TerminateTreeByPID(command.Process.Pid)
}

// TerminateTreeByPID arresta l'intero process group a partire dal PID
// indicato, usato dal terminale PTY che non possiede un *exec.Cmd.
func TerminateTreeByPID(pid int) error {
	if pid <= 0 {
		return nil
	}
	return syscall.Kill(-pid, syscall.SIGKILL)
}

// DefaultShell restituisce la shell interattiva predefinita della piattaforma.
func DefaultShell() (string, []string) {
	if shell := os.Getenv("SHELL"); shell != "" {
		return shell, []string{"-i"}
	}
	return "/bin/sh", nil
}
