//go:build windows

package update

import (
	"testing"
)

func TestDesktopRelaunchDoesNotRequestHiddenStartupWindow(t *testing.T) {
	command := newDesktopCommand("adomnia.exe")
	if command.SysProcAttr == nil {
		t.Fatal("missing Windows process attributes")
	}
	if command.SysProcAttr.HideWindow {
		t.Fatal("GUI relaunch requested a hidden window")
	}
	if command.SysProcAttr.CreationFlags&0x08000000 != 0 {
		t.Fatal("GUI relaunch requested CREATE_NO_WINDOW")
	}
	// os/exec only emits STARTF_USESHOWWINDOW when SysProcAttr.HideWindow is true.
}
