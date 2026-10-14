package milk

import (
	"errors"
	"strings"
	"testing"
)

func TestStartupFailureClassifiesCorporateRedirect(t *testing.T) {
	message := startupFailureMessage("Claude Code", errors.New("closed"), []string{"npm error code EMAXREDIRECT", "maximum redirect reached at: https://user:secret@10.0.0.4/UserCheck/PortalMain"}, nil)
	if !strings.Contains(message, "corporate proxy") || strings.Contains(message, "secret") || strings.Contains(message, "milk process") {
		t.Fatalf("unexpected classified message: %s", message)
	}
}

func TestAgentLogRedactsEnvironmentSecrets(t *testing.T) {
	got := redactAgentText(`AWS_ACCESS_KEY_ID=abc ANTHROPIC_API_KEY:"secret" CLAUDE_CODE_USE_BEDROCK=1 harmless=yes`)
	if strings.Contains(got, "abc") || strings.Contains(got, "secret") || strings.Contains(got, "=1") || !strings.Contains(got, "harmless=yes") {
		t.Fatalf("unexpected redaction: %s", got)
	}
}
