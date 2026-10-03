package golang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestToolchainWarning(t *testing.T) {
	cases := []struct {
		name, local, goDirective, toolchain, gotoolchain, want string
	}{
		{"satisfied", "go1.26.5", "1.26", "", "auto", ""},
		{"no go.mod", "go1.26.5", "", "", "auto", ""},
		{"local too old", "go1.24.1", "1.26.0", "", "local", "GOTOOLCHAIN=local"},
		{"auto default never downloads", "go1.24.1", "1.26.0", "", "auto", "non scarica toolchain da solo"},
		{"explicit user toolchain downloads", "go1.24.1", "1.26.0", "", "go1.26.0+auto", "scaricherà go1.26.0"},
		{"toolchain directive wins", "go1.26.0", "1.26.0", "go1.26.5", "local", "richiede go1.26.5"},
		{"unknown local", "", "1.30", "", "local", ""},
	}
	for _, tc := range cases {
		got := toolchainWarning(tc.local, tc.goDirective, tc.toolchain, tc.gotoolchain)
		if (tc.want == "") != (got == "") || !strings.Contains(got, tc.want) {
			t.Errorf("%s: got %q, want containing %q", tc.name, got, tc.want)
		}
	}
	if localGoVersion("go version go1.26.5 windows/amd64") != "go1.26.5" {
		t.Error("localGoVersion must extract go1.26.5")
	}
}

func TestReadModuleDirectives(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module x\n\ngo 1.25.0\n\ntoolchain go1.26.5\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	goDirective, toolchain := readModuleDirectives(root)
	if goDirective != "1.25.0" || toolchain != "go1.26.5" {
		t.Fatalf("got %q %q", goDirective, toolchain)
	}
}

func TestToolchainGlobalFallbackAndPersistence(t *testing.T) {
	manager := NewToolchainManager[string]()
	if err := manager.ConfigureGlobal(ToolchainConfiguration{Environment: map[string]string{"CGO_ENABLED": "0", "GOPROXY": "https://user:secret@proxy.example"}}); err != nil {
		t.Fatal(err)
	}
	if manager.Configuration("s1").Environment["CGO_ENABLED"] != "0" {
		t.Fatal("a session without its own config must use the global toolchain")
	}
	if err := manager.Configure("s1", ToolchainConfiguration{Environment: map[string]string{"GOOS": "linux"}}); err != nil {
		t.Fatal(err)
	}
	if env := manager.Configuration("s1").Environment; env["GOOS"] != "linux" || env["CGO_ENABLED"] != "" {
		t.Fatalf("project config must replace the global one: %v", env)
	}
	configs, global := manager.Snapshot()
	if _, leaked := global.Environment["GOPROXY"]; leaked || global.Environment["CGO_ENABLED"] != "0" {
		t.Fatalf("credentials in URLs must not be persisted: %v", global.Environment)
	}
	restored := NewToolchainManager[string]()
	restored.Replace(configs, global)
	restored.ResetSession("s1")
	if restored.Configuration("s1").Environment["CGO_ENABLED"] != "0" {
		t.Fatal("reset must fall back to the global toolchain")
	}
}
