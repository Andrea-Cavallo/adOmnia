package goide

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRuntimeLockDetectsCrashFromHeartbeatNotPID(t *testing.T) {
	directory := t.TempDir()
	now := time.Now()
	clock := func() time.Time { return now }

	first, status, err := AcquireRuntimeLock(directory, clock)
	if err != nil || status.PreviousCrashed {
		t.Fatalf("primo avvio: %+v %v", status, err)
	}
	first.Release()
	if _, err := os.Stat(filepath.Join(directory, runtimeLockFile)); !os.IsNotExist(err) {
		t.Fatal("una chiusura pulita deve rimuovere il lock")
	}

	// Avvio che muore senza Release: il lock resta con l'heartbeat fermo.
	crashed, _, err := AcquireRuntimeLock(directory, clock)
	if err != nil {
		t.Fatal(err)
	}
	close(crashed.stop) // il processo "muore": niente più heartbeat, niente Release

	// Subito dopo (heartbeat fresco) non è un crash: potrebbe essere un'altra istanza viva.
	if _, status, _ := AcquireRuntimeLock(directory, clock); status.PreviousCrashed {
		t.Fatal("un heartbeat recente non è un crash")
	}
	// Rimette il lock "morto" e avanza il tempo oltre la soglia.
	data, _ := json.Marshal(runtimeLockInfo{Instance: "old", PID: os.Getpid(), StartedAt: now, Heartbeat: now})
	_ = os.WriteFile(filepath.Join(directory, runtimeLockFile), data, 0o600)
	later := func() time.Time { return now.Add(staleHeartbeatAfter + time.Second) }
	next, status, err := AcquireRuntimeLock(directory, later)
	if err != nil || !status.PreviousCrashed || !status.LastHeartbeat.Equal(now) {
		t.Fatalf("crash non rilevato (stesso PID, heartbeat fermo): %+v %v", status, err)
	}
	next.Release()

	_ = os.WriteFile(filepath.Join(directory, runtimeLockFile), []byte("{corrotto"), 0o600)
	if lock, status, _ := AcquireRuntimeLock(directory, clock); !status.PreviousCrashed {
		t.Fatal("un lock illeggibile indica una chiusura durante la scrittura")
	} else {
		lock.Release()
	}
}

func TestRecoveryKeepsThreeSnapshotsAndSkipsCorruptOnes(t *testing.T) {
	store := &memoryStore{}
	manager := NewRecoveryManager(store)
	for _, content := range []string{"v1", "v2", "v3", "v4"} {
		if err := manager.Remember("s", "main.go", content, "t"); err != nil {
			t.Fatal(err)
		}
	}
	entry := manager.List("s")[0]
	if entry.Content != "v4" || len(entry.Previous) != 2 || entry.Previous[0].Content != "v3" || entry.Previous[1].Content != "v2" {
		t.Fatalf("snapshot conservate male: %+v", entry)
	}

	// La snapshot più recente si corrompe: al riavvio si usa la precedente integra.
	var state recoveryState
	_ = json.Unmarshal(store.data, &state)
	state.Buffers[0].Content = "corrotto"
	store.data, _ = json.Marshal(state)
	reloaded := NewRecoveryManager(store)
	if err := reloaded.Load(); err != nil {
		t.Fatal(err)
	}
	if got := reloaded.List("s"); len(got) != 1 || got[0].Content != "v3" {
		t.Fatalf("fallback sulla snapshot precedente fallito: %+v", got)
	}
}

func TestRecoveredBuffersAreClassifiedAgainstTheDisk(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/rec\n\ngo 1.26\n")
	writeFixtureFile(t, project, "safe.go", "package rec\n")
	writeFixtureFile(t, project, "applied.go", "package rec\n")
	writeFixtureFile(t, project, "conflict.go", "package rec\n")
	writeFixtureFile(t, project, "gone.go", "package rec\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	token := func(name string) string {
		_, _, value, err := readTextFile(filepath.Join(project, name))
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	id := string(session.ID)
	for _, name := range []string{"safe.go", "applied.go", "conflict.go", "gone.go"} {
		if err := service.RememberBuffer(id, name, "package rec\n\nfunc Edited() {}\n", token(name)); err != nil {
			t.Fatal(err)
		}
	}
	writeFixtureFile(t, project, "applied.go", "package rec\n\nfunc Edited() {}\n")
	writeFixtureFile(t, project, "conflict.go", "package rec\n\nfunc Other() {}\n")
	_ = os.Remove(filepath.Join(project, "gone.go"))
	// Solo l'mtime cambia (checkout, touch): il contenuto di partenza è lo stesso, quindi resta safe.
	future := time.Now().Add(time.Hour)
	_ = os.Chtimes(filepath.Join(project, "safe.go"), future, future)

	buffers, err := service.ListRecoveredBuffers(id)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"safe.go": "safe", "applied.go": "already-applied", "conflict.go": "conflict", "gone.go": "missing"}
	for _, buffer := range buffers {
		if buffer.Status != want[buffer.RelativePath] {
			t.Fatalf("%s: stato %q, atteso %q", buffer.RelativePath, buffer.Status, want[buffer.RelativePath])
		}
	}
	if len(buffers) != len(want) {
		t.Fatalf("buffer recuperati: %d", len(buffers))
	}
	data, _ := os.ReadFile(filepath.Join(project, "conflict.go"))
	if string(data) != "package rec\n\nfunc Other() {}\n" {
		t.Fatal("il recupero non deve mai scrivere sul disco")
	}
}

