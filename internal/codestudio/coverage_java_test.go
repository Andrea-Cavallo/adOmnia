package codestudio

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeJavaCoverageFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"pom.xml": "<project/>",
		"src/main/java/it/acme/OrderService.java": "package it.acme;\n\npublic class OrderService {\n    int a() { return 1; }\n    int b() { return 2; }\n    int c(boolean f) { return f ? 1 : 2; }\n}\n",
		"target/site/jacoco/jacoco.xml": `<?xml version="1.0"?><report name="x"><package name="it/acme"><sourcefile name="OrderService.java">
<line nr="4" mi="0" ci="3"/><line nr="5" mi="4" ci="0"/><line nr="6" mi="2" ci="2"/></sourcefile>
<sourcefile name="Missing.java"><line nr="1" mi="1" ci="0"/></sourcefile></package></report>`,
	}
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestJavaCoverageReportMapsJaCoCoLinesOntoTheGoShape(t *testing.T) {
	root := writeJavaCoverageFixture(t)
	report, err := javaCoverageReport(root, root, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Files) != 1 || report.Files[0].RelativePath != "src/main/java/it/acme/OrderService.java" || report.Files[0].DiskToken == "" {
		t.Fatalf("files = %+v", report.Files)
	}
	file := report.Files[0]
	if file.Statements != 3 || file.Covered != 2 || report.Percent < 66 || report.Percent > 67 {
		t.Fatalf("lines: %d covered of %d (%.1f%%)", file.Covered, file.Statements, report.Percent)
	}
	if len(file.Blocks) != 4 {
		t.Fatalf("a partial line yields a covered and an uncovered block: %+v", file.Blocks)
	}
	states := map[int][]bool{}
	for _, block := range file.Blocks {
		states[block.StartLine] = append(states[block.StartLine], block.Covered)
	}
	if len(states[4]) != 1 || !states[4][0] || len(states[5]) != 1 || states[5][0] || len(states[6]) != 2 {
		t.Fatalf("states = %v", states)
	}
	if len(report.Packages) != 1 || report.Packages[0].ImportPath != "it.acme" {
		t.Fatalf("packages = %+v", report.Packages)
	}
}

func TestJavaCoverageReportWithoutFreshReportsExplainsWhy(t *testing.T) {
	root := writeJavaCoverageFixture(t)
	if _, err := javaCoverageReport(root, root, time.Now().Add(time.Hour)); err == nil || err.Error() != string(errNoJavaCoverage) {
		t.Fatalf("a stale report must not be shown as fresh coverage: %v", err)
	}
}
