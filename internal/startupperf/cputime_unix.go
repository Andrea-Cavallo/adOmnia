//go:build !windows

package startupperf

import (
	"syscall"
	"time"
)

// ProcessCPU restituisce il tempo CPU (user + system) consumato finora dal processo; 0 se non leggibile.
func ProcessCPU() time.Duration {
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return 0
	}
	return time.Duration(usage.Utime.Nano() + usage.Stime.Nano())
}
