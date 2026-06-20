package git

import (
	"path/filepath"
	"testing"
)

func TestBlameLines_ReturnsStructuredOwnership(t *testing.T) {
	gitAvailable(t)
	dir := filepath.Join(t.TempDir(), "repo")
	if err := Init(Config{RepoPath: dir, Branch: "main", AuthorName: "Alice", AuthorEmail: "alice@example.com"}); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "notes.txt")
	writeFile(t, file, "first\nsecond\n")
	if _, err := CommitAll(dir, "initial"); err != nil {
		t.Fatal(err)
	}
	if err := ConfigureUser(dir, "Bob", "bob@example.com"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, file, "first\nchanged\n")
	if _, err := CommitAll(dir, "change second"); err != nil {
		t.Fatal(err)
	}

	lines, err := BlameLines(dir, "notes.txt")
	if err != nil {
		t.Fatalf("BlameLines: %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %+v", lines)
	}
	if lines[0].Author != "Alice" || lines[0].Content != "first" || lines[0].LineNumber != 1 {
		t.Fatalf("unexpected first line: %+v", lines[0])
	}
	if lines[1].Author != "Bob" || lines[1].Content != "changed" || lines[1].LineNumber != 2 {
		t.Fatalf("unexpected second line: %+v", lines[1])
	}
}
