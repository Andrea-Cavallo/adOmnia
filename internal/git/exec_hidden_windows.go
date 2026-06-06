//go:build windows

package git

import (
	"os/exec"
	"syscall"
)

// configureHiddenCommand prevents a console window from flashing on screen for
// each git invocation on Windows. GetOverview alone spawns ~7 git processes, so
// without this the user sees a burst of terminal windows when loading a repo.
func configureHiddenCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
