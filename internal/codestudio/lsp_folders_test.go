package codestudio

import (
	"path/filepath"
	"reflect"
	"testing"

	"adomnia/internal/ide/project"
)

func TestWorkspaceFolderRoots(t *testing.T) {
	root := t.TempDir()
	unit := func(language, kind, directory string) project.Unit {
		return project.Unit{Language: language, Kind: kind, Root: filepath.Join(root, directory)}
	}
	monorepo := []project.Unit{unit("go", "module", "orders"), unit("go", "module", "payments"), unit("java", "module", "billing"), unit("go", "loose", "tools")}
	if got := workspaceFolderRoots(root, monorepo, "go"); !reflect.DeepEqual(got, []string{filepath.Join(root, "orders"), filepath.Join(root, "payments")}) {
		t.Fatalf("go: %v", got)
	}
	if got := workspaceFolderRoots(root, monorepo, "java"); len(got) != 1 {
		t.Fatalf("java: %v", got)
	}
	if got := workspaceFolderRoots(root, monorepo, "python"); got != nil {
		t.Fatalf("a language without units keeps the project root: %v", got)
	}
	withWork := append(monorepo, project.Unit{Language: "go", Kind: "workspace", Root: root})
	if got := workspaceFolderRoots(root, withWork, "go"); got != nil {
		t.Fatalf("go.work at the root keeps the project root: %v", got)
	}
}
