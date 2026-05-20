//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func configureHiddenCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
