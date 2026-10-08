package devcontext

import (
	"adomnia/internal/plugins"
	"os"
	"path/filepath"
	"testing"
)

func TestPluginAdaptersDetectDirectDependenciesAndDisappear(t *testing.T) {
	root := t.TempDir()
	mod := "module example.com/service\n\ngo 1.26\nrequire (\n example.com/framework v1.0.0\n example.com/broker v1.0.0\n example.com/database v1.0.0\n example.com/indirect v1.0.0 // indirect\n)\n"
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte(mod), 0600); err != nil {
		t.Fatal(err)
	}
	base := Snapshot{Root: root, Entities: []Entity{entity("module", "service", "service", ConfidenceCertain, nil, Source{"gomod", "go.mod", 1})}}
	items := []plugins.Contribution{}
	for _, kind := range []string{"framework", "broker", "database", "indirect"} {
		items = append(items, plugins.Contribution{Kind: "adapter", PluginID: "p", ID: kind, Title: kind, AdapterKind: kind, Modules: []string{"example.com/" + kind}})
	}
	result := WithPluginAdapters(base, items)
	if len(result.Entities) != 4 {
		t.Fatalf("direct adapters: %#v", result.Entities)
	}
	for _, entity := range result.Entities {
		if entity.Attrs["origin"] == "plugin" && (entity.Confidence != ConfidenceInferred || entity.Sources[0].Line < 4 || entity.Attrs["detection"] != "direct-dependency") {
			t.Fatalf("fabricated runtime evidence: %#v", entity)
		}
	}
	if len(base.Entities) != 1 {
		t.Fatal("cached snapshot mutated")
	}
	if got := WithPluginAdapters(base, nil); len(got.Entities) != 1 {
		t.Fatal("disabled adapters remained")
	}
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/service\n"), 0600)
	if got := WithPluginAdapters(base, items); len(got.Entities) != 1 {
		t.Fatal("removed dependency remained")
	}
}
