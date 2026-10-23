//go:build !windows

package procutil

import (
	"os/exec"
	"syscall"
)

// ConfigureChild mette il figlio in un process group proprio, così KillTree lo chiude con i suoi
// figli. Condiviso da copilot e milk (prima erano due file identici per package).
func ConfigureChild(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// KillTree chiude il figlio e tutto il suo process group (server MCP e i loro worker compresi).
func KillTree(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	return syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
}
