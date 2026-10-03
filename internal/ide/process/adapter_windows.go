//go:build windows

package process

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

const (
	createNewProcessGroup = 0x00000200
	createNoWindow        = 0x08000000
)

func Configure(command *exec.Cmd, interactive bool) {
	flags := uint32(createNewProcessGroup)
	if !interactive {
		flags |= createNoWindow
	}
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags, HideWindow: !interactive}
}

func TerminateTree(command *exec.Cmd) error {
	if command == nil || command.Process == nil {
		return nil
	}
	return TerminateTreeByPID(command.Process.Pid)
}

// TerminateTreeByPID arresta un intero albero di processi a partire dal
// PID indicato, usato dal terminale PTY che non possiede un *exec.Cmd.
func TerminateTreeByPID(pid int) error {
	if pid <= 0 {
		return nil
	}
	kill := exec.Command("taskkill.exe", "/PID", strconv.Itoa(pid), "/T", "/F")
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if output, err := kill.CombinedOutput(); err != nil {
		return fmt.Errorf("arresto albero processi fallito: %w (%s)", err, string(output))
	}
	return nil
}

// DefaultShell restituisce la shell interattiva predefinita della piattaforma.
func DefaultShell() (string, []string) {
	if shell := os.Getenv("COMSPEC"); shell != "" {
		return shell, nil
	}
	return "cmd.exe", nil
}
