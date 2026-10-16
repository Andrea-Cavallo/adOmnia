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

func TestReadSinceReadsOnlyNewCompleteLines(t *testing.T) {
	path := filepath.Join(t.TempDir(), "current.jsonl")
	write := func(text string, flag int) {
		t.Helper()
		file, err := os.OpenFile(path, flag|os.O_WRONLY, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.WriteString(text); err != nil {
			t.Fatal(err)
		}
		file.Close()
	}
	write(`{"i":1,"msg":"a"}`+"\n"+`{"i":2,"msg":"b"}`+"\n", os.O_CREATE|os.O_TRUNC)

	first, err := ReadSince(path, 0, 0)
	if err != nil || len(first.Entries) != 2 {
		t.Fatalf("first = %+v, %v", first, err)
	}
	idle, err := ReadSince(path, first.Next, 0)
	if err != nil || len(idle.Entries) != 0 || idle.Next != first.Next {
		t.Fatalf("no new logs must read nothing: %+v, %v", idle, err)
	}

	write(`{"i":3,"msg":"c"}`+"\n"+`{"i":4,"msg":"half`, os.O_APPEND)
	next, err := ReadSince(path, first.Next, 0)
	if err != nil || len(next.Entries) != 1 || next.Entries[0].Msg != "c" {
		t.Fatalf("next = %+v, %v (a line still being written must wait)", next, err)
	}

	write(`{"i":9,"msg":"after clear"}`+"\n", os.O_TRUNC)
	cleared, err := ReadSince(path, next.Next, 0)
	if err != nil || len(cleared.Entries) != 1 || cleared.Entries[0].Msg != "after clear" {
		t.Fatalf("after truncation = %+v, %v", cleared, err)
	}
}
