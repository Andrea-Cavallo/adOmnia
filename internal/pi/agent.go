// Package pi adapts Pi's official JSONL RPC mode to adOmnia's shared ACP host.
package pi

import (
	"context"
	_ "embed"
	"encoding/json/v2"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

const Package = "@earendil-works/pi-coding-agent@1.4.0"

//go:embed permission-extension.ts
var permissionExtension []byte

func Agent(directory string) milk.Agent {
	return milk.Agent{Name: "Pi", Event: "pi", Protocol: 1, Resolve: func(settings milk.Settings, _ string) (milk.Launch, error) {
		command, err := ResolveCommand(settings.BinaryPath, directory)
		if err != nil {
			return milk.Launch{}, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		probe := procutil.CommandContext(ctx, command[0], append(append([]string{}, command[1:]...), "--version")...)
		probe.Env = environment(settings.Env)
		output, err := probe.Output()
		version := strings.TrimSpace(string(output))
		var major, minor int
		_, versionError := fmt.Sscanf(strings.TrimPrefix(version, "v"), "%d.%d", &major, &minor)
		if err != nil || versionError != nil {
			return milk.Launch{}, fmt.Errorf("cannot verify Pi version; install Pi 1.4.0 from settings")
		}
		if major < 1 || (major == 1 && minor < 4) {
			return milk.Launch{}, milk.Outdated("Pi 1.4.0 or later is required for RPC turn completion")
		}
		executable, err := os.Executable()
		if err != nil {
			return milk.Launch{}, err
		}
		raw, _ := json.Marshal(command)
		return milk.Launch{Binary: executable, Args: []string{"--pi-acp-bridge", string(raw)}, Env: environment(settings.Env), Version: version}, nil
	}}
}

func environment(extra map[string]string) []string {
	result := netpolicy.Environ()
	for key, value := range extra {
		prefix := key + "="
		for index := len(result) - 1; index >= 0; index-- {
			if strings.EqualFold(strings.SplitN(result[index], "=", 2)[0], key) {
				result = append(result[:index], result[index+1:]...)
			}
		}
		result = append(result, prefix+value)
	}
	return result
}

func ResolveCommand(custom, directory string) ([]string, error) {
	candidates := []string{}
	if custom != "" {
		candidates = append(candidates, custom)
	} else {
		candidates = append(candidates, filepath.Join(directory, "pi-runtime", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"))
		if found, err := exec.LookPath("pi"); err == nil {
			candidates = append(candidates, found)
		}
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err != nil || info.IsDir() {
			continue
		}
		if runtime.GOOS == "windows" && (strings.HasSuffix(candidate, ".cmd") || strings.HasSuffix(candidate, ".ps1")) {
			for _, pkg := range []string{"@earendil-works", "@mariozechner"} {
				for _, entry := range []string{"dist/bundle/cli.js", "dist/cli.js"} {
					path := filepath.Join(filepath.Dir(candidate), "node_modules", pkg, "pi-coding-agent", filepath.FromSlash(entry))
					if _, err := os.Stat(path); err == nil {
						candidate = path
						break
					}
				}
				if strings.HasSuffix(candidate, ".js") {
					break
				}
			}
		}
		if strings.HasSuffix(candidate, ".js") || strings.HasSuffix(candidate, ".mjs") {
			node, err := exec.LookPath("node")
			if err != nil {
				return nil, milk.NotInstalled("Pi requires Node.js in PATH")
			}
			return []string{node, candidate}, nil
		}
		if runtime.GOOS != "windows" || strings.HasSuffix(strings.ToLower(candidate), ".exe") {
			return []string{candidate}, nil
		}
	}
	return nil, milk.NotInstalled("Pi is not installed. Install it from Pi settings or select its executable.")
}

func Install(ctx context.Context, directory string) (string, error) {
	if err := netpolicy.Allow("pi-install", "registry.npmjs.org"); err != nil {
		return "", err
	}
	npm, err := exec.LookPath("npm")
	if err != nil {
		return "", fmt.Errorf("install Node.js before installing Pi")
	}
	// npm's JS entry avoids invoking a shell or a Windows .cmd shim.
	node, err := exec.LookPath("node")
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(npm); err == nil {
		npm = resolved
	}
	cli := filepath.Join(filepath.Dir(npm), "node_modules", "npm", "bin", "npm-cli.js")
	if filepath.Base(npm) == "npm-cli.js" {
		cli = npm
	}
	if _, err := os.Stat(cli); err != nil {
		return "", fmt.Errorf("cannot find npm-cli.js beside npm: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	command := procutil.CommandContext(ctx, node, cli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", filepath.Join(directory, "pi-runtime"), Package)
	command.Env = netpolicy.Environ()
	if output, err := command.CombinedOutput(); err != nil {
		return "", fmt.Errorf("Pi install failed: %w: %s", err, milk.RedactAgentText(string(output)))
	}
	return filepath.Join(directory, "pi-runtime", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"), nil
}
