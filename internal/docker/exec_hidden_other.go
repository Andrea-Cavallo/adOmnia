//go:build !windows

package docker

import "os/exec"

func configureHiddenCommand(cmd *exec.Cmd) {
	_ = cmd
}