func TestTenDirtyBuffersAreAllRecoveredAndSessionViewKeepsCursorsAndSplit(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/ten\n\ngo 1.26\n")
	store := &memoryStore{}
	service := NewService(store, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	for index := 0; index < 10; index++ {
		name := filepath.Join("pkg", "file"+string(rune('a'+index))+".go")
		writeFixtureFile(t, project, filepath.ToSlash(name), "package pkg\n")
		if err := service.RememberBuffer(id, filepath.ToSlash(name), "package pkg\n\n// dirty\n", ""); err != nil {
			t.Fatal(err)
		}
	}
	buffers, err := service.ListRecoveredBuffers(id)
	if err != nil || len(buffers) != 10 {
		t.Fatalf("buffer recuperati: %d %v", len(buffers), err)
	}

	err = service.SaveSessionView(id, SessionView{
		OpenPaths: []string{"pkg/filea.go", "pkg/fileb.go"},
		Cursors:   []CursorPosition{{Path: "pkg/filea.go", Line: 3, Column: 4}, {Path: "", Line: 1, Column: 1}, {Path: "pkg/fileb.go", Line: 0, Column: 1}},
		Split:     &SplitView{Orientation: "right", ActivePath: "pkg/fileb.go", Paths: []string{"pkg/fileb.go", "pkg/fileb.go"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.GetSessionView(id)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Cursors) != 1 || view.Cursors[0].Line != 3 || view.Split == nil || len(view.Split.Paths) != 1 {
		t.Fatalf("vista di sessione inattesa: %+v / %+v", view.Cursors, view.Split)
	}
	if err := service.SaveSessionView(id, SessionView{Split: &SplitView{Orientation: "diagonal", ActivePath: "x.go"}}); err != nil {
		t.Fatal(err)
	}
	if view, _ := service.GetSessionView(id); view.Split != nil {
		t.Fatal("uno split non valido va scartato")
	}
}

func TestCorruptSessionStateFallsBackWithoutBlockingStartup(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/bad\n\ngo 1.26\n")
	service := NewService(&memoryStore{data: []byte(`{"version": 4, "sessions": [`)}, nil)
	t.Cleanup(service.Shutdown)
	if _, err := service.OpenProject(project); err != nil {
		t.Fatalf("uno stato di sessione corrotto non deve impedire di aprire un progetto: %v", err)
	}
}

func TestRecoveryFollowsTheWorkspaceAcrossSessionsAndExpiresOldSnapshots(t *testing.T) {
	store := &memoryStore{}
	manager := NewRecoveryManager(store)
	workspace := WorkspaceID("/home/me/proj")
	manager.BindWorkspace("old-session", workspace)
	if err := manager.Remember("old-session", "main.go", "dirty", ""); err != nil {
		t.Fatal(err)
	}
	// Il progetto viene riaperto con una sessione nuova: i buffer la seguono.
	manager.BindWorkspace("new-session", workspace)
	if got := manager.List("new-session"); len(got) != 1 || got[0].Content != "dirty" {
		t.Fatalf("buffer non adottati: %+v", got)
	}
	if WorkspaceID("/home/me/proj/") != workspace || WorkspaceID("/home/me/other") == workspace {
		t.Fatal("workspace id non stabile")
	}

	var state recoveryState
	_ = json.Unmarshal(store.data, &state)
	state.Buffers[0].SavedAt = time.Now().Add(-recoveryRetention - time.Hour)
	state.Buffers[0].SnapshotHash = ""
	store.data, _ = json.Marshal(state)
	reloaded := NewRecoveryManager(store)
	_ = reloaded.Load()
	if len(reloaded.List("new-session")) != 0 {
		t.Fatal("una snapshot oltre la retention va eliminata")
	}
}
