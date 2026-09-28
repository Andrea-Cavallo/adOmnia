//go:build windows

package goide

import (
	"fmt"
	"os/exec"
	"strconv"
	"syscall"
)

const (
	createNewProcessGroup = 0x00000200
	createNoWindow        = 0x08000000
)

func configureProcess(command *exec.Cmd, interactive bool) {
	flags := uint32(createNewProcessGroup)
	if !interactive {
		flags |= createNoWindow
	}
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags, HideWindow: !interactive}
}

func terminateProcessTree(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	kill := exec.Command("taskkill.exe", "/PID", strconv.Itoa(command.Process.Pid), "/T", "/F")
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if output, err := kill.CombinedOutput(); err != nil {
		return fmt.Errorf("arresto albero processi fallito: %w (%s)", err, string(output))
	}
	return nil
}
