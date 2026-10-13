package goide

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCompareTreesReportsAddedRemovedAndModified(t *testing.T) {
	left, right := t.TempDir(), t.TempDir()
	write := func(root, path, content string) {
		t.Helper()
		absolute := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(absolute), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(absolute, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(left, "same.txt", "same")
	write(right, "same.txt", "same")
	write(left, "left.txt", "left")
	write(right, "right.txt", "right")
	write(left, "nested/change.txt", "before")
	write(right, "nested/change.txt", "after")
	differences, err := compareTrees(left, right)
	if err != nil {
		t.Fatal(err)
	}
	if len(differences) != 3 {
		t.Fatalf("differences = %#v", differences)
	}
	if differences[0].RelativePath != "left.txt" || differences[0].Status != "only-left" {
		t.Fatalf("first = %#v", differences[0])
	}
	if differences[1].Status != "modified" {
		t.Fatalf("second = %#v", differences[1])
	}
	if differences[2].RelativePath != "right.txt" || differences[2].Status != "only-right" {
		t.Fatalf("third = %#v", differences[2])
	}
}

func TestGistArgumentsKeepDescriptionAsOneArgument(t *testing.T) {
	got := gistArguments("C:/work/file.go", "a useful snippet", true)
	want := []string{"gist", "create", "C:/work/file.go", "--public", "--desc", "a useful snippet"}
	if len(got) != len(want) {
		t.Fatalf("arguments = %#v", got)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("arguments = %#v", got)
		}
	}
}
