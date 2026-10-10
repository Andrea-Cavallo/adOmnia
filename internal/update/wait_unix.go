//go:build !windows

package update

import (
	"errors"
	"fmt"
	"syscall"
	"time"
)

func waitForParent(pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		e := syscall.Kill(pid, 0)
		if errors.Is(e, syscall.ESRCH) {
			return nil
		}
		if e != nil {
			return e
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("app did not exit before update deadline")
}
