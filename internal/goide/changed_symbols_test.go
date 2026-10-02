package goide

import (
	"os/exec"
	"testing"
)

func TestVCSChangedSymbolsAgainstHEAD(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git non disponibile")
	}
	repo := t.TempDir()
	gitCommand(t, repo, "init", "-q", "-b", "main")
	writeFixtureFile(t, repo, "go.mod", "module example.com/cs\n\ngo 1.22\n")
	writeFixtureFile(t, repo, "api.go", "package cs\n\n// Keep resta uguale.\nfunc Keep() int {\n\treturn 1\n}\n\nfunc Edit() int {\n\tx := 1\n\treturn x\n}\n\nfunc Drop() {}\n\ntype Server struct{}\n\nfunc (s *Server) Stop() {}\n")
	writeFixtureFile(t, repo, "api_test.go", "package cs\n\nimport \"testing\"\n\nfunc TestKeep(t *testing.T) {}\n")
	gitCommand(t, repo, "add", ".")
	gitCommand(t, repo, "commit", "-q", "-m", "initial")

	// Edit cambia corpo, Drop sparisce (cancellazione al confine di Keep/Edit: Keep non va toccato),
	// Stop cambia, nasce helper e un nuovo test.
	writeFixtureFile(t, repo, "api.go", "package cs\n\n// Keep resta uguale.\nfunc Keep() int {\n\treturn 1\n}\n\nfunc Edit() int {\n\treturn 2\n}\n\ntype Server struct{}\n\nfunc (s *Server) Stop() { println() }\n\nfunc helper() {}\n")
	writeFixtureFile(t, repo, "api_test.go", "package cs\n\nimport \"testing\"\n\nfunc TestKeep(t *testing.T) {}\n\nfunc TestHelper(t *testing.T) { helper() }\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(repo)
	if err != nil {
		t.Fatal(err)
	}
	symbols, err := service.VCSChangedSymbols(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]VCSChangedSymbol{}
	for _, symbol := range symbols {
		got[symbol.RelativePath+" "+symbol.Name] = symbol
	}
	want := map[string]string{
		"api.go Edit": SymbolModified, "api.go Drop": SymbolRemoved, "api.go (*Server).Stop": SymbolModified,
		"api.go helper": SymbolAdded, "api_test.go TestHelper": SymbolAdded,
	}
	if len(got) != len(want) {
		t.Fatalf("simboli cambiati inattesi: %+v", symbols)
	}
	for key, change := range want {
		if got[key].Change != change {
			t.Fatalf("%s: %+v, atteso %s (tutti: %+v)", key, got[key], change, symbols)
		}
	}
	if !got["api_test.go TestHelper"].Test || got["api.go helper"].Exported || !got["api.go Edit"].Exported || got["api.go Edit"].Line != 8 {
		t.Fatalf("metadati dei simboli inattesi: %+v", symbols)
	}
}

func TestChangedSymbolTouchesAreReadFromTheFunctionSource(t *testing.T) {
	text := "package svc\n\n// Handler uses sql. in the comment only.\nfunc Handler(w http.ResponseWriter, r *http.Request) {\n\trow := db.QueryRowContext(r.Context(), \"select 1\")\n\t_ = row\n\t_ = writer.WriteMessages(r.Context())\n}\n\nfunc Pure() int { return 1 }\n"
	declarations := goDeclarations(text, false)
	if len(declarations) != 2 {
		t.Fatalf("dichiarazioni: %+v", declarations)
	}
	if got := declarations[0].touches; len(got) != 3 || got[0] != "http" || got[1] != "db" || got[2] != "broker" {
		t.Fatalf("Handler: %v", got)
	}
	if got := declarations[1].touches; len(got) != 0 {
		t.Fatalf("Pure non tocca nulla: %v", got)
	}
}
