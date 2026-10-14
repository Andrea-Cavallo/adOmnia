//go:build !windows

package procutil

import "os/exec"

func Hide(_ *exec.Cmd) {}
