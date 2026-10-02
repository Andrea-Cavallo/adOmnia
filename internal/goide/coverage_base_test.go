package goide

import (
	"os/exec"
	"strings"
	"testing"
)

func TestBaseBranchCoverageMeasuresMergeBaseInATemporaryWorktree(t *testing.T) {
	for _, tool := range []string{"git", "go"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s non disponibile", tool)
		}
	}
	repo := t.TempDir()
	gitCommand(t, repo, "init", "-q", "-b", "main")
	gitCommand(t, repo, "config", "user.name", "Ada")
	gitCommand(t, repo, "config", "user.email", "ada@example.com")
	writeFixtureFile(t, repo, "go.mod", "module example.com/calc\n\ngo 1.22\n")
	writeFixtureFile(t, repo, "calc/calc.go", "package calc\n\nfunc Abs(n int) int {\n\tif n < 0 {\n\t\treturn -n\n\t}\n\treturn n\n}\n")
	writeFixtureFile(t, repo, "calc/calc_test.go", "package calc\n\nimport \"testing\"\n\nfunc TestAbs(t *testing.T) {\n\tif Abs(2) != 2 {\n\t\tt.Fatal()\n\t}\n}\n")
	gitCommand(t, repo, "add", "go.mod", "calc")
	gitCommand(t, repo, "commit", "-q", "-m", "base")
	gitCommand(t, repo, "checkout", "-q", "-b", "feature")
	writeFixtureFile(t, repo, "calc/calc_test.go", "package calc\n\nimport \"testing\"\n\nfunc TestAbs(t *testing.T) {\n\tif Abs(2) != 2 || Abs(-2) != 2 {\n\t\tt.Fatal()\n\t}\n}\n")
	writeFixtureFile(t, repo, "extra/extra.go", "package extra\n\nfunc One() int { return 1 }\n")
	gitCommand(t, repo, "add", "calc", "extra")
	gitCommand(t, repo, "commit", "-q", "-m", "more tests")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(repo)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.BaseBranchCoverage(id, "main", []string{"calc"}, nil); err == nil {
		t.Fatal("senza autorizzazione non deve avviare go test")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	result, err := service.BaseBranchCoverage(id, "main", []string{"calc", "extra"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Sul base TestAbs non copre il ramo n < 0: 2 statement su 3.
	if result.Statements != 3 || result.Covered != 2 || result.TestsFailed {
		t.Fatalf("coverage del base inattesa: %+v", result)
	}
	if len(result.Missing) != 1 || result.Missing[0] != "extra" {
		t.Fatalf("il package nuovo va segnalato come assente sul base: %+v", result.Missing)
	}
	if worktrees := gitCommand(t, repo, "worktree", "list"); strings.Count(strings.TrimSpace(worktrees), "\n") != 0 {
		t.Fatalf("worktree temporaneo non rimosso:\n%s", worktrees)
	}
	if _, err := service.BaseBranchCoverage(id, "--upload-pack=x", []string{"calc"}, nil); err == nil {
		t.Fatal("un branch che sembra un flag va rifiutato")
	}
}

func TestModuleForDirPicksInnermostModule(t *testing.T) {
	root := t.TempDir()
	modules := []GoModule{{Path: root}, {Path: root + "/services/api"}}
	cases := map[string]string{"calc": ".", "services/api/handlers": "services/api", "services/apix": ".", "services/api": "services/api"}
	for dir, want := range cases {
		if got := moduleForDir(root, modules, dir); got != want {
			t.Errorf("moduleForDir(%q) = %q, want %q", dir, got, want)
		}
	}
}
