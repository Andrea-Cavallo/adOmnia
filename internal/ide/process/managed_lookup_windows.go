//go:build windows

package process

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"

	"encoding/csv"
	"strconv"
	"strings"
)

// lookupProcess restituisce il nome del processo con il PID indicato, se è vivo.
func lookupProcess(pid int) (string, bool) {
	command := procutil.Command("tasklist.exe", "/FI", "PID eq "+strconv.Itoa(pid), "/FO", "CSV", "/NH")
	output, err := command.Output()
	if err != nil {
		return "", false
	}
	records, err := csv.NewReader(strings.NewReader(string(output))).ReadAll()
	if err != nil || len(records) == 0 || len(records[0]) < 2 {
		return "", false
	}
	if listed, err := strconv.Atoi(records[0][1]); err != nil || listed != pid {
		return "", false
	}
	return records[0][0], true
}
