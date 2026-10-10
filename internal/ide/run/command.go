package run

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
)

func ResolveCommandExecutable(root, workingDirectory, target string) (string, error) {
	if strings.ContainsAny(target, `/\`) {
		if err := validateRunTarget(root, workingDirectory, target); err != nil {
			return "", err
		}
		path := filepath.Clean(filepath.Join(workingDirectory, filepath.FromSlash(target)))
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			return "", fmt.Errorf("comando non trovato nel progetto: %s", target)
		}
		return path, nil
	}
	path, err := exec.LookPath(target)
	if err != nil {
		return "", fmt.Errorf("%s non trovato nel PATH", target)
	}
	return path, nil
}

func Command(root, wd, target string, args []string) (CommandSpec, error) {
	executable, err := ResolveCommandExecutable(root, wd, target)
	if err != nil {
		return CommandSpec{}, err
	}
	return CommandSpec{Executable: executable, Arguments: append([]string(nil), args...), WorkingDirectory: wd, DisplayCommand: displayCommand(target, args)}, nil
}

func NormalizeCommandConfiguration(config Configuration) (Configuration, error) {
	config.Target = strings.TrimSpace(config.Target)
	config.Files, config.BinaryPath = nil, ""
	if config.Kind == "command" && (config.Target == "" || strings.ContainsRune(config.Target, '\x00') || strings.HasPrefix(config.Target, "-")) {
		return config, fmt.Errorf("indica il comando da eseguire (es. npm, ./scripts/seed.sh)")
	}
	if config.Kind == "compound" {
		config.Target = ""
		ids := []string{}
		for _, id := range config.Compound {
			id = strings.TrimSpace(id)
			if id != "" && id != config.ID && !slices.Contains(ids, id) {
				ids = append(ids, id)
			}
		}
		if len(ids) < 2 {
			return config, fmt.Errorf("una configurazione compound avvia almeno due configurazioni")
		}
		if len(ids) > 10 {
			return config, fmt.Errorf("massimo 10 configurazioni in una compound")
		}
		config.Compound = ids
		// A compound may run tasks before its members (migrations, seed data), never after;
		// a member cannot also be one of its tasks.
		pre := []string{}
		for _, id := range config.PreRun {
			if !slices.Contains(ids, strings.TrimSpace(id)) {
				pre = append(pre, id)
			}
		}
		config.PreRun, config.PostRun = pre, nil
	} else {
		config.Compound = nil
	}
	return config, nil
}
