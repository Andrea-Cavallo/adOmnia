package milk

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// withNativeClaude points the Claude agent at a real claude.exe on Windows.
// Node refuses to spawn npm's claude.cmd shim without a shell ("spawn EINVAL"),
// which makes session/new fail with -32603. An explicit CLAUDE_CODE_EXECUTABLE wins.
func withNativeClaude(env []string) []string {
	if runtime.GOOS != "windows" {
		return env
	}
	for _, entry := range env {
		if strings.HasPrefix(strings.ToUpper(entry), "CLAUDE_CODE_EXECUTABLE=") {
			return env
		}
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		candidate := filepath.Join(dir, "claude.exe")
		if isExecutableFile(candidate) {
			return append(env, "CLAUDE_CODE_EXECUTABLE="+candidate)
		}
	}
	return env
}
