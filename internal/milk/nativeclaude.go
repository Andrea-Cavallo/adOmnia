package milk

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// NativeClaude è l'eseguibile di Claude Code da dare all'adapter (CLAUDE_CODE_EXECUTABLE), "" se non ce n'è uno
// avviabile. Su Windows Node non sa avviare gli shim di npm (claude.cmd): spawn fallisce con EINVAL e
// session/new risponde -32603. Si usa quindi il claude.exe che lo shim lancia davvero, poi un claude.exe nel PATH.
func NativeClaude(lookPath func(string) (string, error)) string {
	return nativeClaude(runtime.GOOS, lookPath, filepath.SplitList(os.Getenv("PATH")))
}

func nativeClaude(goos string, lookPath func(string) (string, error), pathDirs []string) string {
	found, _ := lookPath("claude")
	if goos != "windows" {
		return found
	}
	switch strings.ToLower(filepath.Ext(found)) {
	case ".exe", ".com":
		return found
	}
	if found != "" {
		bundled := filepath.Join(filepath.Dir(found), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
		if isExecutableFile(bundled) {
			return bundled
		}
	}
	for _, dir := range pathDirs {
		if candidate := filepath.Join(dir, "claude.exe"); isExecutableFile(candidate) {
			return candidate
		}
	}
	return ""
}

// withNativeClaude points the Claude agent at a real claude.exe on Windows.
// An explicit CLAUDE_CODE_EXECUTABLE wins.
func withNativeClaude(env []string) []string {
	if runtime.GOOS != "windows" {
		return env
	}
	for _, entry := range env {
		if strings.HasPrefix(strings.ToUpper(entry), "CLAUDE_CODE_EXECUTABLE=") {
			return env
		}
	}
	if native := NativeClaude(exec.LookPath); native != "" {
		return append(env, "CLAUDE_CODE_EXECUTABLE="+native)
	}
	return env
}
