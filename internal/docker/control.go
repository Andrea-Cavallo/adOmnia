package docker

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"time"
)

var (
	healthInStatus    = regexp.MustCompile(`\((healthy|unhealthy|health: starting)\)`)
	labProjectPattern = regexp.MustCompile(`^adomnia-[a-z0-9][a-z0-9_-]*$`)
)

// containerHealth reads the healthcheck state Docker prints in the ps Status column:
// "healthy", "unhealthy", "starting", or "" when the container has no healthcheck.
func containerHealth(status string) string {
	match := healthInStatus.FindStringSubmatch(status)
	if match == nil {
		return ""
	}
	if match[1] == "health: starting" {
		return "starting"
	}
	return match[1]
}

// LabRestart restarts one container of the lab, or every service when containerID is empty.
// The container must belong to the lab: no arbitrary container can be restarted from here.
func (d *DockerLab) LabRestart(projectName, containerID string) (string, error) {
	if !labProjectPattern.MatchString(projectName) {
		return "", fmt.Errorf("not an adOmnia lab: %q", projectName)
	}
	args := []string{"compose", "-p", projectName, "restart"}
	if containerID != "" {
		if err := d.labContainer(projectName, containerID); err != nil {
			return "", err
		}
		args = []string{"restart", containerID}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", args...)
	configureHiddenCommand(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("docker restart failed: %w\n%s", err, string(out))
	}
	return string(out), nil
}

// labContainer checks that containerID is a container of the lab.
func (d *DockerLab) labContainer(projectName, containerID string) error {
	if !labProjectPattern.MatchString(projectName) {
		return fmt.Errorf("not an adOmnia lab: %q", projectName)
	}
	containers, err := d.LabStatus(projectName)
	if err != nil {
		return err
	}
	for _, container := range containers {
		if container.ID == containerID {
			return nil
		}
	}
	return fmt.Errorf("container %s is not part of %s", containerID, projectName)
}

// shellLauncher returns the command that opens the OS terminal running docker exec.
// ponytail: one terminal per OS, the common default; add a preference if users need another.
func shellLauncher(goos, containerID string) (string, []string, error) {
	execLine := "docker exec -it " + containerID + " sh"
	switch goos {
	case "windows":
		return "cmd", []string{"/c", "start", "adOmnia shell", "docker", "exec", "-it", containerID, "sh"}, nil
	case "darwin":
		return "osascript", []string{"-e", `tell application "Terminal" to do script "` + execLine + `"`, "-e", `tell application "Terminal" to activate`}, nil
	case "linux":
		for _, terminal := range []string{"x-terminal-emulator", "gnome-terminal", "konsole", "xterm"} {
			if _, err := exec.LookPath(terminal); err == nil {
				return terminal, []string{"-e", "docker", "exec", "-it", containerID, "sh"}, nil
			}
		}
		return "", nil, fmt.Errorf("no terminal emulator found: run %q yourself", execLine)
	}
	return "", nil, fmt.Errorf("unsupported OS: run %q yourself", execLine)
}

// LabShell opens a terminal with an interactive shell inside a lab container.
func (d *DockerLab) LabShell(projectName, containerID string) error {
	if err := d.labContainer(projectName, containerID); err != nil {
		return err
	}
	name, args, err := shellLauncher(runtime.GOOS, containerID)
	if err != nil {
		return err
	}
	cmd := exec.Command(name, args...)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("open terminal: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
