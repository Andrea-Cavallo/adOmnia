package codestudio

import (
	"path/filepath"
	"testing"

	"adomnia/internal/ide/run"
)

func TestFinalizeSuggestionsDedupesMarksSavedAndUsesRelativeDirectory(t *testing.T) {
	root := t.TempDir()
	api := filepath.Join(root, "services", "api")
	suggest := func(id string) run.Suggestion {
		return run.Suggestion{ID: id, UnitRoot: api, Configuration: run.Configuration{Kind: "package", Target: "."}}
	}
	saved := []RunConfiguration{{Kind: RunKindPackage, Target: ".", WorkingDirectory: "services/api"}}
	got := finalizeSuggestions(root, []run.Suggestion{suggest("a"), suggest("a"), {ID: "b", UnitRoot: api, Configuration: run.Configuration{Kind: "test", Target: "./..."}}, {ID: "out", UnitRoot: filepath.Dir(root)}}, saved)
	if len(got) != 2 {
		t.Fatalf("want 2 (dup and out-of-project dropped), got %+v", got)
	}
	if got[0].Configuration.WorkingDirectory != "services/api" || !got[0].Saved || got[1].Saved {
		t.Fatalf("unexpected: %+v", got)
	}
}
