//go:build !windows

package process

import (
	"os/exec"
	"syscall"
)

// ConfigureInterruptible: su Unix basta il process group, il segnale arriva direttamente.
func ConfigureInterruptible(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

const InterruptHelperSource = ""

// Interrupt manda SIGINT al processo (il helper serve solo su Windows).
func Interrupt(pid int, _ string) error { return syscall.Kill(pid, syscall.SIGINT) }

func InterruptHelperPath() string { return "" }
