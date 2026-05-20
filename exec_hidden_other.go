//go:build !windows

package main

import "os/exec"

func configureHiddenCommand(cmd *exec.Cmd) {
	_ = cmd
}
