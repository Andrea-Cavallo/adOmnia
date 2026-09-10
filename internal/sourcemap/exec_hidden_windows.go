//go:build windows

package sourcemap

import (
	"os/exec"
	"syscall"
)

// hideConsole keeps a launched editor from flashing a console window.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
