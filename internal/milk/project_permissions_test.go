package milk

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectRulesApplyToTheSessionProjectAndItsWorktrees(t *testing.T) {
	store := NewProjectPermissionStore(t.TempDir())
	project := t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, ".git", "worktrees", "task-1"), 0o755); err != nil {
		t.Fatal(err)
	}
	worktree := t.TempDir()
	gitdir := filepath.Join(project, ".git", "worktrees", "task-1")
	if err := os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: "+gitdir+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Save(project, map[string]string{PermissionShell: RuleDeny, PermissionWrite: RuleAsk}); err != nil {
		t.Fatal(err)
	}
	if rules := store.Rules(worktree); rules[PermissionShell] != RuleDeny || len(rules) != 1 {
		t.Fatalf("a task worktree must use its project's rules: %v", rules)
	}
	if rules := store.Rules(t.TempDir()); len(rules) != 0 {
		t.Fatalf("another project must not inherit the rules: %v", rules)
	}

	manager := NewManager(NewSettingsStore(t.TempDir()))
	manager.SetEmitter(func(string, any) {})
	manager.SetProjectPermissions(store.Rules)
	manager.settings.SkipPermissions = true // the project deny still wins
	manager.rootBySession["s"] = worktree
	h := &handler{manager: manager}
	denied, err := h.HandleRequest(context.Background(), "session/request_permission", permissionRequest("execute"))
	if err != nil || !strings.Contains(jsonString(t, denied), `"no"`) {
		t.Fatalf("shell must be denied by the project rule: %v %v", jsonString(t, denied), err)
	}

	if err := store.Forget(worktree); err != nil {
		t.Fatal(err)
	}
	if rules := store.Rules(project); len(rules) != 0 {
		t.Fatalf("revoking trust must drop the project's rules: %v", rules)
	}
}

func TestCombinePermission(t *testing.T) {
	for _, tc := range []struct{ agent, project, want string }{
		{RuleAsk, RuleAsk, RuleAsk},
		{RuleAllow, RuleDeny, RuleDeny},
		{RuleDeny, RuleAllow, RuleDeny},
		{RuleAsk, RuleAllow, RuleAllow},
		{RuleAllow, "", RuleAllow},
	} {
		if got := combinePermission(tc.agent, tc.project); got != tc.want {
			t.Errorf("combinePermission(%q, %q) = %q, want %q", tc.agent, tc.project, got, tc.want)
		}
	}
}
