package rust

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestComponentInstallPlan(t *testing.T) {
	original := lookPath
	lookPath = func(string) (string, error) { return filepath.Join(t.TempDir(), "rustup"), nil }
	defer func() { lookPath = original }()

	plan, err := New().ComponentInstallPlan("rust-src")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(plan.Arguments, " ") != "component add rust-src" {
		t.Fatalf("arguments = %#v", plan.Arguments)
	}
	if _, err := New().ComponentInstallPlan("bad name"); err == nil {
		t.Fatal("invalid component accepted")
	}
}

func TestToolchainInstallPlan(t *testing.T) {
	original := lookPath
	lookPath = func(string) (string, error) { return filepath.Join(t.TempDir(), "rustup"), nil }
	defer func() { lookPath = original }()

	plan, err := New().ToolchainInstallPlan("1.85.0")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(plan.Arguments, " ") != "toolchain install 1.85.0" {
		t.Fatalf("arguments = %#v", plan.Arguments)
	}
	for _, bad := range []string{"../evil", "channel with space", "1.85;"} {
		if _, err := New().ToolchainInstallPlan(bad); err == nil {
			t.Fatalf("invalid channel %q accepted", bad)
		}
	}
	// Versioni parziali e nightly datate sono canali validi.
	for _, ok := range []string{"stable", "nightly", "1.85", "1.85.0", "nightly-2024-01-01"} {
		if _, err := New().ToolchainInstallPlan(ok); err != nil {
			t.Fatalf("valid channel %q rejected: %v", ok, err)
		}
	}
}

func TestInstallPlansRequireRustup(t *testing.T) {
	original := lookPath
	lookPath = func(string) (string, error) { return "", errNotFound }
	defer func() { lookPath = original }()

	if _, err := New().ComponentInstallPlan("clippy"); err == nil {
		t.Fatal("install without rustup must fail")
	}
}
