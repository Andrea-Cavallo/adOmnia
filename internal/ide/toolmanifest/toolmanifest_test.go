package toolmanifest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureWritesManifestOnFirstVerificationAndThenCompares(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, ManifestFile)
	report := []byte(`{"tool":"demo","version":"1.2.3"}`)
	artifacts := []Artifact{{Name: "demo.zip", Version: "1.2.3", URL: "https://example.invalid/demo.zip", SHA256: strings.Repeat("a", 64)}}

	if err := Ensure(path, "demo", "1.2.3", artifacts, report); err != nil {
		t.Fatalf("first verification should record the manifest: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the manifest was not written: %v", err)
	}
	if err := Ensure(path, "demo", "1.2.3", artifacts, report); err != nil {
		t.Fatalf("the same report must verify again: %v", err)
	}

	// Un report diverso (o un artefatto cambiato) non corrisponde più al manifest.
	if err := Ensure(path, "demo", "1.2.3", artifacts, []byte(`{"tool":"demo","version":"1.2.4"}`)); err == nil || !strings.Contains(err.Error(), "reinstall") {
		t.Fatalf("a changed report must require a reinstall, got %v", err)
	}
	changed := []Artifact{{Name: "demo.zip", Version: "1.2.3", URL: "https://example.invalid/demo.zip", SHA256: strings.Repeat("b", 64)}}
	if err := Ensure(path, "demo", "1.2.3", changed, report); err == nil || !strings.Contains(err.Error(), "reinstall") {
		t.Fatalf("a changed artifact must require a reinstall, got %v", err)
	}
}

func TestEnsureRejectsUnreadableManifest(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, ManifestFile)
	if err := os.WriteFile(path, []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := Ensure(path, "demo", "1.2.3", nil, []byte("{}"))
	if err == nil || !strings.Contains(err.Error(), "manifest is unreadable") {
		t.Fatalf("an unreadable manifest must require a reinstall, got %v", err)
	}
}

func TestParseReportValidatesToolVersionAndHashes(t *testing.T) {
	valid := `{"tool":"codelldb","version":"v1.12.3","artifacts":[{"name":"a.vsix","version":"v1.12.3","url":"https://example.invalid/a.vsix","sha256":"` + strings.Repeat("A", 64) + `"}]}`
	report, err := ParseReport([]byte(valid))
	if err != nil {
		t.Fatalf("valid report rejected: %v", err)
	}
	if report.Tool != "codelldb" || report.Version != "v1.12.3" || len(report.Artifacts) != 1 {
		t.Fatalf("unexpected report: %+v", report)
	}
	if report.Artifacts[0].SHA256 != strings.Repeat("a", 64) {
		t.Fatalf("the SHA-256 must be normalized to lowercase: %q", report.Artifacts[0].SHA256)
	}

	for name, data := range map[string]string{
		"unreadable":       `{`,
		"no tool":          `{"version":"1.0.0","artifacts":[{"name":"a","version":"1.0.0","sha256":"` + strings.Repeat("a", 64) + `"}]}`,
		"no version":       `{"tool":"demo","artifacts":[{"name":"a","version":"1.0.0","sha256":"` + strings.Repeat("a", 64) + `"}]}`,
		"no artifacts":     `{"tool":"demo","version":"1.0.0"}`,
		"no artifact sha":  `{"tool":"demo","version":"1.0.0","artifacts":[{"name":"a","version":"1.0.0"}]}`,
		"bad artifact sha": `{"tool":"demo","version":"1.0.0","artifacts":[{"name":"a","version":"1.0.0","sha256":"zz"}]}`,
		"no artifact name": `{"tool":"demo","version":"1.0.0","artifacts":[{"version":"1.0.0","sha256":"` + strings.Repeat("a", 64) + `"}]}`,
	} {
		if _, err := ParseReport([]byte(data)); err == nil {
			t.Errorf("%s: report must be rejected", name)
		}
	}
}

func TestIsSHA256AndDigest(t *testing.T) {
	if !IsSHA256(strings.Repeat("0", 64)) || IsSHA256("abc") || IsSHA256(strings.Repeat("z", 64)) {
		t.Fatal("IsSHA256 accepts or rejects the wrong values")
	}
	// SHA-256 di stringa vuota, noto.
	if digest := Digest(nil); digest != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" {
		t.Fatalf("unexpected digest of empty input: %s", digest)
	}
}
