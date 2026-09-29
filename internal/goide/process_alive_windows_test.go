//go:build windows

package goide

import (
	"os/exec"
	"strconv"
	"strings"
)

func processAlive(pid int) bool {
	output, err := exec.Command("tasklist", "/FI", "PID eq "+strconv.Itoa(pid), "/NH").Output()
	return err == nil && strings.Contains(string(output), " "+strconv.Itoa(pid)+" ")
}

// processExists indica se esiste un processo avviato dall'eseguibile indicato.
// Il confronto è sul percorso completo, quindi non coincide con altri processi
// che hanno soltanto lo stesso nome di immagine (es. altri __debug_bin.exe).
func processExists(executable string) bool {
	// Niente doppi apici nello script: il quoting degli argomenti di Windows li
	// altererebbe prima che arrivino a PowerShell.
	path := strings.ReplaceAll(executable, "'", "''")
	script := "@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '" + path + "' }).Count"
	output, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return false
	}
	count, err := strconv.Atoi(strings.TrimSpace(string(output)))
	return err == nil && count > 0
}
