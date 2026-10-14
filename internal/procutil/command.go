package procutil

import (
	"context"
	"os/exec"
)

// Command creates a background command using the platform policy for child
// processes. On Windows it cannot flash or retain a visible console window.
func Command(name string, args ...string) *exec.Cmd {
	command := exec.Command(name, args...)
	Hide(command)
	return command
}

// CommandContext is Command with cancellation through ctx.
func CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, name, args...)
	Hide(command)
	return command
}
