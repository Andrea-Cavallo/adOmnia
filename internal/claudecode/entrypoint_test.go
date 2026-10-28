package claudecode

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"strings"
	"testing"
)

// Split so the repository never contains a contiguous credential-shaped string.
const fakeGitHubToken = "gh" + "p_abcdefghijklmnopqrstuvwxyz0123456789"

// Claude Code is an ACP agent: adOmnia's prompt boundary must mask secrets even
// though the agent reads project files with its own tools afterwards.
func TestClaudeCodeEntryPointUsesSharedRedaction(t *testing.T) {
	agent := Agent()
	if agent.Event != "claude" || agent.Name != "Claude Code" {
		t.Fatalf("unexpected agent identity: %+v", agent)
	}
	message := "deploy with password := \"sup3rSecret\" and token " + fakeGitHubToken
	redacted := milk.RedactPromptText(message)
	if strings.Contains(redacted, "sup3rSecret") || strings.Contains(redacted, fakeGitHubToken) {
		t.Fatalf("secret reached Claude Code: %q", redacted)
	}
	if len(redacted) != len(message) {
		t.Fatalf("mask changed prompt length: %d != %d", len(redacted), len(message))
	}
}
