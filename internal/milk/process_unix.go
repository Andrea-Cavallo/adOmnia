//go:build !windows

package milk

import (
	"os/exec"
	"syscall"
)

// configureProcess mette milk in un process group proprio, così lo si chiude con i suoi figli.
func configureProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateProcess(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	return syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
}
