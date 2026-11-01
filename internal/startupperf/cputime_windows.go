//go:build windows

package startupperf

import (
	"syscall"
	"time"
)

// ProcessCPU restituisce il tempo CPU (user + kernel) consumato finora dal processo; 0 se non leggibile.
func ProcessCPU() time.Duration {
	handle, err := syscall.GetCurrentProcess()
	if err != nil {
		return 0
	}
	var creation, exit, kernel, user syscall.Filetime
	if err := syscall.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return 0
	}
	// Filetime conta intervalli da 100 ns.
	ticks := func(ft syscall.Filetime) int64 { return int64(ft.HighDateTime)<<32 | int64(ft.LowDateTime) }
	return time.Duration((ticks(kernel) + ticks(user)) * 100)
}
