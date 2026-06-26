//go:build !windows

package nettools

import "os/exec"

func configureHiddenCommand(cmd *exec.Cmd) {
	_ = cmd
}
