//go:build windows

package update

import (
	"fmt"
	"golang.org/x/sys/windows"
	"time"
)

func waitForParent(pid int, timeout time.Duration) error {
	h, e := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if e != nil {
		if e == windows.ERROR_INVALID_PARAMETER {
			return nil
		} // parent already exited
		return e
	}
	defer windows.CloseHandle(h)
	result, e := windows.WaitForSingleObject(h, uint32(timeout.Milliseconds()))
	if e != nil {
		return e
	}
	if result != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("app did not exit before update deadline")
	}
	return nil
}
