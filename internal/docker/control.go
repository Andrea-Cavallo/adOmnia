package docker

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
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
	cmd := procutil.CommandContext(ctx, "docker", args...)
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

// LabExec runs one explicit shell command inside a lab-owned container. Output
// is returned to the embedded Docker Lab console; no OS terminal is opened.
func (d *DockerLab) LabExec(projectName, containerID, command string) (string, error) {
	command, err := validLabCommand(command)
	if err != nil {
		return "", err
	}
	if err := d.labContainer(projectName, containerID); err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := procutil.CommandContext(ctx, "docker", "exec", containerID, "sh", "-lc", command)
	output := newBoundedOutput(2 << 20)
	cmd.Stdout = output
	cmd.Stderr = output
	err = cmd.Run()
	if ctx.Err() != nil {
		return output.String(), fmt.Errorf("container command timed out")
	}
	if err != nil {
		return output.String(), fmt.Errorf("container command failed: %w", err)
	}
	return output.String(), nil
}

func validLabCommand(command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", fmt.Errorf("shell command is empty")
	}
	if len(command) > 4096 {
		return "", fmt.Errorf("shell command is too long")
	}
	return command, nil
}

type boundedOutput struct {
	mu        sync.Mutex
	data      []byte
	limit     int
	truncated bool
}

func newBoundedOutput(limit int) *boundedOutput {
	return &boundedOutput{limit: limit}
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	written := len(p)
	remaining := b.limit - len(b.data)
	if remaining > 0 {
		if remaining > len(p) {
			remaining = len(p)
		}
		b.data = append(b.data, p[:remaining]...)
	}
	if remaining < len(p) {
		b.truncated = true
	}
	return written, nil
}

func (b *boundedOutput) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.truncated {
		return string(b.data) + "\n[output truncated]\n"
	}
	return string(b.data)
}
