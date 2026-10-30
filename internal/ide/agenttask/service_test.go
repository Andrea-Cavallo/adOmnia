package agenttask

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type runtimeFunc func(context.Context, RunRequest, func(Event)) error

func (function runtimeFunc) Run(ctx context.Context, request RunRequest, publish func(Event)) error {
	return function(ctx, request, publish)
}

func testDraft(root string) Draft {
	return Draft{
		Root: root, Intent: IntentBugfix, Objective: "Fix the failing parser", Agent: "fake",
		Criteria: []string{"The parser test passes"}, Paths: []string{"internal/parser"},
		Limits: Limits{TimeoutMinutes: 1, MaxContextBytes: 16 * 1024},
	}
}

func newTestService(t *testing.T) (*Service, *FileStore) {
	t.Helper()
	store := NewFileStore(filepath.Join(t.TempDir(), "tasks.json"))
	service, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	return service, store
}

func waitForStatus(t *testing.T, service *Service, id string, status Status) Task {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		task, err := service.Get(id)
		if err == nil && task.Status == status {
			return task
		}
		time.Sleep(5 * time.Millisecond)
	}
	task, _ := service.Get(id)
	t.Fatalf("task status = %s, want %s", task.Status, status)
	return Task{}
}

func TestLifecyclePersistsEventsAndRetryCreatesAttempt(t *testing.T) {
	service, store := newTestService(t)
	started := make(chan func(Event), 1)
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, publish func(Event)) error {
		started <- publish
		<-ctx.Done()
		return ctx.Err()
	}))
	task, err := service.Create(testDraft(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	receipt := ContextReceipt{Bytes: 1200, Sources: 3, Excluded: 1, IncludesUnsaved: true}
	if _, err := service.Start(task.ID, "approved context", receipt); err != nil {
		t.Fatal(err)
	}
	publish := <-started
	publish(Event{Kind: "permission", Message: "Allow read", SessionID: "session-one", RequestID: "request-one"})
	waitForStatus(t, service, task.ID, StatusWaitingPermission)
	publish(Event{Kind: "permission_resolved", RequestID: "request-one"})
	publish(Event{Kind: "text", Message: "token = \"super-secret-value\""})
	if _, err := service.Stop(task.ID); err != nil {
		t.Fatal(err)
	}
	stopped := waitForStatus(t, service, task.ID, StatusStopped)
	if len(stopped.Attempts) != 1 || stopped.Attempts[0].SessionID != "session-one" {
		t.Fatalf("attempt was not persisted: %+v", stopped.Attempts)
	}
	var textEvent *Event
	for index := range stopped.Attempts[0].Events {
		if stopped.Attempts[0].Events[index].Kind == "text" {
			textEvent = &stopped.Attempts[0].Events[index]
		}
	}
	if textEvent == nil || strings.Contains(textEvent.Message, "super-secret-value") {
		t.Fatalf("secret persisted in text event: %+v", textEvent)
	}

	service.RegisterRuntime("fake", runtimeFunc(func(context.Context, RunRequest, func(Event)) error { return nil }))
	if _, err := service.Start(task.ID, "new approved context", receipt); err != nil {
		t.Fatal(err)
	}
	completed := waitForStatus(t, service, task.ID, StatusCompleted)
	if len(completed.Attempts) != 2 || completed.Attempts[0].Status != StatusStopped || !completed.Attempts[1].NewSession {
		t.Fatalf("retry did not preserve attempts: %+v", completed.Attempts)
	}
	reloaded, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := reloaded.Get(task.ID)
	if err != nil || len(persisted.Attempts) != 2 || !persisted.LastContext.IncludesUnsaved {
		t.Fatalf("round trip failed: %+v, %v", persisted, err)
	}
}

func TestConcurrentTaskInSameRootIsRejectedAcrossAgents(t *testing.T) {
	service, _ := newTestService(t)
	block := make(chan struct{})
	service.RegisterRuntime("fake", runtimeFunc(func(context.Context, RunRequest, func(Event)) error {
		<-block
		return nil
	}))
	service.RegisterRuntime("other", runtimeFunc(func(context.Context, RunRequest, func(Event)) error {
		<-block
		return nil
	}))
	root := t.TempDir()
	first, _ := service.Create(testDraft(root))
	second := testDraft(root)
	second.Agent = "other"
	other, _ := service.Create(second)
	elsewhere, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.Start(first.ID, "context", ContextReceipt{}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(other.ID, "context", ContextReceipt{}); err == nil {
		t.Fatal("a second agent in the same working tree must wait: tasks share one checkout")
	}
	if _, err := service.Start(elsewhere.ID, "context", ContextReceipt{}); err != nil {
		t.Fatalf("another project must stay usable: %v", err)
	}
	close(block)
	waitForStatus(t, service, first.ID, StatusCompleted)
	waitForStatus(t, service, elsewhere.ID, StatusCompleted)
	if _, err := service.Start(other.ID, "context", ContextReceipt{}); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, service, other.ID, StatusCompleted)
}

func TestStartStoresTheApprovedPromptRedacted(t *testing.T) {
	service, store := newTestService(t)
	service.RegisterRuntime("fake", runtimeFunc(func(context.Context, RunRequest, func(Event)) error { return nil }))
	task, _ := service.Create(testDraft(t.TempDir()))
	message := "Task intent: bugfix\n\nObjective:\nFix the parser with token = \"super-secret-value\""
	if _, err := service.Start(task.ID, message, ContextReceipt{Bytes: len(message)}); err != nil {
		t.Fatal(err)
	}
	done := waitForStatus(t, service, task.ID, StatusCompleted)
	if done.Attempts[0].Prompt == "" || strings.Contains(done.Attempts[0].Prompt, "super-secret-value") {
		t.Fatalf("approved prompt was not stored safely: %+v", done.Attempts[0])
	}
	exported, err := service.Export(task.ID)
	if err != nil || !strings.Contains(exported, "Task intent: bugfix") {
		t.Fatalf("export lost the approved prompt: %v", err)
	}
	reloaded, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := reloaded.Get(task.ID)
	if err != nil || persisted.Attempts[0].Prompt == "" {
		t.Fatalf("approved prompt was not persisted: %v", err)
	}
}

func TestStreamingEventsAreCoalescedButNeverLost(t *testing.T) {
	service, _ := newTestService(t)
	previous := streamPublishInterval
	streamPublishInterval = time.Hour
	t.Cleanup(func() { streamPublishInterval = previous })

	emitted := 0
	service.SetEmitter(func(string, any) { emitted++ })
	started := make(chan func(Event), 1)
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, publish func(Event)) error {
		started <- publish
		<-ctx.Done()
		return ctx.Err()
	}))
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.Start(task.ID, "context", ContextReceipt{}); err != nil {
		t.Fatal(err)
	}
	publish := <-started
	const chunks = 40
	for range chunks {
		publish(Event{Kind: "text", Message: "chunk "})
	}
	stored, err := service.Get(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	texts := 0
	for _, event := range stored.Attempts[0].Events {
		if event.Kind == "text" {
			texts++
		}
	}
	if texts != chunks {
		t.Fatalf("streaming chunks were dropped from the task: %d/%d", texts, chunks)
	}
	if emitted >= chunks {
		t.Fatalf("every chunk was published (%d notifications); the UI update must be coalesced", emitted)
	}
	if _, err := service.Stop(task.ID); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, service, task.ID, StatusStopped)
}

