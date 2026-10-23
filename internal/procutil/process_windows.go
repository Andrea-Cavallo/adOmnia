//go:build windows

package procutil

import (
	"os/exec"
	"strconv"
	"syscall"
)

const createNewProcessGroup = 0x00000200

// ConfigureChild nasconde la console del figlio e lo isola in un process group. Condiviso da
// copilot e milk (prima erano due file identici per package).
func ConfigureChild(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
	Hide(command)
}

// KillTree chiude il figlio e i suoi figli (ripgrep, worker, node) con taskkill /T.
func KillTree(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	kill := Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(command.Process.Pid))
	if err := kill.Run(); err != nil {
		return command.Process.Kill()
	}
	return nil
}
