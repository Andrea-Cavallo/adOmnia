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
