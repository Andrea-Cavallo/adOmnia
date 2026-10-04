//go:build windows

package kube

import (
	"os/exec"
	"syscall"
)

// hideConsole keeps kubectl from flashing a console window on Windows.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
