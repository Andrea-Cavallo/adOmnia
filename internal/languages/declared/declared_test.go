package declared

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
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
		} else if script, ok := l.(scriptAdapter); ok {
			byID[l.ID()] = script.adapter
		} else if dotnet, ok := l.(dotnetAdapter); ok {
			byID[l.ID()] = dotnet.adapter
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

func TestNpmServersPreferAdOmniasToolsFolder(t *testing.T) {
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(name string) (string, error) { return "/usr/bin/" + name, nil }
	tools := t.TempDir()
	bin := lsp.ManagedBinDirectory(tools)
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "bash-language-server.cmd"), []byte("@echo off"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, l := range Languages() {
		a, ok := l.(adapter)
		if !ok {
			continue
		}
		info := a.LocateServer("", tools)
		switch a.id {
		case "shellscript":
			if info.Source != "managed" || filepath.Dir(info.Binary) != bin {
				t.Fatalf("managed bash-language-server not preferred: %+v", info)
			}
		case "csharp":
			if info.Source != "PATH" {
				t.Fatalf("csharp-ls comes from PATH: %+v", info)
			}
		}
		if a.pinned != nil {
			continue // pinned downloads: TestPinnedServers
		}
		if plan, err := a.InstallPlan(tools); (a.npm != "") != (err == nil) || (err == nil && plan.Arguments[len(plan.Arguments)-1] != a.npm) {
			t.Fatalf("%s: install plan %+v %v", a.id, plan, err)
		}
		if a.npm != "" && !strings.Contains(a.npm, "@") {
			t.Fatalf("%s: npm package must be pinned, got %q", a.id, a.npm)
		}
	}
}
