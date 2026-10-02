package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

const branchFixture = `package br

func Sign(x int) string {
	if x > 0 {
		return "positive"
	} else if x < 0 {
		return "negative"
	}
	switch x {
	case 0:
		return "zero"
	default:
		return "other"
	}
}
`

func TestUntakenBranchesFromARealProfile(t *testing.T) {
	goBinary, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go non disponibile")
	}
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/br\n\ngo 1.22\n")
	writeFixtureFile(t, root, "br.go", branchFixture)
	writeFixtureFile(t, root, "br_test.go", "package br\n\nimport \"testing\"\n\nfunc TestSign(t *testing.T) {\n\tif Sign(1) != \"positive\" || Sign(0) != \"zero\" {\n\t\tt.Fatal()\n\t}\n}\n")
	profile := filepath.Join(root, "cover.out")
	command := exec.Command(goBinary, "test", "-coverprofile", profile, ".")
	command.Dir = root
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("go test: %v\n%s", err, output)
	}
	data, err := os.ReadFile(profile)
	if err != nil {
		t.Fatal(err)
	}
	_, files, err := parseCoverageProfile(data)
	if err != nil {
		t.Fatal(err)
	}
	branches, evaluated := untakenBranches(branchFixture, files["example.com/br/br.go"])
	// Mai presi: il ramo "x < 0" (riga 6, then dell'else-if) e il default (riga 12).
	got := map[CoverageBranch]bool{}
	for _, branch := range branches {
		got[branch] = true
	}
	if len(branches) != 2 || !got[CoverageBranch{Line: 6, Kind: "then"}] || !got[CoverageBranch{Line: 12, Kind: "default"}] {
		t.Fatalf("rami non presi: %+v (valutati %d)", branches, evaluated)
	}
	if evaluated < 5 {
		t.Fatalf("rami valutati troppo pochi: %d", evaluated)
	}
}
