package codestudio

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

const maxScriptSuggestions = 8

// scriptDirectories are the only places scanned for runnable scripts: the project root and the usual script folders.
var scriptDirectories = []string{"", "scripts", "script", "bin"}

// scriptSuggestions proposes a generic Shell Command for the shell scripts (.sh, .ps1, .bat, .cmd) found at the
// project root or in scripts/: language independent, so it belongs to the host and not to an adapter. A script
// is proposed only when its interpreter exists, and the process is launched without a shell.
func scriptSuggestions(projectRoot string) []run.Suggestion {
	var found []run.Suggestion
	for _, directory := range scriptDirectories {
		entries, err := os.ReadDir(filepath.Join(projectRoot, directory))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || len(found) >= maxScriptSuggestions {
				continue
			}
			relative := filepath.ToSlash(filepath.Join(directory, entry.Name()))
			interpreter, arguments, ok := scriptCommand(relative, exec.LookPath, runtime.GOOS)
			if !ok {
				continue
			}
			found = append(found, run.Suggestion{
				ID: "script|" + relative, Action: "run", UnitRoot: projectRoot,
				Title: "Script · " + relative,
				Configuration: run.Configuration{
					Name: "Script " + entry.Name(), Kind: "command", Target: interpreter, ProgramArguments: arguments,
				},
			})
		}
	}
	return found
}

// scriptCommand maps a script path to the interpreter command that runs it, or false when the file is not a
// script or its interpreter is not installed.
func scriptCommand(relative string, lookPath func(string) (string, error), goos string) (string, []string, bool) {
	has := func(name string) bool { _, err := lookPath(name); return err == nil }
	switch strings.ToLower(filepath.Ext(relative)) {
	case ".sh":
		if has("bash") {
			return "bash", []string{relative}, true
		}
	case ".ps1":
		if goos == "windows" && has("powershell") {
			return "powershell", []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", relative}, true
		}
		if has("pwsh") {
			return "pwsh", []string{"-NoProfile", "-File", relative}, true
		}
	case ".bat", ".cmd":
		if goos == "windows" {
			return "cmd", []string{"/c", relative}, true
		}
	}
	return "", nil, false
}
