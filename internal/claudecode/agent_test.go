package claudecode

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/milk"
)

func TestCommandPrefersAdapterThenNpx(t *testing.T) {
	previousProbe := offlineAdapterProbe
	offlineAdapterProbe = func(string) bool { return true }
	t.Cleanup(func() { offlineAdapterProbe = previousProbe })
	adapter := filepath.Join(t.TempDir(), "claude-agent-acp")
	if err := os.WriteFile(adapter, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}
	found := map[string]string{"claude-agent-acp": adapter, "npx": "/bin/npx"}
	look := func(name string) (string, error) {
		if path, ok := found[name]; ok {
			return path, nil
		}
		return "", errors.New("missing")
	}
	if got, _ := command(milk.Settings{}, look); got.Binary != adapter || len(got.Args) != 0 {
		t.Fatalf("adapter in PATH must win: %+v", got)
	}
	delete(found, "claude-agent-acp")
	if got, _ := command(milk.Settings{}, look); got.Binary != "/bin/npx" || len(got.Args) != 3 || got.Args[2] != AdapterPackage {
		t.Fatalf("npx fallback expected: %+v", got)
	}
	delete(found, "npx")
	if _, err := command(milk.Settings{}, look); !errors.Is(err, milk.ErrNotInstalled) {
		t.Fatalf("without node the state must be not-installed, got %v", err)
	}
}

func TestCommandDoesNotDownloadMissingAdapter(t *testing.T) {
	previousProbe := offlineAdapterProbe
	offlineAdapterProbe = func(string) bool { return false }
	t.Cleanup(func() { offlineAdapterProbe = previousProbe })
	look := func(name string) (string, error) {
		if name == "npx" {
			return "/bin/npx", nil
		}
		return "", errors.New("missing")
	}
	got, err := command(milk.Settings{}, look)
	if got.Binary != "/bin/npx" || !errors.Is(err, milk.ErrNotInstalled) {
		t.Fatalf("missing adapter must require explicit install: launch=%+v err=%v", got, err)
	}
}

func TestLaunchKeyDoesNotExposeSecrets(t *testing.T) {
	secret := "top-secret-value"
	key := launchKey(milk.Launch{Binary: "adapter"}, []string{"ANTHROPIC_MODEL=" + secret, "AWS_ACCESS_KEY_ID=" + secret})
	if strings.Contains(key, secret) {
		t.Fatal("launch key exposed an environment value")
	}
}

func TestResolveMergesProjectAndExplicitEnvironment(t *testing.T) {
	adapter := filepath.Join(t.TempDir(), "claude-agent-acp")
	if err := os.WriteFile(adapter, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".claude"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".claude", "settings.json"), []byte(`{"env":{"ADOMNIA_TEST_PROJECT":"project","ADOMNIA_TEST_OVERRIDE":"project"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	launch, err := resolve(milk.Settings{BinaryPath: adapter, Env: map[string]string{"ADOMNIA_TEST_OVERRIDE": "explicit"}, ExtraArgs: []string{"--test-argument"}}, root)
	if err != nil {
		t.Fatal(err)
	}
	if envValue(launch.Env, "ADOMNIA_TEST_PROJECT") != "project" || envValue(launch.Env, "ADOMNIA_TEST_OVERRIDE") != "explicit" {
		t.Fatalf("unexpected merged environment: %v", launch.Env)
	}
	if len(launch.Args) != 1 || launch.Args[0] != "--test-argument" {
		t.Fatalf("unexpected args: %v", launch.Args)
	}
}

func TestWithoutVarDropsOnlyTheKey(t *testing.T) {
	got := withoutVar([]string{"PATH=/bin", "anthropic_api_key=x", "ANTHROPIC_API_KEY_OTHER=y"}, apiKeyVar)
	if len(got) != 2 || got[0] != "PATH=/bin" || got[1] != "ANTHROPIC_API_KEY_OTHER=y" {
		t.Fatalf("unexpected env: %v", got)
	}
}
