package agenttask

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeProvider struct {
	mu        sync.Mutex
	created   []WorkspaceRequest
	removed   []string
	state     WorkspaceState
	notice    string
	fingerpr  string
	changed   int
	fpErr     error
	createErr error
	removeErr error
}

func (provider *fakeProvider) Create(request WorkspaceRequest) (Workspace, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.createErr != nil {
		return Workspace{}, provider.createErr
	}
	provider.created = append(provider.created, request)
	return Workspace{
		Repository: request.RepoRoot, Path: filepath.Join(request.RepoRoot, "..", request.TaskID),
		Branch: "adomnia/" + request.TaskID, BaseRef: request.BaseRef, BaseSHA: "abc123",
		State: WorkspaceReady, CreatedAt: time.Now().UTC(),
	}, nil
}

func (provider *fakeProvider) Inspect(Workspace) (WorkspaceState, string) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.state == "" {
		return WorkspaceReady, ""
	}
	return provider.state, provider.notice
}

func (provider *fakeProvider) Remove(workspace Workspace) error {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.removeErr != nil {
		return provider.removeErr
	}
	provider.removed = append(provider.removed, workspace.Path)
	return nil
}

func (provider *fakeProvider) Fingerprint(string, string) (string, int, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.fpErr != nil {
		return "", 0, provider.fpErr
	}
	if provider.fingerpr == "" {
		return "fingerprint", 2, nil
	}
	return provider.fingerpr, provider.changed, nil
}

type fakeVerifier struct {
	mu       sync.Mutex
	requests []VerifyRequest
	outcome  EvidenceOutcome
}

func (verifier *fakeVerifier) Run(_ context.Context, request VerifyRequest) Evidence {
	verifier.mu.Lock()
	defer verifier.mu.Unlock()
	verifier.requests = append(verifier.requests, request)
	return Evidence{Outcome: verifier.outcome, Command: "go test ./...", Log: "measured log", Environment: "test"}
}

func waitForEvidence(t *testing.T, service *Service, id string, count int) Task {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		task, err := service.Get(id)
		if err == nil && len(task.Evidences) >= count {
			return task
		}
		time.Sleep(5 * time.Millisecond)
	}
	task, _ := service.Get(id)
	t.Fatalf("evidences = %d, want %d", len(task.Evidences), count)
	return Task{}
}

func TestCreateWorkspaceAssignsIsolatedWorkdirAndKeepsProjectRoot(t *testing.T) {
	service, _ := newTestService(t)
	provider := &fakeProvider{}
	service.SetWorkspaceProvider(provider)
	root := t.TempDir()
	task, err := service.Create(testDraft(root))
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.CreateWorkspace(task.ID, "HEAD~1", false)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Workspace == nil || updated.Workspace.Path == "" || updated.Workspace.State != WorkspaceReady {
		t.Fatalf("workspace was not assigned: %+v", updated.Workspace)
	}
	if updated.Root != filepath.Clean(root) {
		t.Fatalf("task root changed to %q", updated.Root)
	}
	if got := provider.created[0]; got.BaseRef != "HEAD~1" || got.TaskID != task.ID {
		t.Fatalf("unexpected provider request: %+v", got)
	}
	if workdir := updated.workdir(); workdir != updated.Workspace.Path {
		t.Fatalf("workdir = %q, want %q", workdir, updated.Workspace.Path)
	}
}

