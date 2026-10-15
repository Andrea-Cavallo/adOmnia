package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRepositoryFoldersIncludesWorktreesAndSkipsDependencies(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"api/.git", "worker", "node_modules/ignored/.git", ".cache/ignored/.git"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "worker/.git"), []byte("gitdir: /some/worktree\n"), 0600); err != nil {
		t.Fatal(err)
	}
	repos, err := RepositoryFolders(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(repos) != 2 || repos[0] != filepath.Join(root, "api") || repos[1] != filepath.Join(root, "worker") {
		t.Fatalf("unexpected repository folders: %v", repos)
	}
}
