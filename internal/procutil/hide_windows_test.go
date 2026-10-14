//go:build windows

package procutil

import (
	"os/exec"
	"syscall"
	"testing"
)

func TestHideMergesExistingProcessFlags(t *testing.T) {
	command := exec.Command("cmd.exe")
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x200}
	Hide(command)
	if !command.SysProcAttr.HideWindow {
		t.Fatal("hidden child process does not request SW_HIDE")
	}
	if command.SysProcAttr.CreationFlags&createNoWindow == 0 || command.SysProcAttr.CreationFlags&0x200 == 0 {
		t.Fatalf("process flags were not merged: %#x", command.SysProcAttr.CreationFlags)
	}
}
