package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestLocalReplacesAtHeadReadsCommittedGoMods(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git non disponibile")
	}
	repo := t.TempDir()
	run := func(args ...string) {
		command := exec.Command("git", args...)
		command.Dir = repo
		command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=A", "GIT_AUTHOR_EMAIL=a@x", "GIT_COMMITTER_NAME=A", "GIT_COMMITTER_EMAIL=a@x")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, output)
		}
	}
	write := func(name, content string) {
		path := filepath.Join(repo, filepath.FromSlash(name))
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	run("init", "-q", "-b", "main")
	write("go.mod", "module a\n\ngo 1.22\n\nreplace example.com/lib => ../lib\n\nreplace example.com/fork => example.com/fork2 v1.0.0\n")
	write("svc/go.mod", "module b\n\ngo 1.22\n// replace example.com/old => ../old\n")
	run("add", "go.mod", "svc/go.mod")
	run("commit", "-q", "-m", "init")
	// Un replace solo nella copia di lavoro non viene pubblicato dal push.
	write("svc/go.mod", "module b\n\ngo 1.22\n\nreplace example.com/x => ./x\n")

	replaces, err := LocalReplacesAtHead(repo)
	if err != nil {
		t.Fatal(err)
	}
	if len(replaces) != 1 || replaces[0] != (LocalReplace{File: "go.mod", Module: "example.com/lib", Target: "../lib"}) {
		t.Fatalf("replace locali inattesi: %+v", replaces)
	}
}
