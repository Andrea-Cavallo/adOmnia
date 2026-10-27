//go:build !windows

package proctest

import (
	"strings"
	"syscall"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

func Alive(pid int) bool {
	return pid > 0 && syscall.Kill(pid, 0) == nil
}

// Exists indica se esiste un processo la cui riga di comando contiene
// il percorso indicato.
func Exists(fragment string) bool {
	output, err := procutil.Command("pgrep", "-f", fragment).Output()
	return err == nil && len(strings.TrimSpace(string(output))) > 0
}
