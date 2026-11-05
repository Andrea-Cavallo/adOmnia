package declared

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func writeCoverageFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLcovCoverageBecomesTheNeutralReport(t *testing.T) {
	root := t.TempDir()
	writeCoverageFile(t, root, "coverage/lcov.info", "TN:\nSF:"+filepath.Join(root, "src", "app.dart")+"\nDA:3,1\nDA:4,0\nDA:5,2\nend_of_record\n")
	report := scanProjectCoverage(root)
	if report == nil || report.Mode != "lcov" {
		t.Fatalf("report = %+v", report)
	}
	if report.Statements != 3 || report.Covered != 2 || len(report.Files) != 1 {
		t.Fatalf("report = %+v", report)
	}
	file := report.Files[0]
	if file.Path != "src/app.dart" || file.Blocks[1].Covered || !file.Blocks[2].Covered {
		t.Fatalf("file = %+v", file)
	}
}

func TestCoberturaCoverageBecomesTheNeutralReport(t *testing.T) {
	root := t.TempDir()
	writeCoverageFile(t, root, "coverage.xml", `<coverage><packages><package><classes>
		<class filename="src/app.rb"><lines><line number="2" hits="1"/><line number="3" hits="0"/></lines></class>
	</classes></package></packages></coverage>`)
	report := scanProjectCoverage(root)
	if report == nil || report.Mode != "cobertura" || report.Statements != 2 || report.Covered != 1 {
		t.Fatalf("report = %+v", report)
	}
	if report.Files[0].Path != "src/app.rb" {
		t.Fatalf("file = %+v", report.Files[0])
	}
}

func TestSimpleCovResultsetBecomesTheNeutralReport(t *testing.T) {
	root := t.TempDir()
	writeCoverageFile(t, root, "coverage/.resultset.json", `{"RSpec":{"coverage":{`+strconv.Quote(filepath.Join(root, "lib", "app.rb"))+`:{"lines":[1,null,0,3]}}}}`)
	report := scanProjectCoverage(root)
	if report == nil || report.Mode != "simplecov" || report.Statements != 3 || report.Covered != 2 {
		t.Fatalf("report = %+v", report)
	}
	if report.Files[0].Path != "lib/app.rb" || len(report.Files[0].Blocks) != 3 {
		t.Fatalf("file = %+v", report.Files[0])
	}
}

func TestCoverageParserExposesTheReportAfterFinish(t *testing.T) {
	root := t.TempDir()
	writeCoverageFile(t, root, "lcov.info", "SF:app.ex\nDA:1,1\nend_of_record\n")
	parser := &coverageParser{inner: &tapParser{}, root: root}
	_ = parser.Finish()
	report := parser.Coverage()
	if report == nil || report.Files[0].Path != "app.ex" {
		t.Fatalf("report = %+v", report)
	}
}
