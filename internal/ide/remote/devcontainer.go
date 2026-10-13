package remote

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// DevContainerCLI resolves a local executable without installing or shell-evaluating it.
func DevContainerCLI() (string, []string, error) {
	cli, err := exec.LookPath("devcontainer")
	if err != nil {
		return "", nil, fmt.Errorf("install the Dev Container CLI locally and ensure Docker is running")
	}
	ext := strings.ToLower(filepath.Ext(cli))
	if ext == ".cmd" || ext == ".bat" {
		script := filepath.Join(filepath.Dir(cli), "node_modules", "@devcontainers", "cli", "dist", "spec-node", "devContainersSpecCLI.js")
		if _, err := os.Stat(script); err != nil {
			return "", nil, fmt.Errorf("cannot resolve the local Dev Container CLI Node entrypoint: %w", err)
		}
		node, err := exec.LookPath("node")
		if err != nil {
			return "", nil, fmt.Errorf("Node.js is required by the installed Dev Container CLI")
		}
		return node, []string{script}, nil
	}
	return cli, nil, nil
}

func ParseDevContainerResult(output string) (Target, error) {
	var result struct {
		Outcome               string `json:"outcome"`
		ContainerID           string `json:"containerId"`
		RemoteUser            string `json:"remoteUser"`
		RemoteWorkspaceFolder string `json:"remoteWorkspaceFolder"`
		Description           string `json:"description"`
	}
	found := false
	for _, line := range strings.Split(output, "\n") {
		var candidate = result
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &candidate) == nil && candidate.Outcome != "" {
			result = candidate
			found = true
		}
	}
	if !found || result.Outcome != "success" {
		return Target{}, fmt.Errorf("dev container startup did not return success: %s", result.Description)
	}
	target := Target{Kind: KindContainer, Name: result.ContainerID, Directory: result.RemoteWorkspaceFolder, User: result.RemoteUser}
	if err := target.Validate(); err != nil {
		return Target{}, err
	}
	return target, nil
}
