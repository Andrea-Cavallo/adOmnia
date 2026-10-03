package golang

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/ide/language"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDetectUnitsFindsModulesWorkspaceAndLooseDirs(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "go.mod"), "module example.com/app\n\ngo 1.26\n")
	write(t, filepath.Join(root, "main.go"), "package main\n")
	write(t, filepath.Join(root, "tools", "lint", "go.mod"), "module example.com/lint\n")
	write(t, filepath.Join(root, "go.work"), "go 1.26\n\nuse .\n")
	write(t, filepath.Join(root, "vendor", "x", "go.mod"), "module ignored\n")

	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ kind, root, name string }{
		{UnitModule, root, "example.com/app"},
		{UnitModule, filepath.Join(root, "tools", "lint"), "example.com/lint"},
		{UnitWorkspace, root, ""},
	}
	if len(units) != len(want) {
		t.Fatalf("units = %#v", units)
	}
	for index, expected := range want {
		unit := units[index]
		if unit.Language != ID || unit.Kind != expected.kind || unit.Root != expected.root || unit.Name != expected.name {
			t.Fatalf("unit %d = %#v, want %+v", index, unit, expected)
		}
	}
}

func TestDetectUnitsReportsLooseGoDirectories(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "scripts", "a", "run.go"), "package main\n")
	write(t, filepath.Join(root, "svc", "go.mod"), "module svc\n")
	write(t, filepath.Join(root, "svc", "main.go"), "package main\n")

	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 2 || units[0].Kind != UnitModule || units[1].Kind != UnitLoose || units[1].Root != filepath.Join(root, "scripts", "a") {
		t.Fatalf("units = %#v", units)
	}
}

func TestDetectUnitsStopsOnCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := New().DetectUnits(ctx, t.TempDir()); err == nil {
		t.Fatal("expected context error")
	}
}

func TestGoImplementsProjectDetection(t *testing.T) {
	if !language.CapabilitiesOf(New()).ProjectDetection {
		t.Fatal("Go adapter must detect projects")
	}
}

func TestGoDeclaresItsCapabilities(t *testing.T) {
	capabilities := language.CapabilitiesOf(New())
	if !capabilities.ProjectDetection || !capabilities.Documents || !capabilities.Usages || !capabilities.Declarations {
		t.Fatalf("Go adapter capabilities = %+v", capabilities)
	}
}
