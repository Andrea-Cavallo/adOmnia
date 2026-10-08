package devlog

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadEntriesSkipsBadLinesAndLimits(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.jsonl")
	data := `{"fn":"a"}` + "\nnot json\n\n" + `{"fn":"b","source":"frontend"}` + "\n" + `{"fn":"c"}` + "\n"
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := ReadEntries(path, 2)
	if err != nil || len(got) != 2 || got[0].Source != "frontend" || got[1].Source != "backend" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestReadFileRejectsPaths(t *testing.T) {
	for _, name := range []string{"../secret.jsonl", "sub/x.jsonl", "..", ""} {
		if _, err := ReadFile(name); err == nil {
			t.Errorf("%q must be rejected", name)
		}
	}
}