func TestRecoveryRequiresInterventionWithoutRunningRuntime(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "tasks.json"))
	now := time.Now().UTC()
	task, err := NewTask(testDraft(t.TempDir()), now)
	if err != nil {
		t.Fatal(err)
	}
	task.Status, task.ActiveAttemptID = StatusRunning, "attempt-active"
	task.Attempts = []Attempt{{ID: "attempt-active", Status: StatusRunning, StartedAt: now, Events: []Event{}}}
	if err := store.Save(Snapshot{Version: CurrentVersion, Tasks: []Task{task}}); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := service.Get(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Status != StatusNeedsIntervention || recovered.ActiveAttemptID != "" || recovered.Attempts[0].EndedAt == nil {
		t.Fatalf("active task was not recovered safely: %+v", recovered)
	}
	if len(service.running) != 0 {
		t.Fatal("recovery must not start a runtime")
	}
}

func TestStoreRejectsCorruptionAndUnknownVersionWithoutOverwriting(t *testing.T) {
	for _, content := range []string{"{broken", `{"version":99,"tasks":[]}`} {
		path := filepath.Join(t.TempDir(), "tasks.json")
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		store := NewFileStore(path)
		if _, err := NewService(store); err == nil {
			t.Fatalf("expected load error for %q", content)
		}
		data, err := os.ReadFile(path) // #nosec G703 -- test-owned file
		if err != nil || string(data) != content {
			t.Fatalf("invalid store was overwritten: %q, %v", data, err)
		}
	}
}

func TestFailedRuntimeAndExport(t *testing.T) {
	service, _ := newTestService(t)
	service.RegisterRuntime("fake", runtimeFunc(func(context.Context, RunRequest, func(Event)) error {
		return errors.New("provider disconnected")
	}))
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.Start(task.ID, "context", ContextReceipt{}); err != nil {
		t.Fatal(err)
	}
	failed := waitForStatus(t, service, task.ID, StatusFailed)
	if failed.Attempts[0].Error != "provider disconnected" {
		t.Fatalf("runtime error was lost: %+v", failed.Attempts[0])
	}
	exported, err := service.Export(task.ID)
	if err != nil || !strings.Contains(exported, `"version":1`) || !strings.Contains(exported, "provider disconnected") {
		t.Fatalf("unexpected export: %s, %v", exported, err)
	}
}

