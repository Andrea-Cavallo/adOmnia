package golang

import "testing"

// Due moduli analizzati separatamente (come fa Code Studio con go.work): Merge collega app → lib.
func TestMergeLinksCallsAcrossWorkspaceModules(t *testing.T) {
	lib, _ := loadFixture(t, map[string]string{
		"go.mod": "module example.com/lib\n\ngo 1.22\n",
		"lib.go": "package lib\n\nfunc Parse(s string) string { return s }\n",
	})
	app, _ := loadFixture(t, map[string]string{
		"go.mod":     "module example.com/app\n\ngo 1.22\n\nrequire example.com/lib v0.0.0\n\nreplace example.com/lib => ./lib\n",
		"lib/go.mod": "module example.com/lib\n\ngo 1.22\n",
		"lib/lib.go": "package lib\n\nfunc Parse(s string) string { return s }\n",
		"main.go":    "package main\n\nimport \"example.com/lib\"\n\nfunc main() { _ = lib.Parse(\"a\") }\n",
	})
	app.Merge(lib)
	for _, call := range app.Calls {
		if call.From == "example.com/app.main" && call.To == "example.com/lib.Parse" {
			return
		}
	}
	t.Fatalf("cross-module call missing: %+v (pending %+v)", app.Calls, app.ExternalCalls)
}
