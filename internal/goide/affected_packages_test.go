package goide

import (
	"reflect"
	"testing"
)

func TestAffectedPackagesWithRealGoList(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/aff\n\ngo 1.22\n")
	writeFixtureFile(t, root, "core/core.go", "package core\n\nfunc V() int { return 1 }\n")
	writeFixtureFile(t, root, "svc/svc.go", "package svc\n\nimport \"example.com/aff/core\"\n\nfunc V() int { return core.V() }\n")
	writeFixtureFile(t, root, "api/api.go", "package api\n\nimport \"example.com/aff/svc\"\n\nfunc V() int { return svc.V() }\n")
	// I test di check importano api: check va ritestato, ma chi importa check no.
	writeFixtureFile(t, root, "check/check.go", "package check\n")
	writeFixtureFile(t, root, "check/check_test.go", "package check_test\n\nimport (\n\t\"testing\"\n\n\t\"example.com/aff/api\"\n)\n\nfunc TestV(t *testing.T) { _ = api.V() }\n")
	writeFixtureFile(t, root, "uses/uses.go", "package uses\n\nimport _ \"example.com/aff/check\"\n")
	writeFixtureFile(t, root, "other/other.go", "package other\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.AffectedTestPackages(id, "", []string{"./core"}); err == nil {
		t.Fatal("go list eseguito senza autorizzazione")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	service.DetectToolchain(id)
	got, err := service.AffectedTestPackages(id, "", []string{"./core"})
	if err != nil {
		t.Skipf("go list non disponibile: %v", err)
	}
	if want := []string{"./api", "./check", "./core", "./svc"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("package coinvolti: %v, attesi %v", got, want)
	}
	if _, err := service.AffectedTestPackages(id, "", []string{"../outside"}); err == nil {
		t.Fatal("pattern fuori dal progetto accettato")
	}
}
