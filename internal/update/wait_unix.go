//go:build !windows

package update

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"syscall"
	"time"
)

func waitForParent(pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if parentExited(pid) {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("app did not exit before update deadline")
}

// parentExited reports whether the process has truly finished. kill(pid, 0)
// alone is not enough: it keeps succeeding for a child that has exited but not
// yet been reaped by its parent (a zombie). On Linux, a reaped-awaiting process
// shows state 'Z' in /proc/<pid>/stat; treat that as exited so the helper never
// stalls behind a zombie parent.
func parentExited(pid int) bool {
	e := syscall.Kill(pid, 0)
	if errors.Is(e, syscall.ESRCH) {
		return true
	}
	if e != nil {
		return false
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return false
	}
	if i := strings.LastIndexByte(string(data), ')'); i >= 0 && i+2 < len(data) {
		return data[i+2] == 'Z'
	}
	return false
}
