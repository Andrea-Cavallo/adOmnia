package goide

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestWorkspaceModuleGraphLinksProjectModules(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "api/go.mod", "module example.com/api\n\ngo 1.22\n\nrequire (\n\texample.com/core v0.0.0\n\tgithub.com/pkg/errors v0.9.1\n)\n\nreplace example.com/core => ../core\n")
	writeFixtureFile(t, root, "core/go.mod", "module example.com/core\n\ngo 1.22\n")
	writeFixtureFile(t, root, "tools/go.mod", "module example.com/tools\n\ngo 1.22\n\nrequire example.com/api v1.2.0\n")
	modules := []GoModule{
		{Path: filepath.Join(root, "tools")}, {Path: filepath.Join(root, "core"), ModulePath: "example.com/core"},
		{Path: filepath.Join(root, "api"), ModulePath: "example.com/api"}, {Path: filepath.Join(root, "missing"), ModulePath: "example.com/missing"},
	}
	// tools non ha ModulePath noto in partenza: lo si legge dal go.mod, ma non conta come destinazione.
	graph := workspaceModuleGraph(root, modules)
	byPath := map[string]WorkspaceModule{}
	for _, module := range graph {
		byPath[module.ModulePath] = module
	}
	if api := byPath["example.com/api"]; !reflect.DeepEqual(api.Requires, []string{"example.com/core"}) || !reflect.DeepEqual(api.Replaced, []string{"example.com/core"}) || api.Directory != "api" {
		t.Fatalf("api: %+v", api)
	}
	if tools := byPath["example.com/tools"]; !reflect.DeepEqual(tools.Requires, []string{"example.com/api"}) {
		t.Fatalf("tools: %+v", tools)
	}
	if missing := byPath["example.com/missing"]; missing.Error == "" {
		t.Fatalf("go.mod mancante senza errore: %+v", missing)
	}
}
