//go:build windows

package process

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"syscall"

	"adomnia/internal/procutil"
)

const (
	createNewProcessGroup = 0x00000200
	createNoWindow        = 0x08000000
	detachedProcess       = 0x00000008
)

func Configure(command *exec.Cmd, interactive bool) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
	if !interactive {
		procutil.Hide(command)
	}
}

// ConfigureDetachedGUI starts a desktop application independently from the
// current process without suppressing its window. It is intentionally separate
// from Configure: CREATE_NO_WINDOW/HideWindow would also hide a windowsgui app
// relaunched by the updater.
func ConfigureDetachedGUI(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | createNewProcessGroup}
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
	kill := procutil.Command("taskkill.exe", "/PID", strconv.Itoa(pid), "/T", "/F")
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