func TestEventRetentionIsBounded(t *testing.T) {
	service, _ := newTestService(t)
	var publishMu sync.Mutex
	var publish func(Event)
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, emit func(Event)) error {
		publishMu.Lock()
		publish = emit
		publishMu.Unlock()
		<-ctx.Done()
		return ctx.Err()
	}))
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.Start(task.ID, "context", ContextReceipt{}); err != nil {
		t.Fatal(err)
	}
	for range maxStoredEvents + 20 {
		publishMu.Lock()
		emit := publish
		publishMu.Unlock()
		if emit != nil {
			emit(Event{Kind: "text", Message: "chunk"})
		}
	}
	if _, err := service.Stop(task.ID); err != nil {
		t.Fatal(err)
	}
	stopped := waitForStatus(t, service, task.ID, StatusStopped)
	if len(stopped.Attempts[0].Events) > maxStoredEvents {
		t.Fatalf("events grew to %d", len(stopped.Attempts[0].Events))
	}
}

type saveErrorStore struct {
	Store
	err error
}

func (store *saveErrorStore) Save(snapshot Snapshot) error {
	if store.err != nil {
		return store.err
	}
	return store.Store.Save(snapshot)
}

func TestStartSaveFailureRestoresDraft(t *testing.T) {
	store := &saveErrorStore{Store: NewFileStore(filepath.Join(t.TempDir(), "tasks.json"))}
	service, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	service.RegisterRuntime("fake", runtimeFunc(func(context.Context, RunRequest, func(Event)) error { return nil }))
	task, err := service.Create(testDraft(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	store.err = errors.New("disk full")
	if _, err := service.Start(task.ID, "context", ContextReceipt{}); err == nil {
		t.Fatal("expected the start persistence error")
	}
	current, err := service.Get(task.ID)
	if err != nil || current.Status != StatusDraft || len(current.Attempts) != 0 || len(service.running) != 0 {
		t.Fatalf("failed start left an active attempt: %+v, %v", current, err)
	}
}

func TestLatePermissionDoesNotOverwriteStopping(t *testing.T) {
	service, _ := newTestService(t)
	started := make(chan func(Event), 1)
	release := make(chan struct{})
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, publish func(Event)) error {
		started <- publish
		<-release
		return ctx.Err()
	}))
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.Start(task.ID, "context", ContextReceipt{}); err != nil {
		t.Fatal(err)
	}
	publish := <-started
	if _, err := service.Stop(task.ID); err != nil {
		t.Fatal(err)
	}
	publish(Event{Kind: "permission", Message: "late request"})
	current, _ := service.Get(task.ID)
	if current.Status != StatusStopping {
		t.Fatalf("late permission changed status to %s", current.Status)
	}
	close(release)
	waitForStatus(t, service, task.ID, StatusStopped)
}

func TestTaskRetentionAlsoPrunesServiceMemory(t *testing.T) {
	service, _ := newTestService(t)
	now := time.Now()
	var oldest string
	for index := range maxStoredTasks + 1 {
		task, err := NewTask(testDraft(t.TempDir()), now)
		if err != nil {
			t.Fatal(err)
		}
		task.UpdatedAt = now.Add(time.Duration(index) * time.Second)
		if index == 0 {
			oldest = task.ID
		}
		service.tasks[task.ID] = task
	}
	if err := service.saveLocked(); err != nil {
		t.Fatal(err)
	}
	if len(service.tasks) != maxStoredTasks {
		t.Fatalf("memory contains %d tasks", len(service.tasks))
	}
	if _, err := service.Get(oldest); err == nil {
		t.Fatal("pruned task remains in memory")
	}
}

func TestEventTruncationPreservesUTF8(t *testing.T) {
	message := redactAndLimit(strings.Repeat("文", maxEventBytes))
	if strings.ToValidUTF8(message, "") != message {
		t.Fatal("truncation produced invalid UTF-8")
	}
}

func TestFinishPersistenceFailureRequiresIntervention(t *testing.T) {
	store := &saveErrorStore{Store: NewFileStore(filepath.Join(t.TempDir(), "tasks.json"))}
	service, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	service.RegisterRuntime("fake", runtimeFunc(func(context.Context, RunRequest, func(Event)) error {
		<-release
		return nil
	}))
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.Start(task.ID, "context", ContextReceipt{}); err != nil {
		t.Fatal(err)
	}
	store.err = errors.New("disk full")
	close(release)
	current := waitForStatus(t, service, task.ID, StatusNeedsIntervention)
	if !strings.Contains(current.Attempts[0].Error, "disk full") {
		t.Fatalf("persistence error is not visible: %+v", current.Attempts[0])
	}
}
