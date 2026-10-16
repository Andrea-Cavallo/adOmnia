package agentreview

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeFile(t *testing.T, root, relative, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	// Alcuni filesystem hanno mtime a grana grossa: l'impronta deve cambiare comunque.
	future := time.Now().Add(time.Duration(len(content)+1) * time.Second)
	_ = os.Chtimes(path, future, future)
}

func readFile(t *testing.T, root, relative string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(relative)))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func statuses(review Review) map[string]FileStatus {
	result := map[string]FileStatus{}
	for _, file := range review.Files {
		result[file.Path] = file.Status
	}
	return result
}

// agentTurn simula un turno: foto, modifiche dell'agente, fine turno.
func agentTurn(t *testing.T, tracker *Tracker, root string, edits func()) {
	t.Helper()
	end := tracker.BeginTurn(root, "Claude Code")
	edits()
	end()
}

func TestTurnRecordsAddedModifiedAndDeletedFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "main.go", "package main\n")
	writeFile(t, root, "old.go", "package main\n// old\n")
	writeFile(t, root, "same.go", "package main\n")
	tracker := NewTracker()
	var events []ChangedPayload
	tracker.SetEmitter(func(event string, payload any) {
		if event == ChangedEvent {
			events = append(events, payload.(ChangedPayload))
		}
	})

	agentTurn(t, tracker, root, func() {
		writeFile(t, root, "main.go", "package main\n\nfunc main() {}\n")
		writeFile(t, root, "pkg/new.go", "package pkg\n")
		writeFile(t, root, "same.go", "package main\n") // riscritto identico: non è una modifica
		if err := os.Remove(filepath.Join(root, "old.go")); err != nil {
			t.Fatal(err)
		}
	})

	review := tracker.Get(root)
	want := map[string]FileStatus{"main.go": StatusModified, "pkg/new.go": StatusAdded, "old.go": StatusDeleted}
	got := statuses(review)
	if len(got) != len(want) {
		t.Fatalf("files = %v, want %v", got, want)
	}
	for path, status := range want {
		if got[path] != status {
			t.Errorf("%s = %q, want %q", path, got[path], status)
		}
	}
	if review.Files[0].Path != "main.go" || review.Files[0].Baseline != "package main\n" || review.Files[0].Agent != "Claude Code" {
		t.Errorf("first file = %+v", review.Files[0])
	}
	if len(events) != 1 || events[0].Files != 3 {
		t.Errorf("events = %+v, want one event with 3 files", events)
	}
}

func TestRejectAllRestoresTheProjectAsBeforeTheTurn(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "main.go", "package main\n")
	writeFile(t, root, "old.go", "package old\n")
	tracker := NewTracker()
	agentTurn(t, tracker, root, func() {
		writeFile(t, root, "main.go", "package main // changed\n")
		writeFile(t, root, "new.go", "package main\n")
		_ = os.Remove(filepath.Join(root, "old.go"))
	})

	if err := tracker.RejectAll(root); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, root, "main.go"); got != "package main\n" {
		t.Errorf("main.go = %q", got)
	}
	if got := readFile(t, root, "old.go"); got != "package old\n" {
		t.Errorf("old.go = %q", got)
	}
	if _, err := os.Stat(filepath.Join(root, "new.go")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("new.go should be deleted, stat err = %v", err)
	}
	if files := tracker.Get(root).Files; len(files) != 0 {
		t.Errorf("review should be empty, got %+v", files)
	}
}

func TestPartialReviewKeepsOnlyWhatTheUserAccepted(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.go", "one\ntwo\nthree\n")
	tracker := NewTracker()
	agentTurn(t, tracker, root, func() { writeFile(t, root, "a.go", "ONE\ntwo\nTHREE\n") })

	// Accetta il primo blocco (la baseline lo include), rifiuta il secondo (il disco torna indietro).
	if err := tracker.SetBaseline(root, "a.go", "ONE\ntwo\nthree\n"); err != nil {
		t.Fatal(err)
	}
	if err := tracker.WriteCurrent(root, "a.go", "ONE\ntwo\nthree\n", "ONE\ntwo\nTHREE\n"); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, root, "a.go"); got != "ONE\ntwo\nthree\n" {
		t.Errorf("a.go = %q", got)
	}
	if files := tracker.Get(root).Files; len(files) != 0 {
		t.Errorf("a fully reviewed file must leave the review, got %+v", files)
	}
}

func TestWriteCurrentNeverOverwritesALaterEdit(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.go", "one\n")
	tracker := NewTracker()
	agentTurn(t, tracker, root, func() { writeFile(t, root, "a.go", "agent\n") })
	writeFile(t, root, "a.go", "user edit\n")

	if err := tracker.WriteCurrent(root, "a.go", "one\n", "agent\n"); !errors.Is(err, ErrStale) {
		t.Fatalf("err = %v, want ErrStale", err)
	}
	if got := readFile(t, root, "a.go"); got != "user edit\n" {
		t.Errorf("a.go = %q, the user's edit was overwritten", got)
	}
}

func TestLaterTurnsKeepTheOriginalBaseline(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.go", "v1\n")
	tracker := NewTracker()
	agentTurn(t, tracker, root, func() { writeFile(t, root, "a.go", "v2\n") })
	agentTurn(t, tracker, root, func() { writeFile(t, root, "a.go", "v3\n") })

	files := tracker.Get(root).Files
	if len(files) != 1 || files[0].Baseline != "v1\n" || files[0].Current != "v3\n" {
		t.Fatalf("files = %+v, want v1 → v3", files)
	}
}

func TestOnlyPathsInReviewCanBeWritten(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.go", "a\n")
	tracker := NewTracker()
	agentTurn(t, tracker, root, func() { writeFile(t, root, "a.go", "b\n") })

	for _, path := range []string{"../escape.go", "other.go", ""} {
		if err := tracker.WriteCurrent(root, path, "x", "b\n"); err == nil {
			t.Errorf("WriteCurrent(%q) must fail", path)
		}
	}
	if err := tracker.AcceptFile(t.TempDir(), "a.go"); err == nil {
		t.Error("a project without review must be refused")
	}
}

func TestSkippedFoldersAndUserRevertsLeaveNoChanges(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.go", "a\n")
	tracker := NewTracker()
	agentTurn(t, tracker, root, func() {
		writeFile(t, root, "node_modules/x/index.js", "x\n")
		writeFile(t, root, ".git/HEAD", "ref\n")
		writeFile(t, root, "a.go", "b\n")
	})
	writeFile(t, root, "a.go", "a\n") // l'utente annulla a mano

	if files := tracker.Get(root).Files; len(files) != 0 {
		t.Errorf("files = %+v, want none", files)
	}
}

func TestBinaryFilesCanOnlyBeAcceptedAsAWhole(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "logo.png", "\x89PNG\x00old")
	tracker := NewTracker()
	agentTurn(t, tracker, root, func() { writeFile(t, root, "logo.png", "\x89PNG\x00new!") })

	files := tracker.Get(root).Files
	if len(files) != 1 || files[0].Reviewable {
		t.Fatalf("files = %+v, want one non-reviewable file", files)
	}
	if err := tracker.RejectFile(root, "logo.png"); err == nil || !strings.Contains(err.Error(), "binary") {
		t.Errorf("reject err = %v, want a clear binary message", err)
	}
	if err := tracker.AcceptFile(root, "logo.png"); err != nil {
		t.Fatal(err)
	}
	if files := tracker.Get(root).Files; len(files) != 0 {
		t.Errorf("files = %+v after accept", files)
	}
}
