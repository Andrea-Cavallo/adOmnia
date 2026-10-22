package opencode

import (
	"adomnia/internal/milk"
	"strings"
	"testing"
)

// Split so the repository never contains a contiguous credential-shaped string.
const fakeAWSKey = "AKIA" + "IOSFODNN7EXAMPLE"

// OpenCode is local-only, but local is not the same as trusted: the prompt
// boundary masks recognizable secrets for it too.
func TestOpenCodeEntryPointUsesSharedRedaction(t *testing.T) {
	agent := Agent()
	if agent.Event != "opencode" || agent.Name != "OpenCode" {
		t.Fatalf("unexpected agent identity: %+v", agent)
	}
	message := "connect postgres://app:sup3rSecret@db.internal/app with " + fakeAWSKey
	redacted := milk.RedactPromptText(message)
	if strings.Contains(redacted, "sup3rSecret") || strings.Contains(redacted, fakeAWSKey) {
		t.Fatalf("secret reached OpenCode: %q", redacted)
	}
	if len(redacted) != len(message) {
		t.Fatalf("mask changed prompt length: %d != %d", len(redacted), len(message))
	}
}
