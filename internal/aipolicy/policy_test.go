package aipolicy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSavePolicy(t *testing.T) {
	root := t.TempDir()
	if got := Load(root); got != Allowed {
		t.Fatalf("missing file must mean allowed, got %q", got)
	}
	if err := Save(root, LocalOnly); err != nil {
		t.Fatal(err)
	}
	if got := Load(root); got != LocalOnly {
		t.Fatalf("local-only not persisted, got %q", got)
	}
	if err := Save(root, Off); err != nil {
		t.Fatal(err)
	}
	if got := Load(root); got != Off {
		t.Fatalf("off not persisted, got %q", got)
	}
	// A broken document must fail closed.
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(File)), []byte(`{"ai":`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Load(root); got != Off {
		t.Fatalf("broken file must mean off, got %q", got)
	}
	// An unknown value must also fail closed.
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(File)), []byte(`{"ai":"maybe"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Load(root); got != Off {
		t.Fatalf("unknown value must mean off, got %q", got)
	}
	if err := Save(root, Allowed); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(File))); !os.IsNotExist(err) {
		t.Fatalf("allowed must remove the file, stat err = %v", err)
	}
	if got := Load(root); got != Allowed {
		t.Fatalf("allowed not restored, got %q", got)
	}
	if err := Save(root, "everything"); err == nil {
		t.Fatal("invalid policy accepted")
	}
}

func TestAllows(t *testing.T) {
	cases := []struct {
		policy string
		local  bool
		want   bool
	}{
		{Allowed, false, true},
		{Allowed, true, true},
		{LocalOnly, false, false},
		{LocalOnly, true, true},
		{Off, false, false},
		{Off, true, false},
		{"unknown", false, false},
		{"", true, false},
	}
	for _, tc := range cases {
		if got := Allows(tc.policy, tc.local); got != tc.want {
			t.Errorf("Allows(%q, %v) = %v, want %v", tc.policy, tc.local, got, tc.want)
		}
	}
}
