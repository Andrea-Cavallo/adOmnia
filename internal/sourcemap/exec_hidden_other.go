//go:build !windows

package sourcemap

import "os/exec"

func hideConsole(_ *exec.Cmd) {}
