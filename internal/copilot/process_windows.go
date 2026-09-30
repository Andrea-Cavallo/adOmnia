//go:build windows

package copilot

import (
	"os/exec"
	"strconv"
	"syscall"
)

const (
	createNewProcessGroup = 0x00000200
	createNoWindow        = 0x08000000
)

// configureProcess nasconde la console del server e lo isola in un process group.
func configureProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup | createNoWindow, HideWindow: true}
}

// terminateProcess chiude il server e i suoi figli (ripgrep, worker) con taskkill /T.
func terminateProcess(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(command.Process.Pid))
	kill.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
	if err := kill.Run(); err != nil {
		return command.Process.Kill()
	}
	return nil
}
