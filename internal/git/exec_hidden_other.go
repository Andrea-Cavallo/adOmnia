//go:build !windows

package git

import "os/exec"

// configureHiddenCommand is a no-op on non-Windows platforms, where CLI child
// processes do not pop up console windows.
func configureHiddenCommand(cmd *exec.Cmd) {
	_ = cmd
}
