//go:build !windows

package goide

import (
	"os/exec"
	"strings"
	"syscall"
)

func processAlive(pid int) bool {
	return pid > 0 && syscall.Kill(pid, 0) == nil
}

// processExists indica se esiste un processo la cui riga di comando contiene
// il percorso indicato.
func processExists(fragment string) bool {
	output, err := exec.Command("pgrep", "-f", fragment).Output()
	return err == nil && len(strings.TrimSpace(string(output))) > 0
}
