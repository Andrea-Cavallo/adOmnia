package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestVCSWorkingDiffCoversEveryKindOfChange(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git non disponibile")
	}
	repo := t.TempDir()
	gitCommand(t, repo, "init", "-q", "-b", "main")
	writeFixtureFile(t, repo, "go.mod", "module example.com/diff\n\ngo 1.22\n")
	writeFixtureFile(t, repo, "main.go", "package main\n\nfunc main() {}\n")
	writeFixtureFile(t, repo, "old.go", "package main\n")
	gitCommand(t, repo, "add", "go.mod", "main.go", "old.go")
	gitCommand(t, repo, "commit", "-q", "-m", "init")
	writeFixtureFile(t, repo, "main.go", "package main\n\nfunc main() { println(1) }\n")
	writeFixtureFile(t, repo, "new.go", "package main\n\nconst x = 1\n")
	if err := os.Remove(filepath.Join(repo, "old.go")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "logo.png"), []byte{0x89, 'P', 'N', 'G', 0, 1, 2}, 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(repo)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	cases := map[string]func(VCSWorkingDiff) bool{
		"main.go":  func(d VCSWorkingDiff) bool { return d.Original == "package main\n\nfunc main() {}\n" && d.Modified == "package main\n\nfunc main() { println(1) }\n" },
		"new.go":   func(d VCSWorkingDiff) bool { return d.Original == "" && d.Modified != "" },
		"old.go":   func(d VCSWorkingDiff) bool { return d.Original == "package main\n" && d.Modified == "" },
		"logo.png": func(d VCSWorkingDiff) bool { return d.Binary && d.Modified == "" },
	}
	for path, check := range cases {
		diff, err := service.VCSWorkingDiff(id, path)
		if err != nil || !check(diff) {
			t.Errorf("%s: diff inatteso %+v %v", path, diff, err)
		}
	}
}
