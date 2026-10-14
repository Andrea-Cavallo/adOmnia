//go:build windows

package process

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"adomnia/internal/procutil"
)

const createNewConsole = 0x00000010

// ConfigureInterruptible prepara un processo che si potrà fermare con Interrupt: su Windows una
// console propria nascosta e un gruppo di processi, perché CTRL_BREAK raggiunge solo una console.
func ConfigureInterruptible(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup | createNewConsole, HideWindow: true}
}

// InterruptHelperSource è il programma che manda CTRL_BREAK a un gruppo di processi: deve
// staccarsi dalla propria console e agganciarsi a quella del bersaglio, cosa che un processo
// GUI come adOmnia non può fare su sé stesso senza rischi.
const InterruptHelperSource = `package main

import (
	"os"
	"strconv"
	"syscall"
)

func main() {
	pid, _ := strconv.Atoi(os.Args[1])
	kernel := syscall.NewLazyDLL("kernel32.dll")
	kernel.NewProc("FreeConsole").Call()
	if ok, _, err := kernel.NewProc("AttachConsole").Call(uintptr(pid)); ok == 0 {
		os.Stderr.WriteString("AttachConsole: " + err.Error())
		os.Exit(2)
	}
	kernel.NewProc("SetConsoleCtrlHandler").Call(0, 1)
	if ok, _, err := kernel.NewProc("GenerateConsoleCtrlEvent").Call(1, uintptr(pid)); ok == 0 {
		os.Stderr.WriteString("GenerateConsoleCtrlEvent: " + err.Error())
		os.Exit(3)
	}
}
`

// Interrupt manda CTRL_BREAK (os.Interrupt in Go) al processo, tramite helper (compilato da InterruptHelperSource).
func Interrupt(pid int, helper string) error {
	if helper == "" {
		return errors.New("the interrupt helper is not available")
	}
	command := procutil.Command(helper, strconv.Itoa(pid))
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

// InterruptHelperPath è dove si mette in cache l'helper compilato.
func InterruptHelperPath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "adomnia", "ctrlbreak-v1.exe")
}
