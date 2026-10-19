package project

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

type recordingVisitor struct {
	visits    []DirectoryVisit
	descend   func(DirectoryVisit) bool
	recordErr error
}

func (v *recordingVisitor) VisitDirectory(visit DirectoryVisit) bool {
	v.visits = append(v.visits, visit)
	if v.descend != nil {
		return v.descend(visit)
	}
	return true
}

func (v *recordingVisitor) Units() ([]Unit, error) { return nil, v.recordErr }

func makeTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, path := range []string{"a", "b/c", "node_modules/dep", "build/out"} {
		if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(path)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{"a/main.go", "b/c/readme.md", "node_modules/dep/index.js", "go.mod"} {
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestWalkDirectoriesSharesOneVisitPerDirectory(t *testing.T) {
	root := makeTree(t)
	first, second := &recordingVisitor{}, &recordingVisitor{}
	if err := WalkDirectories(context.Background(), root, 100, first, second); err != nil {
		t.Fatal(err)
	}
	// root, a, b, b/c: node_modules and build are ignored for everyone.
	want := []string{root, filepath.Join(root, "a"), filepath.Join(root, "b"), filepath.Join(root, "b", "c")}
	for index, visit := range first.visits {
		if visit.Path != want[index] || second.visits[index].Path != want[index] {
			t.Fatalf("visit %d = %s / %s, want %s", index, visit.Path, second.visits[index].Path, want[index])
		}
	}
	if len(first.visits) != len(want) || len(second.visits) != len(want) {
		t.Fatalf("visits = %d / %d, want %d", len(first.visits), len(second.visits), len(want))
	}
	if first.visits[0].Depth != 0 || first.visits[1].Depth != 1 {
		t.Fatalf("depths = %d / %d", first.visits[0].Depth, first.visits[1].Depth)
	}
	files := map[string]bool{}
	for _, name := range first.visits[0].Files {
		files[name] = true
	}
	if !files["go.mod"] {
		t.Fatalf("root files = %v", first.visits[0].Files)
	}
}

func TestWalkDirectoriesKeepsOtherVisitorsDescending(t *testing.T) {
	root := makeTree(t)
	shallow := &recordingVisitor{descend: func(visit DirectoryVisit) bool { return visit.Name != "b" }}
	deep := &recordingVisitor{}
	if err := WalkDirectories(context.Background(), root, 100, shallow, deep); err != nil {
		t.Fatal(err)
	}
	seenByShallow := map[string]bool{}
	for _, visit := range shallow.visits {
		seenByShallow[visit.Path] = true
	}
	seenByDeep := map[string]bool{}
	for _, visit := range deep.visits {
		seenByDeep[visit.Path] = true
	}
	if seenByShallow[filepath.Join(root, "b", "c")] {
		t.Fatal("the shallow visitor descended past its stop")
	}
	if !seenByDeep[filepath.Join(root, "b", "c")] {
		t.Fatal("the deep visitor stopped descending with the shallow one")
	}
	for path := range seenByShallow {
		if !seenByDeep[path] {
			t.Fatalf("shallow visitor saw %s, deep visitor did not", path)
		}
	}
}

func TestWalkDirectoriesStopsAtTheDirectoryBudget(t *testing.T) {
	root := makeTree(t)
	visitor := &recordingVisitor{}
	if err := WalkDirectories(context.Background(), root, 3, visitor); err != nil {
		t.Fatal(err)
	}
	if len(visitor.visits) != 3 {
		t.Fatalf("visits = %d, want 3", len(visitor.visits))
	}
}

func TestWalkDirectoriesStopsOnCancelledContext(t *testing.T) {
	root := makeTree(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	visitor := &recordingVisitor{}
	if err := WalkDirectories(ctx, root, 100, visitor); err == nil {
		t.Fatal("expected the cancelled context error")
	}
	if len(visitor.visits) != 0 {
		t.Fatalf("visits = %d, want 0", len(visitor.visits))
	}
}
