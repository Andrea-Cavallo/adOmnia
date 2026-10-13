//go:build windows

package process

import (
	"os/exec"
	"testing"
)

func TestConfigureDetachedGUIKeepsWindowVisible(t *testing.T) {
	command := exec.Command("adomnia.exe")
	ConfigureDetachedGUI(command)
	if command.SysProcAttr == nil {
		t.Fatal("missing Windows process attributes")
	}
	if command.SysProcAttr.HideWindow {
		t.Fatal("desktop relaunch must not set HideWindow")
	}
	if command.SysProcAttr.CreationFlags&createNoWindow != 0 {
		t.Fatal("desktop relaunch must not set CREATE_NO_WINDOW")
	}
	want := uint32(detachedProcess | createNewProcessGroup)
	if command.SysProcAttr.CreationFlags != want {
		t.Fatalf("creation flags = %#x, want %#x", command.SysProcAttr.CreationFlags, want)
	}
}
