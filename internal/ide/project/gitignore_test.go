package project

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGitIgnoreRules(t *testing.T) {
	root := t.TempDir()
	content := "# comment\n*.log\n/dist\nbuild/\ndocs/**/*.tmp\n!keep.log\ngen/*.go\n"
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	ignore := LoadGitIgnore(root)
	cases := []struct {
		path  string
		isDir bool
		want  bool
	}{
		{"app.log", false, true},
		{"sub/deep/app.log", false, true},
		{"keep.log", false, false},
		{"dist", true, true},
		{"sub/dist", true, false},
		{"build", true, true},
		{"build", false, false},
		{"docs/a/b/x.tmp", false, true},
		{"docs/x.tmp", false, true},
		{"gen/x.go", false, true},
		{"gen/sub/x.go", false, false},
		{"main.go", false, false},
	}
	for _, tc := range cases {
		if got := ignore.Ignored(tc.path, tc.isDir); got != tc.want {
			t.Errorf("Ignored(%q, dir=%v) = %v, want %v", tc.path, tc.isDir, got, tc.want)
		}
	}
	if LoadGitIgnore(t.TempDir()).Ignored("x.log", false) {
		t.Error("senza .gitignore nulla va escluso")
	}
}
