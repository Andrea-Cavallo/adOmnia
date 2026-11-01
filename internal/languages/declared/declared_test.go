package declared

import (
	"errors"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
)

func TestDeclaredLanguagesUseTheFirstServerOnPath(t *testing.T) {
	t.Cleanup(func() { lookPath = defaultLookPath })
	onPath := map[string]string{"solargraph": "/bin/solargraph", "clangd": "/bin/clangd"}
	lookPath = func(name string) (string, error) {
		if path, ok := onPath[name]; ok {
			return path, nil
		}
		return "", errors.New("not found")
	}
	byID := map[string]adapter{}
	for _, l := range Languages() {
		if native, ok := l.(nativeAdapter); ok {
			byID[l.ID()] = native.adapter
		} else {
			byID[l.ID()] = l.(adapter)
		}
		if _, ok := l.(language.ServerProvider); !ok {
			t.Fatalf("%s is not a server provider", l.ID())
		}
	}

	spec, err := byID["ruby"].ServerSpec("", "")
	if err != nil || spec.Binary != "/bin/solargraph" || spec.Arguments[0] != "stdio" || spec.Language != "ruby" {
		t.Fatalf("ruby falls back to solargraph: %+v %v", spec, err)
	}
	if id, ok := byID["cpp"].DocumentLanguageID("src/Main.HPP"); !ok || id != "cpp" {
		t.Fatalf("hpp -> %q %v", id, ok)
	}
	if id, _ := byID["cpp"].DocumentLanguageID("main.c"); id != "c" {
		t.Fatalf("c -> %q", id)
	}
	if id, ok := byID["dockerfile"].DocumentLanguageID("deploy/Dockerfile"); !ok || id != "dockerfile" {
		t.Fatalf("Dockerfile -> %q %v", id, ok)
	}
	if id, _ := byID["terraform"].DocumentLanguageID("prod.tfvars"); id != "terraform-vars" {
		t.Fatalf("tfvars -> %q", id)
	}
	if editor, ok := EditorLanguage("scripts/run.sh"); !ok || editor != "shell" {
		t.Fatalf("shell editor -> %q %v", editor, ok)
	}
	ids := map[string]bool{}
	for _, d := range definitions {
		if ids[d.id] || d.editor == "" || len(d.servers) == 0 || d.hint == "" {
			t.Fatalf("incomplete or duplicate row %q", d.id)
		}
		ids[d.id] = true
	}
	info := byID["csharp"].LocateServer("", "")
	if info.Available || info.Error == "" {
		t.Fatalf("missing csharp-ls must explain how to install it: %+v", info)
	}
	if _, err := byID["csharp"].InstallPlan(""); err == nil {
		t.Fatal("declared servers are installed by their own ecosystem, not by adOmnia")
	}
}
