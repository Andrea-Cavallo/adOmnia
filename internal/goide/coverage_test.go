package goide

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCoverageReportMergesProfilesAndConvertsColumns(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "svc", "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	// "è" occupa 2 byte ma 1 unità UTF-16: la fine riga (colonna 30 in byte) diventa 29 per Monaco.
	source := "package api\n\nfunc F() { s := \"è\"; _ = s }\n"
	if err := os.WriteFile(filepath.Join(root, "svc", "api", "api.go"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	profile := "mode: set\n" +
		"example.com/svc/api/api.go:3.10,3.23 1 0\n" +
		"example.com/svc/api/api.go:3.10,3.23 1 1\n" +
		"example.com/svc/api/api.go:3.23,3.30 1 0\n" +
		"other.org/dep/x.go:1.1,2.2 1 1\n"
	report, err := buildCoverageReport(root, "svc", "example.com/svc", []byte(profile))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Files) != 1 || report.Files[0].RelativePath != "svc/api/api.go" || report.Files[0].DiskToken == "" {
		t.Fatalf("file non risolto o dipendenza non esclusa: %+v", report.Files)
	}
	file := report.Files[0]
	if file.Statements != 2 || file.Covered != 1 || file.Percent != 50 || !file.Blocks[0].Covered {
		t.Fatalf("conteggi errati (i blocchi ripetuti vanno uniti): %+v", file)
	}
	if file.Blocks[1].EndColumn != 29 {
		t.Fatalf("colonna UTF-16 errata: %+v", file.Blocks[1])
	}
	if len(report.Packages) != 1 || report.Packages[0].RelativePath != "svc/api" || report.Percent != 50 {
		t.Fatalf("aggregazione per package errata: %+v", report)
	}
	if _, err := buildCoverageReport(root, "", "example.com/svc", []byte("no header\n")); err == nil {
		t.Fatal("un profilo senza intestazione va rifiutato")
	}
}

func TestCoverageReportResolvesNestedProjectModules(t *testing.T) {
	root := t.TempDir()
	for _, file := range []string{"api/root.go", "tools/gen/gen.go"} {
		path := filepath.Join(root, filepath.FromSlash(file))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("package p\nfunc F() {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	profile := "mode: set\nexample.com/root/api/root.go:2.1,2.12 1 1\nexample.com/gen/gen.go:2.1,2.12 1 0\n"
	report, err := buildCoverageReportForModules(root, []coverageModule{{path: "example.com/root"}, {directory: "tools/gen", path: "example.com/gen"}}, []byte(profile))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Packages) != 2 || len(report.Files) != 2 || report.Files[1].RelativePath != "tools/gen/gen.go" || report.Percent != 50 {
		t.Fatalf("nested module coverage not aggregated: %+v", report)
	}
}

func TestLoadCoverageRejectsEmptyProjectReport(t *testing.T) {
	profile := filepath.Join(t.TempDir(), "coverage.out")
	if err := os.WriteFile(profile, []byte("mode: set\nother.example/dep/x.go:1.1,1.2 1 1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := loadCoverageForModules(t.TempDir(), []coverageModule{{path: "example.com/project"}}, profile)
	if err == nil || report != nil {
		t.Fatalf("empty project coverage must be explicit: report=%+v err=%v", report, err)
	}
}

func TestFunctionCoverageMatchesGoToolCoverFunc(t *testing.T) {
	text := "package p\n\ntype T[K any] struct{}\n\nfunc Hit(x int) int {\n\tif x > 0 {\n\t\treturn 1\n\t}\n\treturn 0\n}\n\nfunc (t *T[K]) Miss() {\n\tprintln()\n}\n\nfunc (T[K]) Empty() {}\n"
	blocks := []rawCoverageBlock{
		{startLine: 5, startColumn: 21, endLine: 6, endColumn: 11, statements: 1, count: 3},
		{startLine: 6, startColumn: 11, endLine: 8, endColumn: 3, statements: 1, count: 3},
		{startLine: 9, startColumn: 2, endLine: 9, endColumn: 10, statements: 1, count: 0},
		{startLine: 12, startColumn: 24, endLine: 14, endColumn: 2, statements: 1, count: 0},
	}
	functions := functionCoverage(text, blocks)
	want := []CoverageFunction{
		{Name: "Hit", Line: 5, Statements: 3, Covered: 2, Percent: 200.0 / 3},
		{Name: "(*T).Miss", Line: 12, Statements: 1},
		{Name: "T.Empty", Line: 16},
	}
	if len(functions) != len(want) {
		t.Fatalf("funzioni: %+v", functions)
	}
	for index := range want {
		if functions[index] != want[index] {
			t.Fatalf("funzione %d: %+v, attesa %+v", index, functions[index], want[index])
		}
	}
	if got := functionCoverage("not go", blocks); len(got) != 0 {
		t.Fatalf("file non analizzabile: %+v", got)
	}
}
