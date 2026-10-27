package proctest

import "runtime"

// ShellEcho is the line that makes an interactive shell print marker, with the platform line ending.
func ShellEcho(marker string) string {
	if runtime.GOOS == "windows" {
		return "echo " + marker + "\r\n"
	}
	return "echo " + marker + "\n"
}
