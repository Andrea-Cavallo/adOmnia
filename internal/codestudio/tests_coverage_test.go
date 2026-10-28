package codestudio

import (
	"testing"

	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// TestHostCoverageMapsAdapterReport: il report neutro dell'adapter diventa il modello della vista,
// con percorsi relativi, token del file e un package per cartella di primo livello (PY-5.5).
func TestHostCoverageMapsAdapterReport(t *testing.T) {
	root := t.TempDir()
	writeFixtureFiles(t, root, map[string]string{
		"app.py":      "x = 1\ny = 2\n",
		"pkg/util.py": "def f():\n    return 1\n",
	})
	manager := NewTestManager()
	manager.SetProjectRoot(func(SessionID) string { return root })
	snapshot := idetesting.Snapshot{
		SessionID: "session",
		Coverage: &idetesting.CoverageReport{
			Mode: "pytest-cov", Statements: 4, Covered: 2, Percent: 50,
			Files: []idetesting.CoverageFile{
				{Path: "app.py", Statements: 2, Covered: 1, Percent: 50, Blocks: []idetesting.CoverageBlock{{StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 2, Covered: true, Statements: 1}}},
				{Path: "pkg/util.py", Statements: 2, Covered: 1, Percent: 50, Blocks: []idetesting.CoverageBlock{{StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 2, Covered: true, Statements: 1}}},
			},
		},
	}
	converted := manager.hostTestSnapshot(snapshot)
	if converted.Coverage == nil || converted.Coverage.Mode != "pytest-cov" || converted.Coverage.Percent != 50 {
		t.Fatalf("coverage %+v", converted.Coverage)
	}
	byPath := map[string]CoverageFile{}
	for _, file := range converted.Coverage.Files {
		byPath[file.RelativePath] = file
	}
	if file, ok := byPath["app.py"]; !ok || file.DiskToken == "" || len(file.Blocks) != 1 || !file.Blocks[0].Covered {
		t.Fatalf("app.py %+v", byPath)
	}
	if len(converted.Coverage.Packages) != 1 || converted.Coverage.Packages[0].ImportPath != "pkg" {
		t.Fatalf("packages %+v", converted.Coverage.Packages)
	}
}

// TestHostCoverageKeepsGoMetadata: quando l'host produce già il report (Go), un eventuale report
// neutro non sostituisce il modello già risolto.
func TestHostCoverageKeepsGoMetadata(t *testing.T) {
	manager := NewTestManager()
	metadata, err := jsonutil.Marshal(testMetadata{Coverage: &CoverageReport{Mode: "set", Percent: 80}})
	if err != nil {
		t.Fatal(err)
	}
	converted := manager.hostTestSnapshot(idetesting.Snapshot{
		SessionID: "s", Metadata: metadata,
		Coverage: &idetesting.CoverageReport{Mode: "pytest-cov", Percent: 10},
	})
	if converted.Coverage == nil || converted.Coverage.Mode != "set" || converted.Coverage.Percent != 80 {
		t.Fatalf("coverage %+v", converted.Coverage)
	}
}
