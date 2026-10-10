package claudecode

import (
	"errors"
	"testing"

	"adomnia/internal/milk"
)

func TestCommandPrefersAdapterThenNpx(t *testing.T) {
	found := map[string]string{"claude-agent-acp": "/bin/claude-agent-acp", "npx": "/bin/npx"}
	look := func(name string) (string, error) {
		if path, ok := found[name]; ok {
			return path, nil
		}
		return "", errors.New("missing")
	}
	if got, _ := command(milk.Settings{}, look); got.Binary != "/bin/claude-agent-acp" || len(got.Args) != 0 {
		t.Fatalf("adapter in PATH must win: %+v", got)
	}
	delete(found, "claude-agent-acp")
	if got, _ := command(milk.Settings{}, look); got.Binary != "/bin/npx" || got.Args[1] != AdapterPackage {
		t.Fatalf("npx fallback expected: %+v", got)
	}
	delete(found, "npx")
	if _, err := command(milk.Settings{}, look); !errors.Is(err, milk.ErrNotInstalled) {
		t.Fatalf("without node the state must be not-installed, got %v", err)
	}
}

func TestWithoutVarDropsOnlyTheKey(t *testing.T) {
	got := withoutVar([]string{"PATH=/bin", "anthropic_api_key=x", "ANTHROPIC_API_KEY_OTHER=y"}, apiKeyVar)
	if len(got) != 2 || got[0] != "PATH=/bin" || got[1] != "ANTHROPIC_API_KEY_OTHER=y" {
		t.Fatalf("unexpected env: %v", got)
	}
}
