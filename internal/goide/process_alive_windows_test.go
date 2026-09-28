//go:build windows

package goide

import (
	"os/exec"
	"strconv"
	"strings"
)

func processAlive(pid int) bool {
	output, err := exec.Command("tasklist", "/FI", "PID eq "+strconv.Itoa(pid), "/NH").Output()
	return err == nil && strings.Contains(string(output), " "+strconv.Itoa(pid)+" ")
}
