package rust

import (
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/language"
)

func TestFormatToolUsesRustfmt(t *testing.T) {
	root := t.TempDir()
	rustfmt := writeFile(t, root, "rustfmt.exe", "")
	original := lookPath
	lookPath = func(name string) (string, error) { return rustfmt, nil }
	defer func() { lookPath = original }()

	spec, available, reason, err := New().FormatTool(language.FormatRequest{
		Root: root, WorkingDirectory: root, RelativePath: "src/main.rs",
	})
	if err != nil || !available || reason != "" {
		t.Fatalf("spec=%+v available=%v reason=%q err=%v", spec, available, reason, err)
	}
	if joined := strings.Join(spec.Arguments, " "); joined != "--emit stdout --edition 2021" {
		t.Fatalf("arguments = %q", joined)
	}
	// La working directory è la cartella del file, così rustfmt legge rustfmt.toml.
	if spec.WorkingDirectory != filepath.Join(root, "src") {
		t.Fatalf("working directory = %q", spec.WorkingDirectory)
	}
}

func TestFormatToolReadsEdition(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"app\"\nedition = \"2018\"\n")
	if edition := rustEdition(root); edition != "2018" {
		t.Fatalf("edition = %q", edition)
	}
	other := t.TempDir()
	if edition := rustEdition(other); edition != "2021" {
		t.Fatalf("default edition = %q", edition)
	}
}

func TestFormatToolUnavailableWithoutRustfmt(t *testing.T) {
	original := lookPath
	lookPath = func(string) (string, error) { return "", errNotFound }
	defer func() { lookPath = original }()

	_, available, reason, err := New().FormatTool(language.FormatRequest{Root: t.TempDir(), WorkingDirectory: t.TempDir()})
	if err != nil || available || !strings.Contains(reason, "rustfmt is not installed") {
		t.Fatalf("available=%v reason=%q err=%v", available, reason, err)
	}
}
