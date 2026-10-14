//go:build windows

package milk

import (
	"os/exec"
	"strconv"
	"syscall"

	"adomnia/internal/procutil"
)

const (
	createNewProcessGroup = 0x00000200
)

// configureProcess nasconde la console di milk e lo isola in un process group.
func configureProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
	procutil.Hide(command)
}

// terminateProcess chiude milk e i suoi figli con taskkill /T.
func terminateProcess(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	kill := procutil.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(command.Process.Pid))
	if err := kill.Run(); err != nil {
		return command.Process.Kill()
	}
	return nil
}
