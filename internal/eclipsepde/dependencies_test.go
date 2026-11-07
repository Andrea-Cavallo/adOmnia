package eclipsepde

import (
	"path/filepath"
	"testing"
)

func TestLookupDependencyFindsProvidersConsumersAndUndeclaredUses(t *testing.T) {
	root, _ := keplerWorkspace(t)
	// app requires core (which exports "core"): declared and used.
	writeText(t, filepath.Join(root, "app", "src", "app", "Uses.java"), "package app;\n\nimport core.Core;\nclass Uses {}")
	// tool uses core.Core without declaring anything: runtime ClassNotFoundException.
	writeProject(t, root, "tool", bundleManifest("tool"),
		map[string]string{".classpath": sourcesClasspath, "src/tool/T.java": "package tool;\nimport java.util.List;\nimport core.*;\nclass T {}"})
	if _, err := ReindexReport(root); err != nil {
		t.Fatal(err)
	}
	report, err := BuildExplorer(root, 0)
	if err != nil {
		t.Fatal(err)
	}

	lookup := report.LookupDependency("core/Core.java")
	if lookup.Package != "core" || lookup.Class != "core.Core" || lookup.JRE {
		t.Fatalf("query = %+v", lookup)
	}
	if len(lookup.Providers) != 1 || lookup.Providers[0].SymbolicName != "core" {
		t.Fatalf("providers = %+v", lookup.Providers)
	}
	if lookup.Missing != 1 || len(lookup.Consumers) != 2 {
		t.Fatalf("consumers = %+v", lookup.Consumers)
	}
	tool, app := lookup.Consumers[0], lookup.Consumers[1]
	if tool.Bundle != "tool" || tool.Problem == "" || tool.Via != "" || tool.File != "tool/src/tool/T.java" || tool.Line != 3 {
		t.Fatalf("tool = %+v", tool)
	}
	if app.Bundle != "app" || app.Problem != "" || app.Via != "Require-Bundle" || app.Line != 3 {
		t.Fatalf("app = %+v", app)
	}

	if jre := report.LookupDependency("java.util.List"); !jre.JRE || jre.Missing != 0 {
		t.Fatalf("a JRE class is never missing: %+v", jre)
	}
}
