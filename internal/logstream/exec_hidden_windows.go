//go:build windows

package logstream

import (
	"os/exec"
	"syscall"
)

// hideConsole keeps kubectl/oc/docker from flashing a console window.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
