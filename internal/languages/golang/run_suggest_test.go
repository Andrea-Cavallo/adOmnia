package golang

import (
	"context"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

func TestSuggestGoModule(t *testing.T) {
	var provider run.SuggestionProvider = New()
	root := t.TempDir()
	got := provider.Suggest(context.Background(), root, project.Unit{Language: ID, Kind: UnitModule, Root: root, Name: "example.com/svc/api"})
	if len(got) != 3 || got[0].Action != "run" || got[0].Configuration.Kind != "package" || got[1].Configuration.Target != "./..." || got[0].Configuration.Name != "Run api" {
		t.Fatalf("unexpected suggestions: %+v", got)
	}
	for _, kind := range []string{UnitWorkspace, UnitLoose} {
		if len(provider.Suggest(context.Background(), root, project.Unit{Language: ID, Kind: kind, Root: root})) != 0 {
			t.Fatalf("%s must not be suggested", kind)
		}
	}
}
