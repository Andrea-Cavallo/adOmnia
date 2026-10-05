package goide

import "testing"

func TestAnalyzeErrorHandlingService(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/eh\n\ngo 1.22\n")
	writeFixtureFile(t, root, "svc/svc.go", "package svc\n\nimport \"errors\"\n\nvar ErrGone = errors.New(\"gone\")\n\n// è\nfunc Check(err error) bool { return err == ErrGone }\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.AnalyzeErrorHandling(id); err == nil {
		t.Fatal("go list started without authorization")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	service.DetectToolchain(id)
	report, err := service.AnalyzeErrorHandling(id)
	if err != nil {
		t.Skipf("go toolchain unavailable: %v", err)
	}
	if report.Modules != 1 || len(report.Findings) != 1 || len(report.Sentinels) != 1 {
		t.Fatalf("report: %+v", report)
	}
	finding := report.Findings[0]
	if finding.Kind != "compare" || finding.Location != (ErrorLocation{RelativePath: "svc/svc.go", Line: 8, Column: 37}) || finding.Fix == nil {
		t.Fatalf("finding: %+v", finding)
	}
	edit := finding.Fix.Edits[0]
	if edit.Original != "err == ErrGone" || edit.Text != "errors.Is(err, ErrGone)" || edit.Range.EndColumn != 51 {
		t.Fatalf("edit: %+v", edit)
	}
	if report.Sentinels[0].Location.Line != 5 || len(report.Sentinels[0].Refs) != 1 {
		t.Fatalf("sentinel: %+v", report.Sentinels[0])
	}
}
