package copilot

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestProjectRulesRootFilesAndRefresh(t *testing.T) {
	root := t.TempDir()
	for _, name := range projectRuleNames {
		if err := os.WriteFile(filepath.Join(root, name), []byte("guide "+name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	got := ProjectRules(root)
	if len(got) != 4 {
		t.Fatalf("rules: %+v", got)
	}
	for i, name := range projectRuleNames {
		if got[i].Path != name || got[i].Text != "guide "+name {
			t.Fatal("unstable order/content")
		}
	}
	os.WriteFile(filepath.Join(root, ".rules"), []byte("updated"), 0600)
	if ProjectRules(root)[0].Text != "updated" {
		t.Fatal("stale guidance")
	}
	os.Remove(filepath.Join(root, ".rules"))
	if len(ProjectRules(root)) != 3 {
		t.Fatal("removed file retained")
	}
}

func TestProjectRulesPolicyFiltersAndBounds(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, ".adomnia"), 0700)
	os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte("excluded"), 0600)
	os.WriteFile(filepath.Join(root, ".adomnia", "aiignore"), []byte("AGENTS.md\n"), 0600)
	os.WriteFile(filepath.Join(root, "CLAUDE.md"), []byte(strings.Repeat("😀", maxProjectRuleBytes)), 0600)
	os.WriteFile(filepath.Join(root, ".rules"), []byte("binary\x00data"), 0600)
	os.Mkdir(filepath.Join(root, ".cursorrules"), 0700)
	got := ProjectRules(root)
	if len(got) != 1 || got[0].Path != "CLAUDE.md" || !got[0].Truncated || len(got[0].Text) > maxProjectRuleBytes || !utf8.ValidString(got[0].Text) {
		t.Fatalf("bad bounded rules: %d", len(got))
	}
	for _, policy := range []string{AIPolicyOff, AIPolicyLocalOnly} {
		if err := SaveAIPolicy(root, policy); err != nil {
			t.Fatal(err)
		}
		if len(ProjectRules(root)) != 0 {
			t.Fatalf("policy %s bypassed", policy)
		}
	}
}

func TestProjectRulesDoNotFollowLinks(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "private.md")
	os.WriteFile(outside, []byte("private"), 0600)
	if err := os.Symlink(outside, filepath.Join(root, "AGENTS.md")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if len(ProjectRules(root)) != 0 {
		t.Fatal("linked rules escaped root")
	}
}
