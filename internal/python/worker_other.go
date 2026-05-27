//go:build !windows

package python

import (
	"log"
	"os/exec"
)

// enforceWorkerMemoryLimit is a no-op on non-Windows platforms.
// Linux could use setrlimit via syscall.Setrlimit, but macOS has no reliable
// process memory limit mechanism. For now, log that limits are best-effort.
func enforceWorkerMemoryLimit(cmd *exec.Cmd, memoryMB int) {
	if cmd == nil || cmd.Process == nil || memoryMB <= 0 {
		return
	}
	log.Printf("[python-worker] memory limit (%d MB) is best-effort on this platform (pid=%d)", memoryMB, cmd.Process.Pid)
}
