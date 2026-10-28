//go:build windows

package proctest

import (
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

func Alive(pid int) bool {
	output, err := procutil.Command("tasklist", "/FI", "PID eq "+strconv.Itoa(pid), "/NH").Output()
	return err == nil && strings.Contains(string(output), " "+strconv.Itoa(pid)+" ")
}

// Exists indica se esiste un processo avviato dall'eseguibile indicato.
// Il confronto è sul percorso completo, quindi non coincide con altri processi
// che hanno soltanto lo stesso nome di immagine (es. altri __debug_bin.exe).
func Exists(executable string) bool {
	// Niente doppi apici nello script: il quoting degli argomenti di Windows li
	// altererebbe prima che arrivino a PowerShell.
	path := strings.ReplaceAll(executable, "'", "''")
	script := "@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '" + path + "' }).Count"
	output, err := procutil.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return false
	}
	count, err := strconv.Atoi(strings.TrimSpace(string(output)))
	return err == nil && count > 0
}