func TestStartRunsTheAgentInTheWorkspaceAndRejectsSharedWorkdir(t *testing.T) {
	service, _ := newTestService(t)
	provider := &fakeProvider{}
	service.SetWorkspaceProvider(provider)
	roots := make(chan string, 2)
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, publish func(Event)) error {
		roots <- request.Task.Root
		<-ctx.Done()
		return ctx.Err()
	}))
	root := t.TempDir()
	first, _ := service.Create(testDraft(root))
	if _, err := service.CreateWorkspace(first.ID, "", false); err != nil {
		t.Fatal(err)
	}
	// Un task senza workspace nello stesso progetto scrive nel working tree condiviso.
	shared, _ := service.Create(testDraft(root))
	sharedSibling, _ := service.Create(testDraft(root))
	if _, err := service.Start(first.ID, "context", ContextReceipt{}); err != nil {
		t.Fatal(err)
	}
	if root := <-roots; root != mustWorkspacePath(t, service, first.ID) {
		t.Fatalf("agent ran in %q, not in its workspace", root)
	}
	if _, err := service.Start(shared.ID, "context", ContextReceipt{}); err != nil {
		t.Fatalf("a task with its own working tree must run beside an isolated one: %v", err)
	}
	if _, err := service.Start(sharedSibling.ID, "context", ContextReceipt{}); err == nil {
		t.Fatal("two tasks sharing one working tree must not run at the same time")
	}
	if _, err := service.Stop(first.ID); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, service, first.ID, StatusStopped)
	if _, err := service.Stop(shared.ID); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, service, shared.ID, StatusStopped)
}

func mustWorkspacePath(t *testing.T, service *Service, id string) string {
	t.Helper()
	task, err := service.Get(id)
	if err != nil || task.Workspace == nil {
		t.Fatalf("workspace missing: %+v, %v", task.Workspace, err)
	}
	return task.Workspace.Path
}

