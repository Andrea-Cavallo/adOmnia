package goide

import "testing"

func TestDocumentationService(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/docs\n\ngo 1.22\n")
	writeFixtureFile(t, root, "pay/pay.go", "// Package pay charges cards.\npackage pay\n\n// Charge charges a card.\nfunc Charge() {}\n\nfunc Refund() {}\n")
	writeFixtureFile(t, root, "api/pay.proto", "syntax = \"proto3\";\n\n// Payments.\nservice Payments { rpc Pay(Req) returns (Res); }\nmessage Req {}\nmessage Res {}\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	report, err := service.Documentation(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Packages) != 1 || report.Packages[0].ImportPath != "example.com/docs/pay" || report.Packages[0].Dir != "pay" {
		t.Fatalf("packages: %+v", report.Packages)
	}
	charge := report.Packages[0].Funcs[0]
	if charge.Name != "Charge" || charge.Site.Path != "pay/pay.go" || charge.Site.Line != 5 {
		t.Fatalf("charge: %+v", charge)
	}
	if len(report.Problems) != 1 || report.Problems[0].Kind != "doc-missing" || report.Problems[0].Location.Line != 7 || report.Problems[0].Fix == nil {
		t.Fatalf("problems: %+v", report.Problems)
	}
	edit := report.Problems[0].Fix.Edits[0]
	if edit.Text != "// Refund \n" || edit.Range.StartLine != 7 || edit.Range.StartColumn != 1 {
		t.Fatalf("stub edit: %+v", edit)
	}
	if len(report.Protos) != 1 || report.Protos[0].Services[0].Doc != "Payments." {
		t.Fatalf("protos: %+v", report.Protos)
	}
}
