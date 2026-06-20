package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConflictFileVersionsAndSaveResolution(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	file := filepath.Join(dir, "story.txt")
	writeFile(t, file, "base\n")
	if _, err := CommitAll(dir, "base"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(dir, "checkout", "-b", "incoming"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, file, "theirs\n")
	if _, err := CommitAll(dir, "theirs"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(dir, "checkout", "main"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, file, "ours\n")
	if _, err := CommitAll(dir, "ours"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(dir, "merge", "incoming"); err == nil {
		t.Fatal("expected merge conflict")
	}

	versions, err := GetConflictFileVersions(dir, "story.txt")
	if err != nil {
		t.Fatalf("GetConflictFileVersions: %v", err)
	}
	if !versions.BaseAvailable || !versions.OursAvailable || !versions.TheirsAvailable {
		t.Fatalf("expected all three sides: %+v", versions)
	}
	if versions.Base != "base\n" || versions.Ours != "ours\n" || versions.Theirs != "theirs\n" {
		t.Fatalf("unexpected sides: %+v", versions)
	}
	if !strings.Contains(versions.Result, "<<<<<<<") {
		t.Fatalf("working result should contain conflict markers: %q", versions.Result)
	}

	if err := SaveConflictResolution(dir, "story.txt", "merged\n"); err != nil {
		t.Fatalf("SaveConflictResolution: %v", err)
	}
	state, err := InspectState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.ConflictedFiles) != 0 {
		t.Fatalf("conflict should be resolved, got %v", state.ConflictedFiles)
	}
	content, _ := os.ReadFile(file)
	if string(content) != "merged\n" {
		t.Fatalf("unexpected merged content: %q", content)
	}
}
