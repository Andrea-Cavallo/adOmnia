package goide

import "testing"

func TestAnalyzeArchitectureService(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/arch\n\ngo 1.22\n")
	writeFixtureFile(t, root, "core/core.go", "package core\n\ntype Reader interface{ Read() string }\n\ntype file struct{}\n\nfunc (file) Read() string { return \"\" }\n\nfunc Open() Reader { return file{} }\n")
	writeFixtureFile(t, root, "main.go", "package main\n\nimport \"example.com/arch/core\"\n\nfunc main() { _ = core.Open().Read() }\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.AnalyzeArchitecture(id); err == nil {
		t.Fatal("go list started without authorization")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	service.DetectToolchain(id)
	result, err := service.AnalyzeArchitecture(id)
	if err != nil {
		t.Skipf("go toolchain unavailable: %v", err)
	}
	report := result.Report
	if result.Modules != 1 || len(report.Packages) != 2 || len(report.Imports) != 1 || len(report.Interfaces) != 1 {
		t.Fatalf("report: %+v", report)
	}
	reader := report.Interfaces[0]
	if reader.Site.Path != "core/core.go" || reader.Site.Line != 3 || reader.Site.Column != 6 {
		t.Fatalf("interface site: %+v", reader.Site)
	}
	if len(report.Entries) != 1 || report.Entries[0].Kind != "main" || report.Entries[0].Site.Path != "main.go" {
		t.Fatalf("entries: %+v", report.Entries)
	}
	if len(report.Modules) != 1 || report.Modules[0].Site.Path != "go.mod" {
		t.Fatalf("modules: %+v", report.Modules)
	}
}
