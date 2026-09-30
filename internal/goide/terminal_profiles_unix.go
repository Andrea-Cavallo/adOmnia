//go:build !windows

package goide

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func detectTerminalProfiles() []TerminalProfile {
	var profiles []TerminalProfile
	seen := map[string]bool{}
	add := func(path string) {
		real, err := filepath.EvalSymlinks(path)
		if err != nil || seen[real] {
			return
		}
		seen[real] = true
		name := filepath.Base(path)
		id := name
		for index := 2; seen["id:"+id]; index++ {
			id = fmt.Sprintf("%s-%d", name, index)
		}
		seen["id:"+id] = true
		profiles = append(profiles, TerminalProfile{ID: id, Name: name, Kind: name, Shell: path, Arguments: []string{"-i"}})
	}
	if shell := os.Getenv("SHELL"); shell != "" {
		add(shell)
	}
	for _, name := range []string{"bash", "zsh", "fish", "sh"} {
		if path, err := exec.LookPath(name); err == nil {
			add(path)
		}
	}
	return profiles
}
