//go:build windows

package procutil

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// Hide merges the no-console policy into existing process attributes so callers
// can keep flags such as CREATE_NEW_PROCESS_GROUP.
func Hide(command *exec.Cmd) {
	if command.SysProcAttr == nil {
		command.SysProcAttr = &syscall.SysProcAttr{}
	}
	command.SysProcAttr.HideWindow = true
	command.SysProcAttr.CreationFlags |= createNoWindow
}
