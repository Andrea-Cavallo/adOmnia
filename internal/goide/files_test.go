package goide

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateFilesIsAllOrNothingAndConfined(t *testing.T) {
	root := t.TempDir()
	project := Project{RealPath: root}
	manager := NewDocumentManager()
	if err := os.WriteFile(filepath.Join(root, "exists.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := manager.CreateFiles(project, []NewFile{{RelativePath: "pkg/new.go", Content: "package pkg\n"}}); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(root, "pkg", "new.go")); string(data) != "package pkg\n" {
		t.Fatalf("contenuto inatteso: %q", data)
	}
	// Il secondo file esiste già: nemmeno il primo deve restare su disco.
	err := manager.CreateFiles(project, []NewFile{{RelativePath: "a.go", Content: "package main\n"}, {RelativePath: "exists.go", Content: "x"}})
	if err == nil {
		t.Fatal("un file esistente non deve essere sovrascritto")
	}
	if _, statErr := os.Stat(filepath.Join(root, "a.go")); !os.IsNotExist(statErr) {
		t.Fatal("creazione parziale non annullata")
	}
	if data, _ := os.ReadFile(filepath.Join(root, "exists.go")); string(data) != "package main\n" {
		t.Fatal("file esistente modificato")
	}
	for _, escape := range []string{"../out.go", "/etc/passwd", "", "."} {
		if err := manager.CreateFiles(project, []NewFile{{RelativePath: escape}}); err == nil {
			t.Fatalf("percorso %q accettato", escape)
		}
	}
}
