package milk

import (
	"adomnia/internal/aipolicy"
	"context"
	"strings"
	"testing"
)

// Split so the repository never contains a contiguous credential-shaped string.
const fakeAWSKey = "AKIA" + "IOSFODNN7EXAMPLE"

// milk, Claude Code and OpenCode share the ACP manager, so the same boundary
// must mask secrets for every one of them before session/prompt is sent.
func TestPromptBlocksRedactSecretsForEveryACPAgent(t *testing.T) {
	agents := map[string]Agent{
		"milk":     {Name: "milk", Event: "milk", Protocol: 2},
		"claude":   {Name: "Claude Code", Event: "claude", Protocol: 1},
		"opencode": {Name: "OpenCode", Event: "opencode", Protocol: 1},
	}
	message := "Connect with postgres://app:sup3rSecret@db.internal/app and key " + fakeAWSKey
	for name, agent := range agents {
		t.Run(name, func(t *testing.T) {
			manager := NewAgentManager(NewSettingsStore(t.TempDir()), agent)
			blocks, cleanup, err := manager.promptBlocks(PromptRequest{Message: message})
			if err != nil {
				t.Fatal(err)
			}
			defer cleanup()
			if len(blocks) != 1 || blocks[0]["type"] != "text" {
				t.Fatalf("unexpected blocks: %+v", blocks)
			}
			sent := blocks[0]["text"]
			if strings.Contains(sent, "sup3rSecret") || strings.Contains(sent, fakeAWSKey) {
				t.Fatalf("secret reached %s: %q", name, sent)
			}
			if len(sent) != len(message) {
				t.Fatalf("mask changed prompt length: %d != %d", len(sent), len(message))
			}
		})
	}
}

// Every ACP entry point must also obey the project AI policy before it opens a
// session or sends a turn.
func TestAgentPolicyBlocksEveryACPEntryPoint(t *testing.T) {
	root := t.TempDir()
	if err := aipolicy.Save(root, aipolicy.Off); err != nil {
		t.Fatal(err)
	}
	for name, event := range map[string]string{"milk": "milk", "claude": "claude", "opencode": "opencode"} {
		t.Run(name, func(t *testing.T) {
			manager := NewAgentManager(NewSettingsStore(t.TempDir()), Agent{Name: name, Event: event, Protocol: 1})
			if _, err := manager.Prompt(context.Background(), PromptRequest{Root: root, Token: "t", Message: "hello"}); err == nil || !strings.Contains(err.Error(), "policy") {
				t.Fatalf("%s ignored the project policy: %v", name, err)
			}
		})
	}
}

func TestDisabledAgentDoesNotResolveOrSpawn(t *testing.T) {
	resolved := 0
	manager := NewAgentManager(NewSettingsStore(t.TempDir()), Agent{
		Name: "fixture", Event: "fixture", Protocol: 1,
		Resolve: func(Settings, string) (Launch, error) {
			resolved++
			return Launch{Binary: "never"}, nil
		},
	})
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	if resolved != 0 || manager.current != nil {
		t.Fatal("disabled agent was launched")
	}
	if manager.Status().State != StateDisabled {
		t.Fatalf("unexpected state: %s", manager.Status().State)
	}
}
