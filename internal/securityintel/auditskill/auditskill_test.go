package auditskill

import (
	"archive/tar"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func archiveOf(t *testing.T, files map[string]string) *tar.Reader {
	t.Helper()
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	for name, body := range files {
		if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return tar.NewReader(&buffer)
}

func TestExtractCopiesOnlyTheSkillFolder(t *testing.T) {
	target := t.TempDir()
	err := extract(archiveOf(t, map[string]string{
		"repo-sha/README.md":                           "readme",
		"repo-sha/skills/security-audit/SKILL.md":      "skill",
		"repo-sha/skills/security-audit/sub/HUNT.md":   "hunt",
		"repo-sha/skills/security-audit/../../evil.md": "evil",
		"repo-sha/skills/other/SKILL.md":               "other",
	}), target)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"SKILL.md", filepath.Join("sub", "HUNT.md")} {
		if _, err := os.Stat(filepath.Join(target, name)); err != nil {
			t.Errorf("%s not extracted: %v", name, err)
		}
	}
	entries, _ := os.ReadDir(target)
	if len(entries) != 2 {
		t.Errorf("unexpected files extracted: %v", entries)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(target), "evil.md")); err == nil {
		t.Error("path traversal escaped the target")
	}
}

func TestExtractRequiresSkillFile(t *testing.T) {
	if err := extract(archiveOf(t, map[string]string{"repo/skills/security-audit/HUNT.md": "x"}), t.TempDir()); err == nil {
		t.Fatal("an archive without SKILL.md must fail")
	}
}

func TestParseFindingsSummarisesEveryVerdict(t *testing.T) {
	findings, err := parseFindings([]byte(`[
	 {"verdict":"confirmed","fingerprint":"a","title":"SQLi","description":"d","trace":[{"kind":"entrypoint","file":"api.go","line":3},{"kind":"sink","file":"db.go","line":9}],"severity":{"overall_severity":"high"},"confidence":{"score":"high"},"remediation":{"strategy":"bind params"}},
	 {"verdict":"needs_validation","fingerprint":"b","title":"SSRF","description":"d","trace":[{"kind":"entrypoint","file":"fetch.go","line":1}],"blockers":["proxy config unknown"]},
	 {"verdict":"rejected","fingerprint":"c","title":"XSS","description":"d","trace":[],"reason":"escaped by template"}]`))
	if err != nil {
		t.Fatal(err)
	}
	if got := findings[0]; got.Severity != "high" || got.File != "db.go" || got.Line != 9 || got.Remediation != "bind params" {
		t.Errorf("confirmed finding = %+v", got)
	}
	if got := findings[1]; got.File != "fetch.go" || len(got.Blockers) != 1 {
		t.Errorf("needs_validation finding = %+v", got)
	}
	if got := findings[2]; len(got.Blockers) != 1 || got.Blockers[0] != "escaped by template" {
		t.Errorf("rejected finding = %+v", got)
	}
}

func TestPrepareNumbersRunsAndWritesThePrompt(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	skill := filepath.Join(home, ".agents", "skills", Name)
	if err := os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(home, "My Project")
	if err := os.MkdirAll(filepath.Join(home, "security-audit-skill", "My-Project", "run-2"), 0o755); err != nil {
		t.Fatal(err)
	}
	prepared, err := Prepare(root, "quick", "auth")
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Run.Number != 3 || filepath.Base(prepared.Run.Dir) != "run-3" {
		t.Errorf("run = %+v", prepared.Run)
	}
	for _, want := range []string{filepath.Join(skill, "SKILL.md"), "full audit mode", "Profile: quick", "Prior runs", "Prioritise: auth"} {
		if !strings.Contains(prepared.Prompt, want) {
			t.Errorf("prompt misses %q:\n%s", want, prepared.Prompt)
		}
	}
	if _, err := Prepare(root, "extreme", ""); err == nil {
		t.Error("an unknown profile must fail")
	}
	if _, err := ReadReport(root, 0); err == nil {
		t.Error("run 0 must be rejected")
	}
}
