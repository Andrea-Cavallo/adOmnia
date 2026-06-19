package git

import (
	"os"
	"strconv"
)

// pathExists reports whether a filesystem path exists (file or directory).
func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// atoiSafe parses an int, returning 0 on any error so callers can stay terse.
func atoiSafe(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}