func TestVerificationRecordsEvidenceAndCorrectionRerunsTheSameChecks(t *testing.T) {
	service, _ := newTestService(t)
	service.SetWorkspaceProvider(&fakeProvider{})
	verifier := &fakeVerifier{outcome: EvidenceFailed}
	service.SetVerifier(verifier)
	attempts := make(chan RunRequest, 2)
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, publish func(Event)) error {
		attempts <- request
		return nil
	}))
	task, err := service.Create(testDraft(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.AddVerification(task.ID, VerificationDraft{Kind: VerificationTest, Packages: []string{"./..."}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(task.ID, "approved context", ContextReceipt{Bytes: 100}); err != nil {
		t.Fatal(err)
	}
	<-attempts
	waitForStatus(t, service, task.ID, StatusCompleted)

	if _, err := service.StartVerifications(task.ID, nil); err != nil {
		t.Fatal(err)
	}
	verified := waitForEvidence(t, service, task.ID, 1)
	evidence := verified.Evidences[0]
	if evidence.Outcome != EvidenceFailed || evidence.Command == "" || evidence.DiffFingerprint == "" {
		t.Fatalf("evidence was not recorded completely: %+v", evidence)
	}
	if evidence.AttemptID != verified.Attempts[0].ID {
		t.Fatalf("evidence is not linked to the attempt: %+v", evidence)
	}

	// Chiedi correzione: il nuovo tentativo cita l'evidenza e riesegue la stessa verifica.
	if _, err := service.StartCorrection(task.ID, []string{evidence.ID}, nil, "handle the nil map"); err != nil {
		t.Fatal(err)
	}
	correction := <-attempts
	if correction.Attempt.EvidenceIDs[0] != evidence.ID || correction.Attempt.CorrectionOf == "" {
		t.Fatalf("correction attempt is not linked: %+v", correction.Attempt)
	}
	if !strings.Contains(correction.Message, "measured log") || !strings.Contains(correction.Message, "handle the nil map") {
		t.Fatalf("correction prompt lost the selected evidence: %s", correction.Message)
	}
	waitForStatus(t, service, task.ID, StatusCompleted)
	rerun := waitForEvidence(t, service, task.ID, 2)
	if len(rerun.Evidences) != 2 || rerun.Evidences[1].VerificationID != evidence.VerificationID {
		t.Fatalf("the same verification was not re-run after the correction: %+v", rerun.Evidences)
	}
	verifier.mu.Lock()
	defer verifier.mu.Unlock()
	if len(verifier.requests) != 2 {
		t.Fatalf("verifier ran %d times", len(verifier.requests))
	}
}

func TestVerificationNeverReportsPassedWithoutAVerifier(t *testing.T) {
	service, _ := newTestService(t)
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.AddVerification(task.ID, VerificationDraft{Kind: VerificationRequest, URL: "http://localhost:8080/health"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartVerifications(task.ID, nil); err == nil {
		t.Fatal("verification without a verifier must fail")
	}
	current, _ := service.Get(task.ID)
	if len(current.Evidences) != 0 || len(current.VerifyingIDs) != 0 {
		t.Fatalf("a missing verifier produced state: %+v", current)
	}
}

func TestRemoveWorkspaceKeepsTheTaskWhenRemovalIsRefused(t *testing.T) {
	service, _ := newTestService(t)
	provider := &fakeProvider{removeErr: errors.New("worktree contains modified files")}
	service.SetWorkspaceProvider(provider)
	task, _ := service.Create(testDraft(t.TempDir()))
	workspaceTask, err := service.CreateWorkspace(task.ID, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.RemoveWorkspace(workspaceTask.ID); err == nil {
		t.Fatal("expected the removal error")
	}
	current, _ := service.Get(task.ID)
	if current.Workspace == nil {
		t.Fatal("workspace association was dropped although removal failed")
	}
}

func TestReconcileMarksExternallyRemovedWorkspace(t *testing.T) {
	service, _ := newTestService(t)
	provider := &fakeProvider{}
	service.SetWorkspaceProvider(provider)
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.CreateWorkspace(task.ID, "", false); err != nil {
		t.Fatal(err)
	}
	provider.mu.Lock()
	provider.state, provider.notice = WorkspaceMissing, "removed outside adOmnia"
	provider.mu.Unlock()
	changed := service.ReconcileWorkspaces()
	if len(changed) != 1 || changed[0].Workspace.State != WorkspaceMissing || changed[0].Workspace.Notice == "" {
		t.Fatalf("workspace was not reconciled: %+v", changed)
	}
}

func TestStoppedCorrectionDoesNotRerunVerificationsLater(t *testing.T) {
	service, _ := newTestService(t)
	service.SetWorkspaceProvider(&fakeProvider{})
	verifier := &fakeVerifier{outcome: EvidenceFailed}
	service.SetVerifier(verifier)
	var calls int32
	started := make(chan struct{}, 4)
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, publish func(Event)) error {
		atomic.AddInt32(&calls, 1)
		started <- struct{}{}
		if atomic.LoadInt32(&calls) == 2 {
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}))
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.AddVerification(task.ID, VerificationDraft{Kind: VerificationTest}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(task.ID, "context", ContextReceipt{Bytes: 10}); err != nil {
		t.Fatal(err)
	}
	<-started
	waitForStatus(t, service, task.ID, StatusCompleted)
	if _, err := service.StartVerifications(task.ID, nil); err != nil {
		t.Fatal(err)
	}
	verified := waitForEvidence(t, service, task.ID, 1)
	if _, err := service.StartCorrection(task.ID, []string{verified.Evidences[0].ID}, nil, ""); err != nil {
		t.Fatal(err)
	}
	<-started
	if _, err := service.Stop(task.ID); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, service, task.ID, StatusStopped)
	// Un tentativo normale dopo l'interruzione non deve riattivare la vecchia correzione.
	if _, err := service.Start(task.ID, "context", ContextReceipt{Bytes: 10}); err != nil {
		t.Fatal(err)
	}
	<-started
	waitForStatus(t, service, task.ID, StatusCompleted)
	time.Sleep(50 * time.Millisecond)
	verifier.mu.Lock()
	defer verifier.mu.Unlock()
	if len(verifier.requests) != 1 {
		t.Fatalf("verifier ran %d times; a stopped correction must not re-run later", len(verifier.requests))
	}
}

func TestVerificationDraftValidation(t *testing.T) {
	cases := []VerificationDraft{
		{Kind: VerificationRequest, URL: "not-a-url"},
		{Kind: VerificationRequest, URL: "ftp://localhost/file"},
		{Kind: VerificationTest, WorkingDirectory: "../../etc"},
		{Kind: "shell"},
	}
	for _, draft := range cases {
		if _, err := normalizeVerificationDraft(draft); err == nil {
			t.Fatalf("expected a validation error for %+v", draft)
		}
	}
	normalized, err := normalizeVerificationDraft(VerificationDraft{Kind: VerificationTest})
	if err != nil || normalized.Language != "go" || normalized.TimeoutSeconds == 0 {
		t.Fatalf("test defaults were not applied: %+v, %v", normalized, err)
	}
}

func TestCorrectionLoopStopsAtTheLimit(t *testing.T) {
	service, _ := newTestService(t)
	draft := testDraft(t.TempDir())
	draft.Limits.MaxCorrections = 2
	task, err := service.Create(draft)
	if err != nil {
		t.Fatal(err)
	}
	service.mu.Lock()
	stored := service.tasks[task.ID]
	stored.Attempts = []Attempt{{ID: "a1"}, {ID: "a2", CorrectionOf: "a1"}, {ID: "a3", CorrectionOf: "a2"}}
	stored.Evidences = []Evidence{{ID: "e1", VerificationID: "v1"}}
	service.tasks[task.ID] = stored
	service.mu.Unlock()
	if _, err := service.StartCorrection(task.ID, []string{"e1"}, nil, ""); err == nil || !strings.Contains(err.Error(), "limit of 2") {
		t.Fatalf("expected the correction limit to stop the loop, got %v", err)
	}
	// Una nuova esecuzione normale azzera la catena.
	if got := consecutiveCorrections(Task{Attempts: []Attempt{{ID: "a1", CorrectionOf: "x"}, {ID: "a2"}}}); got != 0 {
		t.Fatalf("a plain run must reset the chain, got %d", got)
	}
}

func TestServiceLaunchIsValidatedAndStaysLocal(t *testing.T) {
	base := VerificationDraft{Kind: VerificationRequest, URL: "http://127.0.0.1:8080/health", Service: ServiceLaunch{Name: "api", Configuration: `{"kind":"package"}`}}
	normalized, err := normalizeVerificationDraft(base)
	if err != nil || normalized.Service.ReadyTimeoutSeconds != defaultServiceReady {
		t.Fatalf("a valid launch was rejected or not defaulted: %+v, %v", normalized.Service, err)
	}
	for name, change := range map[string]func(*VerificationDraft){
		"invalid json": func(d *VerificationDraft) { d.Service.Configuration = "{" },
		"no name":      func(d *VerificationDraft) { d.Service.Name = " " },
		"remote host":  func(d *VerificationDraft) { d.URL = "http://example.com/health" },
		"slow ready":   func(d *VerificationDraft) { d.Service.ReadyTimeoutSeconds = maxServiceReady + 1 },
	} {
		draft := base
		change(&draft)
		if _, err := normalizeVerificationDraft(draft); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
}

func TestRepeatedRegressionStopsTheCorrectionLoop(t *testing.T) {
	task := Task{Evidences: []Evidence{
		{VerificationID: "v1", Label: "health", Outcome: EvidenceFailed},
		{VerificationID: "v1", Label: "health", Outcome: EvidencePassed},
		{VerificationID: "v1", Label: "health", Outcome: EvidenceFailed},
		{VerificationID: "v1", Label: "health", Outcome: EvidenceError}, // non misurato: non conta
		{VerificationID: "v1", Label: "health", Outcome: EvidencePassed},
	}}
	if got := repeatedRegression(task, []string{"v1"}); got != "" {
		t.Fatalf("one regression must not stop the loop, got %q", got)
	}
	task.Evidences = append(task.Evidences, Evidence{VerificationID: "v1", Label: "health", Outcome: EvidenceFailed})
	if got := repeatedRegression(task, []string{"v1"}); got != "health" {
		t.Fatalf("two regressions must stop the loop, got %q", got)
	}
}

func TestDeniedPermissionStopsTheAutomaticReverification(t *testing.T) {
	service, _ := newTestService(t)
	verifier := &fakeVerifier{outcome: EvidenceFailed}
	service.SetVerifier(verifier)
	var calls atomic.Int32
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, publish func(Event)) error {
		if calls.Add(1) == 2 {
			publish(Event{Kind: "permission", RequestID: "r1", Message: "write file"})
			publish(Event{Kind: "permission_resolved", RequestID: "r1", Message: "denied"})
		}
		return nil
	}))
	task, err := service.Create(testDraft(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.AddVerification(task.ID, VerificationDraft{Kind: VerificationTest, Packages: []string{"./..."}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(task.ID, "approved context", ContextReceipt{Bytes: 100}); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, service, task.ID, StatusCompleted)
	if _, err := service.StartVerifications(task.ID, nil); err != nil {
		t.Fatal(err)
	}
	evidence := waitForEvidence(t, service, task.ID, 1).Evidences[0]
	if _, err := service.StartCorrection(task.ID, []string{evidence.ID}, nil, ""); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, service, task.ID, StatusCompleted)
	time.Sleep(100 * time.Millisecond) // a re-verification, if wrongly started, would have recorded by now
	final, _ := service.Get(task.ID)
	if len(final.Evidences) != 1 {
		t.Fatalf("a denied permission must stop the automatic re-verification: %d evidences", len(final.Evidences))
	}
	events := final.Attempts[len(final.Attempts)-1].Events
	if !strings.Contains(events[len(events)-1].Message, "permission was denied") {
		t.Fatalf("the stop is not explained: %+v", events[len(events)-1])
	}
}

type integratingProvider struct {
	fakeProvider
	checks, applies int
}

func (provider *integratingProvider) Compare(Workspace) (WorkspaceComparison, error) {
	return WorkspaceComparison{Fingerprint: "fp", ChangedFiles: []string{"a.go", "b.go"}, TargetBranch: "main", TargetChanged: []string{"b.go"}, LocalChanges: []string{"a.go"}}, nil
}

func (provider *integratingProvider) Integrate(_ Workspace, check bool) (Integration, error) {
	if check {
		provider.checks++
	} else {
		provider.applies++
	}
	return Integration{Applied: true, TargetBranch: "main", Fingerprint: "fp", Files: []string{"a.go", "b.go"}}, nil
}

func TestWorkspaceComparisonAndIntegrationAreRecorded(t *testing.T) {
	service, _ := newTestService(t)
	provider := &integratingProvider{}
	service.SetWorkspaceProvider(provider)
	task, err := service.Create(testDraft(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CompareWorkspace(task.ID); err == nil {
		t.Fatal("a task without workspace cannot be compared")
	}
	if _, err := service.CreateWorkspace(task.ID, "", false); err != nil {
		t.Fatal(err)
	}
	comparison, err := service.CompareWorkspace(task.ID)
	if err != nil || len(comparison.Overlaps) != 1 || comparison.Overlaps[0] != "b.go" || len(comparison.LocalOverlaps) != 1 || comparison.LocalOverlaps[0] != "a.go" {
		t.Fatalf("comparison = %+v, %v", comparison, err)
	}
	if _, err := service.IntegrateWorkspace(task.ID, true); err != nil {
		t.Fatal(err)
	}
	if checked, _ := service.Get(task.ID); checked.Workspace.Integration.Applied {
		t.Fatal("a dry run must not be recorded")
	}
	if _, err := service.IntegrateWorkspace(task.ID, false); err != nil {
		t.Fatal(err)
	}
	integrated, _ := service.Get(task.ID)
	if !integrated.Workspace.Integration.Applied || integrated.Workspace.Integration.At.IsZero() || provider.checks != 1 || provider.applies != 1 {
		t.Fatalf("integration not recorded: %+v", integrated.Workspace.Integration)
	}
}

func TestReviewCommentsTravelWithTheCorrectionAndComeBackForReview(t *testing.T) {
	service, _ := newTestService(t)
	attempts := make(chan RunRequest, 2)
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, request RunRequest, publish func(Event)) error {
		attempts <- request
		return nil
	}))
	task, err := service.Create(testDraft(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(task.ID, "approved context", ContextReceipt{Bytes: 100}); err != nil {
		t.Fatal(err)
	}
	<-attempts
	waitForStatus(t, service, task.ID, StatusCompleted)

	for _, bad := range []ReviewCommentDraft{
		{Path: "../outside.go", StartLine: 1, EndLine: 1, Body: "x"},
		{Path: "a.go", StartLine: 3, EndLine: 2, Body: "x"},
		{Path: "a.go", StartLine: 1, EndLine: 1, Body: "  "},
	} {
		if _, err := service.AddComment(task.ID, bad); err == nil {
			t.Fatalf("invalid comment accepted: %+v", bad)
		}
	}
	commented, err := service.AddComment(task.ID, ReviewCommentDraft{Path: "handler.go", StartLine: 10, EndLine: 12, Excerpt: "return nil", Body: "return the error instead"})
	if err != nil {
		t.Fatal(err)
	}
	comment := commented.Comments[0]
	if comment.Status != CommentOpen || comment.AttemptID != commented.Attempts[0].ID || comment.Side != "new" {
		t.Fatalf("comment not linked: %+v", comment)
	}
	if _, err := service.StartCorrection(task.ID, nil, []string{comment.ID}, ""); err != nil {
		t.Fatal(err)
	}
	correction := <-attempts
	if !strings.Contains(correction.Message, "handler.go:10-12") || !strings.Contains(correction.Message, "return the error instead") || !strings.Contains(correction.Message, "return nil") {
		t.Fatalf("the comment did not reach the agent: %s", correction.Message)
	}
	waitForStatus(t, service, task.ID, StatusCompleted)
	afterCorrection, _ := service.Get(task.ID)
	if got := afterCorrection.Comments[0]; got.Status != CommentToReview || got.SentInAttemptID != correction.Attempt.ID {
		t.Fatalf("the comment must come back for review on the new revision: %+v", got)
	}
	if _, err := service.SetCommentStatus(task.ID, comment.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartCorrection(task.ID, nil, []string{comment.ID}, ""); err == nil {
		t.Fatal("a resolved comment must be reopened before it is sent again")
	}
	if _, err := service.RemoveComment(task.ID, comment.ID); err != nil {
		t.Fatal(err)
	}
}

func TestVerificationWatchIsValidatedAndStaysLocal(t *testing.T) {
	base := VerificationDraft{Kind: VerificationRequest, URL: "http://127.0.0.1:8080/orders", Watch: VerificationWatch{Brokers: []string{" localhost:9092 "}, Topics: []string{"orders", " "}}}
	normalized, err := normalizeVerificationDraft(base)
	if err != nil || len(normalized.Watch.Topics) != 1 || normalized.Watch.Brokers[0] != "localhost:9092" {
		t.Fatalf("a valid watch was rejected or not cleaned: %+v, %v", normalized.Watch, err)
	}
	for name, change := range map[string]func(*VerificationDraft){
		"no broker":     func(d *VerificationDraft) { d.Watch.Brokers = nil },
		"no port":       func(d *VerificationDraft) { d.Watch.Brokers = []string{"localhost"} },
		"remote broker": func(d *VerificationDraft) { d.Watch.Brokers = []string{"kafka.example.com:9092"} },
	} {
		draft := base
		change(&draft)
		if _, err := normalizeVerificationDraft(draft); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
	remote := base
	remote.AllowRemote = true
	remote.URL = "http://example.com/orders"
	remote.Watch.Brokers = []string{"kafka.example.com:9092"}
	if _, err := normalizeVerificationDraft(remote); err != nil {
		t.Fatalf("an approved remote broker must be accepted: %v", err)
	}
}
