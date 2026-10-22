package codestudio

import (
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/ide/run"
)

func TestBuildDiagnosticReportsResolveWorkspaceRelativePaths(t *testing.T) {
	root := t.TempDir()
	member := filepath.Join(root, "crates", "api")
	if err := os.MkdirAll(filepath.Join(member, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	// "è" occupa un carattere ma due byte: la colonna deve restare in caratteri.
	if err := os.WriteFile(filepath.Join(member, "src", "main.rs"), []byte("fn main() { let è = 1; }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session := Session{ID: "s1", Project: Project{RealPath: root}}
	reports := buildDiagnosticReports(session, member, []run.Diagnostic{
		{File: "crates/api/src/main.rs", Line: 1, Column: 18, Severity: 1, Code: "E0308", Message: "mismatched types", Help: "try changing the type"},
		{File: "/home/user/.cargo/registry/src/x/lib.rs", Line: 3, Column: 1, Severity: 1, Message: "outside the project"},
		{File: "src/missing.rs", Line: 1, Column: 1, Severity: 2, Message: "file not in the project"},
	})
	if len(reports) != 1 || reports[0].RelativePath != "crates/api/src/main.rs" {
		t.Fatalf("reports = %+v", reports)
	}
	diagnostic := reports[0].Diagnostics[0]
	if diagnostic.Source != "cargo" || diagnostic.Code != "E0308" || diagnostic.Range.StartColumn != 18 {
		t.Fatalf("diagnostic = %+v", diagnostic)
	}
	if want := "mismatched types\nhelp: try changing the type"; diagnostic.Message != want {
		t.Fatalf("message = %q", diagnostic.Message)
	}
}

func TestBuildDiagnosticReportsEmptyForACleanBuild(t *testing.T) {
	session := Session{ID: "s1", Project: Project{RealPath: t.TempDir()}}
	if reports := buildDiagnosticReports(session, session.Project.RealPath, nil); reports == nil || len(reports) != 0 {
		t.Fatalf("a clean build must publish an empty, non-nil list, got %#v", reports)
	}
}

func TestServerURIsMatchOpenDocumentsRegardlessOfDriveLetterCase(t *testing.T) {
	state := &lspSession{byURI: map[string]DocumentID{"file:///C:/proj/src/main.rs": "doc-1"}}
	for _, uri := range []string{"file:///C:/proj/src/main.rs", "file:///c:/proj/src/main.rs"} {
		if id := state.documentIDFor(uri); id != "doc-1" {
			t.Fatalf("%s -> %q", uri, id)
		}
	}
	if id := state.documentIDFor("file:///c:/proj/src/other.rs"); id != "" {
		t.Fatalf("an unknown file must not match, got %q", id)
	}
}

func TestBuildDiagnosticReportsPreferTheCargoWorkspaceRootOverLookalikes(t *testing.T) {
	root := t.TempDir()
	member := filepath.Join(root, "crates", "api")
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(member, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(path, content string) {
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(root, "Cargo.toml"), "[workspace]\nmembers = [\"crates/api\"]\n")
	write(filepath.Join(member, "Cargo.toml"), "[package]\nname = \"api\"\nversion = \"0.1.0\"\n")
	write(filepath.Join(root, "src", "main.rs"), "fn main() { let root = 1; }\n")
	write(filepath.Join(member, "src", "main.rs"), "fn main() { let member = 1; }\n")
	session := Session{ID: "s1", Project: Project{RealPath: root}}
	// La Run parte dal membro, ma cargo stampa i percorsi relativi alla radice del workspace:
	// `src/main.rs` è il file della radice, non l'omonimo del membro.
	reports := buildDiagnosticReports(session, member, []run.Diagnostic{
		{File: "src/main.rs", Line: 1, Column: 16, Severity: 1, Message: "root file"},
		{File: "crates/api/src/main.rs", Line: 1, Column: 16, Severity: 1, Message: "member file"},
	})
	if len(reports) != 2 {
		t.Fatalf("reports = %+v", reports)
	}
	byRelative := map[string]string{}
	for _, report := range reports {
		byRelative[report.RelativePath] = report.Diagnostics[0].Message
	}
	if byRelative["src/main.rs"] != "root file" {
		t.Fatalf("src/main.rs resolved to the wrong lookalike: %+v", byRelative)
	}
	if byRelative["crates/api/src/main.rs"] != "member file" {
		t.Fatalf("member file unresolved: %+v", byRelative)
	}
}
