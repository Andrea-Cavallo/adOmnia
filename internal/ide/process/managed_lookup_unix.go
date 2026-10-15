//go:build !windows

package process

import (
	"adomnia/internal/procutil"

	"strconv"
	"strings"
)

// lookupProcess restituisce il nome del processo con il PID indicato, se è vivo.
func lookupProcess(pid int) (string, bool) {
	command := procutil.Command("ps", "-p", strconv.Itoa(pid), "-o", "comm=")
	output, err := command.Output()
	if err != nil {
		return "", false
	}
	name := strings.TrimSpace(string(output))
	if name == "" {
		return "", false
	}
	if slash := strings.LastIndex(name, "/"); slash >= 0 {
		name = name[slash+1:]
	}
	return name, true
}
