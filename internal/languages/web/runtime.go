package web

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"adomnia/internal/ide/process"
	"adomnia/internal/procutil"
)

// Runtime descrive Node.js e il package manager trovati per un progetto.
type Runtime struct {
	NodeAvailable bool   `json:"nodeAvailable"`
	NodeBinary    string `json:"nodeBinary,omitempty"`
	NodeVersion   string `json:"nodeVersion,omitempty"`
	// PackageManagerAvailable e PackageManagerBinary riguardano il package manager scelto.
	PackageManagerAvailable bool   `json:"packageManagerAvailable"`
	PackageManagerBinary    string `json:"packageManagerBinary,omitempty"`
	PackageManagerVersion   string `json:"packageManagerVersion,omitempty"`
	// Problem è il messaggio per l'utente quando manca qualcosa; Remedies sono le soluzioni possibili.
	Problem  string   `json:"problem,omitempty"`
	Remedies []string `json:"remedies,omitempty"`
}

// Ready è vero quando si può eseguire uno script del package manager.
func (r Runtime) Ready() bool { return r.NodeAvailable && r.PackageManagerAvailable }

// DetectRuntime cerca Node.js e il package manager nel PATH. Non avvia nulla oltre a `--version`.
// bun non richiede Node: per bun l'assenza di Node non è un problema.
func DetectRuntime(manager string) Runtime {
	runtime := Runtime{}
	if binary, err := exec.LookPath("node"); err == nil {
		runtime.NodeBinary = binary
		if version, versionErr := toolVersion(binary); versionErr == nil {
			runtime.NodeAvailable, runtime.NodeVersion = true, strings.TrimPrefix(version, "v")
		}
	}
	if manager == "" {
		manager = NPM
	}
	if binary, err := exec.LookPath(manager); err == nil {
		runtime.PackageManagerBinary = binary
		if version, versionErr := toolVersion(binary); versionErr == nil {
			runtime.PackageManagerAvailable, runtime.PackageManagerVersion = true, version
		}
	}
	if manager == Bun {
		runtime.NodeAvailable = runtime.NodeAvailable || runtime.PackageManagerAvailable
	}
	runtime.Problem, runtime.Remedies = diagnose(runtime, manager)
	return runtime
}

func diagnose(runtime Runtime, manager string) (string, []string) {
	switch {
	case !runtime.NodeAvailable && manager != Bun:
		return "Node.js was not found on this machine", []string{
			"Install the current LTS from https://nodejs.org (Windows: winget install OpenJS.NodeJS.LTS)",
			"Or use a version manager such as fnm or nvm, then restart adOmnia so it sees the new PATH",
		}
	case !runtime.PackageManagerAvailable:
		return fmt.Sprintf("%s was not found on this machine", manager), packageManagerRemedies(manager)
	}
	return "", nil
}

func packageManagerRemedies(manager string) []string {
	switch manager {
	case PNPM:
		return []string{"Run `corepack enable` (ships with Node.js) or `npm install -g pnpm`", "Or switch the project to npm by deleting pnpm-lock.yaml (adOmnia never does this for you)"}
	case Yarn:
		return []string{"Run `corepack enable` (ships with Node.js) or `npm install -g yarn`"}
	case Bun:
		return []string{"Install bun from https://bun.sh"}
	}
	return []string{"npm ships with Node.js: reinstall Node.js from https://nodejs.org"}
}

const versionTimeout = 5 * time.Second

func toolVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), versionTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, binary, "--version")
	process.Configure(command, false)
	output, err := command.Output()
	if ctx.Err() != nil {
		return "", fmt.Errorf("%s does not answer --version", binary)
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0]), nil
}

// NodeMajor estrae la major da una versione come "22.14.0"; 0 se non leggibile.
func NodeMajor(version string) int {
	major, _, _ := strings.Cut(strings.TrimPrefix(version, "v"), ".")
	value, err := strconv.Atoi(major)
	if err != nil {
		return 0
	}
	return value
}
