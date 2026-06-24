package git

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func repoWithOrigin(t *testing.T, remote string) string {
	t.Helper()
	dir := t.TempDir()
	if out, err := exec.Command("git", "-C", dir, "init").CombinedOutput(); err != nil {
		t.Fatalf("git init: %s: %v", out, err)
	}
	if out, err := exec.Command("git", "-C", dir, "remote", "add", "origin", remote).CombinedOutput(); err != nil {
		t.Fatalf("git remote: %s: %v", out, err)
	}
	return dir
}

func TestRemoteProjectForProviders(t *testing.T) {
	tests := []struct{ provider, remote, owner, project, repo string }{
		{"github", "git@github.com:acme/tool.git", "acme", "", "tool"},
		{"gitlab", "https://gitlab.example.com/platform/team/tool.git", "platform/team", "", "tool"},
		{"bitbucket", "https://bitbucket.org/acme/tool.git", "acme", "", "tool"},
		{"azure", "https://dev.azure.com/acme/platform/_git/tool", "", "platform", "tool"},
	}
	for _, tt := range tests {
		t.Run(tt.provider, func(t *testing.T) {
			got, err := remoteProjectFor(repoWithOrigin(t, tt.remote), tt.provider)
			if err != nil {
				t.Fatal(err)
			}
			if got.Owner != tt.owner || got.Project != tt.project || got.Repo != tt.repo {
				t.Fatalf("unexpected project: %#v", got)
			}
		})
	}
}

func TestRunTerminalCommandUsesRepositoryCWDAndExitCode(t *testing.T) {
	repo := repoWithOrigin(t, "https://github.com/acme/tool.git")
	command := "pwd"
	if runtime.GOOS == "windows" {
		command = "(Get-Location).Path"
	}
	result, err := RunTerminalCommand(repo, command)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(result.Output) != filepath.Clean(repo) {
		t.Fatalf("cwd = %q, want %q", result.Output, repo)
	}

	failing := "exit 7"
	if runtime.GOOS == "windows" {
		failing = "exit 7"
	}
	result, err = RunTerminalCommand(repo, failing)
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode != 7 {
		t.Fatalf("exit code = %d, want 7", result.ExitCode)
	}
}
