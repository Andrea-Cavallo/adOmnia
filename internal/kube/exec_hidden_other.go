//go:build !windows

package kube

import "os/exec"

func hideConsole(_ *exec.Cmd) {}
