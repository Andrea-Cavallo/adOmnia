package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Una lettura dello stato non deve riscrivere .git/index: su Windows quella scrittura veniva vista dal
// watcher del progetto e rilanciava lo stato Git in un ciclo che teneva occupata la CPU.
func TestStatusDoesNotRewriteTheIndex(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	file := filepath.Join(repo, "main.go")
	if err := os.WriteFile(file, []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", ".")
	run("commit", "-q", "-m", "init")
	index := filepath.Join(repo, ".git", "index")
	past := time.Now().Add(-time.Hour)
	if err := os.Chtimes(index, past, past); err != nil {
		t.Fatal(err)
	}
	// Stesso contenuto, data nuova: git status vorrebbe aggiornare la cache dell'indice.
	if err := os.Chtimes(file, time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := statusPorcelain(repo); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(index)
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(past) {
		t.Fatalf("git status rewrote .git/index (mtime %s)", info.ModTime())
	}
}
