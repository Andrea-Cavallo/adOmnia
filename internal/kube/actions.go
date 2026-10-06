package kube

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	execTimeout = 60 * time.Second
	// Output and file transfers are capped: the result travels as JSON to the UI.
	maxExecOutput = 1 << 20
	maxFileBytes  = 16 << 20
)

// PodTarget names one container of one pod.
type PodTarget struct {
	Context   string `json:"context"`
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container"`
}

func (t PodTarget) execArgs(stdin bool) ([]string, error) {
	if err := validateIdentifier(t.Namespace, "namespace"); err != nil {
		return nil, err
	}
	if err := validateIdentifier(t.Pod, "pod"); err != nil {
		return nil, err
	}
	args := []string{"exec"}
	if stdin {
		args = append(args, "-i")
	}
	args = append(args, t.Pod, "-n", t.Namespace)
	if t.Container != "" {
		if err := validateIdentifier(t.Container, "container"); err != nil {
			return nil, err
		}
		args = append(args, "-c", t.Container)
	}
	return append(args, "--"), nil
}

// ExecResult is the captured outcome of a one-shot command in a container.
type ExecResult struct {
	Output    string `json:"output"`
	Truncated bool   `json:"truncated"`
	Error     string `json:"error"`
}

// Exec runs one command in the container through `sh -c`, so pipes and
// redirections work as in a terminal. It is not interactive: stdin is closed.
func Exec(ctx context.Context, target PodTarget, command string) ExecResult {
	command = strings.TrimSpace(command)
	if command == "" {
		return ExecResult{Error: "type a command to run"}
	}
	args, err := target.execArgs(false)
	if err != nil {
		return ExecResult{Error: err.Error()}
	}
	out, err := runWith(ctx, target.Context, nil, execTimeout, append(args, "sh", "-c", command)...)
	result := ExecResult{}
	if len(out) > maxExecOutput {
		out, result.Truncated = out[len(out)-maxExecOutput:], true
	}
	result.Output = string(out)
	if err != nil {
		result.Error = err.Error()
	}
	return result
}

// remotePath rejects paths the shell commands below cannot take safely.
func remotePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("type a path inside the container")
	}
	if controlChars.MatchString(path) {
		return "", errors.New("invalid path")
	}
	return path, nil
}

// ReadFile copies one file out of the container. The path is passed as a
// positional argument to `head`, never spliced into a shell string; reading
// one byte past the cap bounds memory however large the file is.
func ReadFile(ctx context.Context, target PodTarget, path string) ([]byte, error) {
	path, err := remotePath(path)
	if err != nil {
		return nil, err
	}
	args, err := target.execArgs(false)
	if err != nil {
		return nil, err
	}
	out, err := runWith(ctx, target.Context, nil, execTimeout, append(args, "head", "-c", strconv.Itoa(maxFileBytes+1), "--", path)...)
	if err != nil {
		return nil, err
	}
	if len(out) > maxFileBytes {
		return nil, fmt.Errorf("the file is larger than %d MB", maxFileBytes>>20)
	}
	return out, nil
}

// WriteFile copies data into the container at path, replacing it. The path
// reaches the shell as "$1", so it is never parsed as shell syntax.
func WriteFile(ctx context.Context, target PodTarget, path string, data []byte) error {
	path, err := remotePath(path)
	if err != nil {
		return err
	}
	if len(data) > maxFileBytes {
		return fmt.Errorf("the file is larger than %d MB", maxFileBytes>>20)
	}
	args, err := target.execArgs(true)
	if err != nil {
		return err
	}
	_, err = runWith(ctx, target.Context, bytes.NewReader(data), execTimeout, append(args, "sh", "-c", `cat > "$1"`, "sh", path)...)
	return err
}
