package declared

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/toolmanifest"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// installPinned writes what the install command leaves behind: the report and the extracted files.
func installPinned(t *testing.T, p *pinnedServer, tools string, files ...string) {
	t.Helper()
	asset, ok := p.asset()
	if !ok {
		t.Skipf("%s has no build for this platform", p.tool)
	}
	report, err := jsonutil.Marshal(toolmanifest.Report{Tool: p.tool, Version: p.version, Artifacts: []toolmanifest.Artifact{p.artifact(asset)}})
	if err != nil {
		t.Fatal(err)
	}
	directory := p.directory(tools)
	for _, file := range files {
		path := filepath.Join(directory, "extract", file)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, toolmanifest.ReportFile), report, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPinnedServers(t *testing.T) {
	byID := map[string]adapter{}
	for _, d := range definitions {
		byID[d.id] = adapter{d}
	}
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(name string) (string, error) {
		if name == "powershell" || name == "dotnet" {
			return filepath.Join("host", name), nil
		}
		return "", os.ErrNotExist
	}
	pinned := map[string]*pinnedServer{
		"cpp": clangdServer, "objective-c": clangdServer, "lua": luaServer, "clojure": clojureServer,
		"latex": texlabServer, "proto": bufServer, "cmake": cmakeServer, "markdown": marksmanServer,
		"xml": lemminxServer, "powershell": powershellEditorServices,
	}
	for id, p := range pinned {
		a := byID[id]
		if a.pinned != p {
			t.Fatalf("%s: row is not wired to %s", id, p.tool)
		}
		if _, ok := p.asset(); !ok {
			continue // no build for this platform: the hint stays the only way
		}
		tools := t.TempDir()
		if info := a.LocateServer("", tools); info.Available || !strings.Contains(info.Error, "Install…") {
			t.Fatalf("%s: missing server must point at Install…: %+v", id, info)
		}
		plan, err := a.InstallPlan(tools)
		if err != nil || !strings.Contains(plan.Command, p.version) || len(plan.Languages) != 1 || plan.Languages[0] != id {
			t.Fatalf("%s: install plan %+v %v", id, plan, err)
		}
		asset, _ := p.asset()
		installPinned(t, p, tools, asset.program)
		spec, err := a.ServerSpec("", tools)
		if err != nil {
			t.Fatalf("%s: installed server not used: %v", id, err)
		}
		if p.launch == nil && (filepath.Base(spec.Binary) != filepath.Base(asset.program) || !strings.HasPrefix(strings.Join(spec.Arguments, " "), strings.Join(a.servers[0].args, " "))) {
			t.Fatalf("%s: spec %+v", id, spec)
		}
	}

	spec, err := byID["powershell"].ServerSpec("", func() string {
		tools := t.TempDir()
		installPinned(t, powershellEditorServices, tools, "PowerShellEditorServices/Start-EditorServices.ps1")
		return tools
	}())
	if err != nil || filepath.Base(spec.Binary) != "powershell" {
		t.Fatalf("installed PowerShell Editor Services not used: %+v %v", spec, err)
	}
	command := spec.Arguments[len(spec.Arguments)-1]
	for _, want := range []string{"Start-EditorServices.ps1", "-Stdio", "-BundledModulesPath"} {
		if !strings.Contains(command, want) {
			t.Fatalf("launch command lacks %s: %s", want, command)
		}
	}

	// A report for another release is never trusted.
	tools := t.TempDir()
	stale := *marksmanServer
	stale.version = "2020-01-01"
	installPinned(t, &stale, tools, "marksman")
	if err := os.Rename(stale.directory(tools), marksmanServer.directory(tools)); err != nil {
		t.Fatal(err)
	}
	if marksmanServer.managed(tools) != "" {
		t.Fatal("a report for another version must not be used")
	}
}

func TestDotnetToolServers(t *testing.T) {
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(name string) (string, error) {
		if name == "dotnet" {
			return "dotnet", nil
		}
		return "", os.ErrNotExist
	}
	for _, d := range definitions {
		if d.tool == nil {
			continue
		}
		a, tools := adapter{d}, t.TempDir()
		plan, err := a.InstallPlan(tools)
		if err != nil || !strings.Contains(plan.Command, "--tool-path") || !strings.Contains(plan.Command, d.tool.version) || strings.Contains(plan.Command, "--global") {
			t.Fatalf("%s: install plan %+v %v", d.id, plan, err)
		}
		binary := filepath.Join(d.tool.directory(tools), exe(d.tool.name))
		if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(binary, []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
		if info := a.LocateServer("", tools); !info.Available || info.Source != "managed" || info.Binary != binary {
			t.Fatalf("%s: installed tool not used: %+v", d.id, info)
		}
	}
}
