//go:build !windows

package logstream

import "os/exec"

func hideConsole(_ *exec.Cmd) {}
