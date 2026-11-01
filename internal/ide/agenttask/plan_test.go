package agenttask

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/acceptance"
)

func waitForStep(t *testing.T, service *Service, id, stepID string, status StepStatus) PlanStep {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		task, err := service.Get(id)
		if err == nil {
			if step := stepAt(task.Plan, stepID); step != nil && step.Status == status {
				return *step
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	task, _ := service.Get(id)
	t.Fatalf("step %s did not reach %s: %+v", stepID, status, stepAt(task.Plan, stepID))
	return PlanStep{}
}

func TestPlanStepsCompleteOnlyThroughVerificationOrConfirmation(t *testing.T) {
	service, _ := newTestService(t)
	verifier := &fakeVerifier{outcome: EvidenceFailed}
	service.SetVerifier(verifier)
	prompts := make(chan RunRequest, 4)
	service.RegisterRuntime("fake", runtimeFunc(func(_ context.Context, request RunRequest, _ func(Event)) error {
		prompts <- request
		return nil
	}))
	task, err := service.Create(testDraft(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	withVerification, err := service.AddVerification(task.ID, VerificationDraft{Kind: VerificationTest, Packages: []string{"./..."}})
	if err != nil {
		t.Fatal(err)
	}
	verificationID := withVerification.Verifications[0].ID
	if _, err := service.SetPlan(task.ID, []PlanStepDraft{{ID: "b", Title: "B", DependsOn: []string{"a"}}, {ID: "a", Title: "A"}}); err == nil {
		t.Fatal("a step depending on a later step must be refused")
	}
	planned, err := service.SetPlan(task.ID, []PlanStepDraft{
		{ID: "a", Title: "Add the handler", Goal: "return 404 for unknown ids", ExpectedFiles: []string{"handler.go"}, VerificationIDs: []string{verificationID}},
		{ID: "b", Title: "Document it", DependsOn: []string{"a"}},
	})
	if err != nil || planned.Plan.Revision != 1 || planned.Plan.Approved() {
		t.Fatalf("plan = %+v, %v", planned.Plan, err)
	}
	if _, err := service.StartStep(task.ID, "a"); err == nil {
		t.Fatal("an unapproved plan must not run")
	}
	if _, err := service.ApprovePlan(task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartStep(task.ID, "b"); err == nil {
		t.Fatal("a step must wait for its dependencies")
	}

	// La verifica fallisce: lo step fallisce, anche se l'agente ha "finito".
	if _, err := service.StartStep(task.ID, "a"); err != nil {
		t.Fatal(err)
	}
	request := <-prompts
	if request.Attempt.StepID != "a" || !strings.Contains(request.Message, "return 404 for unknown ids") || !strings.Contains(request.Message, "handler.go") {
		t.Fatalf("step prompt = %s", request.Message)
	}
	failed := waitForStep(t, service, task.ID, "a", StepFailed)
	if len(failed.AttemptIDs) != 1 {
		t.Fatalf("attempt not linked to the step: %+v", failed)
	}
	verifier.mu.Lock()
	verifier.outcome = EvidencePassed
	verifier.mu.Unlock()
	if _, err := service.StartStep(task.ID, "a"); err != nil {
		t.Fatal(err)
	}
	<-prompts
	waitForStep(t, service, task.ID, "a", StepCompleted)

	// Lo step senza verifiche si chiude solo con una conferma esplicita, marcata come tale.
	if _, err := service.StartStep(task.ID, "b"); err != nil {
		t.Fatal(err)
	}
	<-prompts
	waitForStep(t, service, task.ID, "b", StepToVerify)
	if _, err := service.ConfirmStep(task.ID, "a"); err == nil {
		t.Fatal("a step with verifications cannot be confirmed by hand")
	}
	confirmed, err := service.ConfirmStep(task.ID, "b")
	if err != nil || !stepAt(confirmed.Plan, "b").ConfirmedWithoutVerification {
		t.Fatalf("confirmation = %+v, %v", stepAt(confirmed.Plan, "b"), err)
	}

	// Una nuova revisione richiede una nuova approvazione e conserva lo stato degli step invariati.
	revised, err := service.SetPlan(task.ID, []PlanStepDraft{
		{ID: "a", Title: "Add the handler", Goal: "return 404 for unknown ids", ExpectedFiles: []string{"handler.go"}, VerificationIDs: []string{verificationID}},
		{ID: "b", Title: "Document the handler", DependsOn: []string{"a"}},
	})
	if err != nil || revised.Plan.Approved() || revised.Plan.Revision != 2 || len(revised.Plan.Revisions) != 2 {
		t.Fatalf("revision = %+v, %v", revised.Plan, err)
	}
	if stepAt(revised.Plan, "a").Status != StepCompleted || stepAt(revised.Plan, "b").Status != StepTodo {
		t.Fatalf("step states after revision: %+v", revised.Plan.Steps)
	}
}

func TestRunningStepIsMarkedFailedAfterARestart(t *testing.T) {
	task := Task{Plan: &Plan{Steps: []PlanStep{{ID: "a", Status: StepRunning}, {ID: "b", Status: StepToVerify}}}}
	interruptSteps(&task, time.Now())
	if task.Plan.Steps[0].Status != StepFailed || !strings.Contains(task.Plan.Steps[0].Note, "restarted") {
		t.Fatalf("running step = %+v", task.Plan.Steps[0])
	}
	if task.Plan.Steps[1].Status != StepToVerify {
		t.Fatal("a step waiting for verification keeps its state")
	}
}

type blockingVerifier struct{ started chan struct{} }

func (verifier blockingVerifier) Run(ctx context.Context, _ VerifyRequest) Evidence {
	verifier.started <- struct{}{}
	<-ctx.Done()
	return Evidence{Outcome: EvidenceError, Log: "verification interrupted: " + ctx.Err().Error()}
}

func TestRevokingTrustStopsAgentsAndVerificationsOfTheProject(t *testing.T) {
	service, _ := newTestService(t)
	verifier := blockingVerifier{started: make(chan struct{}, 1)}
	service.SetVerifier(verifier)
	service.RegisterRuntime("fake", runtimeFunc(func(ctx context.Context, _ RunRequest, _ func(Event)) error {
		<-ctx.Done()
		return ctx.Err()
	}))
	root := t.TempDir()
	verifying, _ := service.Create(testDraft(root))
	if _, err := service.AddVerification(verifying.ID, VerificationDraft{Kind: VerificationTest, Packages: []string{"./..."}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartVerifications(verifying.ID, nil); err != nil {
		t.Fatal(err)
	}
	<-verifier.started
	running, _ := service.Create(testDraft(root))
	if _, err := service.Start(running.ID, "approved context", ContextReceipt{Bytes: 10}); err != nil {
		t.Fatal(err)
	}
	other, _ := service.Create(testDraft(t.TempDir()))

	stopped := service.StopForRoot(root)
	if len(stopped) != 2 {
		t.Fatalf("stopped = %v, want both tasks of the project", stopped)
	}
	waitForStatus(t, service, running.ID, StatusStopped)
	interrupted := waitForEvidence(t, service, verifying.ID, 1)
	if interrupted.Evidences[0].Outcome == EvidencePassed {
		t.Fatal("an interrupted verification must not pass")
	}
	if untouched, _ := service.Get(other.ID); untouched.Status != StatusDraft {
		t.Fatalf("a task of another project was touched: %s", untouched.Status)
	}
}

type committingProvider struct {
	fakeProvider
	messages []string
}

func (provider *committingProvider) PendingFiles(Workspace) ([]string, error) {
	return []string{"handler.go"}, nil
}

func (provider *committingProvider) Commit(_ Workspace, message string) (string, []string, error) {
	provider.messages = append(provider.messages, message)
	return "abcdef1234567890", []string{"handler.go"}, nil
}

func TestStepCommitRequiresACompletedStepWithSeparableChanges(t *testing.T) {
	service, _ := newTestService(t)
	provider := &committingProvider{}
	service.SetWorkspaceProvider(provider)
	task, _ := service.Create(testDraft(t.TempDir()))
	if _, err := service.CreateWorkspace(task.ID, "", false); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetPlan(task.ID, []PlanStepDraft{{ID: "a", Title: "Add the handler"}, {ID: "b", Title: "Wire the route", DependsOn: []string{"a"}}}); err != nil {
		t.Fatal(err)
	}
	set := func(change func(*Plan)) {
		service.mu.Lock()
		stored := service.tasks[task.ID]
		plan := clonePlan(stored.Plan)
		change(plan)
		stored.Plan = plan
		service.tasks[task.ID] = stored
		service.mu.Unlock()
	}
	set(func(plan *Plan) { plan.Steps[0].Status, plan.Steps[0].AttemptIDs = StepToVerify, []string{"x"} })
	if _, err := service.PreviewStepCommit(task.ID, "a"); err == nil {
		t.Fatal("a step that is not completed cannot be committed")
	}
	set(func(plan *Plan) {
		plan.Steps[0].Status, plan.Steps[0].ConfirmedWithoutVerification = StepCompleted, true
		plan.Steps[1].Status, plan.Steps[1].AttemptIDs = StepFailed, []string{"y"}
	})
	if _, err := service.PreviewStepCommit(task.ID, "a"); err == nil || !strings.Contains(err.Error(), "Wire the route") {
		t.Fatalf("mixed changes must be refused, got %v", err)
	}
	set(func(plan *Plan) { plan.Steps[1].AttemptIDs = nil })
	preview, err := service.PreviewStepCommit(task.ID, "a")
	if err != nil || len(preview.Files) != 1 || !strings.Contains(preview.Message, "without verification") {
		t.Fatalf("preview = %+v, %v", preview, err)
	}
	committed, err := service.CommitStep(task.ID, "a")
	if err != nil || stepAt(committed.Plan, "a").CommitSHA == "" {
		t.Fatalf("commit = %+v, %v", stepAt(committed.Plan, "a"), err)
	}
	if _, err := service.CommitStep(task.ID, "a"); err == nil {
		t.Fatal("a step is committed once")
	}
}

func TestScenarioCriteriaBecomeLinkedVerifications(t *testing.T) {
	service, _ := newTestService(t)
	task, _ := service.Create(testDraft(t.TempDir()))
	scenario := acceptance.Scenario{ID: "orders-404", Title: "Unknown order", Criteria: []acceptance.Criterion{
		{ID: "c1", Text: "Unknown ids return 404", Check: &acceptance.Check{Kind: "request", Method: "GET", URL: "http://localhost:8080/orders/x", ExpectedStatus: 404, Headers: map[string]string{"B": "2", "A": "1"}}},
		{ID: "c2", Text: "Documented in the README"},
	}}
	updated, err := service.AddScenario(task.ID, scenario)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Verifications) != 1 {
		t.Fatalf("only executable criteria become verifications: %+v", updated.Verifications)
	}
	verification := updated.Verifications[0]
	if verification.ScenarioID != "orders-404" || verification.CriterionID != "c1" || verification.ExpectedStatus != 404 || verification.Headers[0].Name != "A" {
		t.Fatalf("verification = %+v", verification)
	}
	if _, err := service.AddScenario(task.ID, scenario); err == nil {
		t.Fatal("adding the same scenario twice must not duplicate verifications")
	}
	if len(updated.Scenarios) != 1 || len(updated.Scenarios[0].Criteria) != 2 {
		t.Fatalf("scenario not kept for the prompts: %+v", updated.Scenarios)
	}
	if message := scenariosMessage(updated.Scenarios); !strings.Contains(message, "orders-404") || !strings.Contains(message, "Documented in the README") {
		t.Fatalf("scenario context = %s", message)
	}
}

func TestPullRequestDraftStatesWhatWasAndWasNotVerified(t *testing.T) {
	task := Task{
		Objective: "Return 404 for unknown orders\nmore detail", Criteria: []string{"unknown ids answer 404"},
		Workspace: &Workspace{Branch: "adomnia/abc", BaseSHA: "0123456789abcdef"},
		Plan:      &Plan{Steps: []PlanStep{{Title: "Handler", Status: StepCompleted}, {Title: "Docs", Status: StepCompleted, ConfirmedWithoutVerification: true}, {Title: "Metrics", Status: StepFailed}}},
		Verifications: []Verification{
			{ID: "v1", Label: "orders 404", ScenarioID: "orders-404", CriterionID: "c1"},
			{ID: "v2", Label: "unit tests"},
			{ID: "v3", Label: "page"},
		},
		Evidences: []Evidence{
			{VerificationID: "v1", Outcome: EvidenceFailed, Command: "GET /orders/x"},
			{VerificationID: "v1", Outcome: EvidencePassed, Command: "GET /orders/x"},
			{VerificationID: "v2", Outcome: EvidenceFailed, Command: "go test ./..."},
		},
	}
	draft := prDraft(task)
	for _, want := range []string{
		"✅ orders 404 (scenario orders-404, criterion c1)", "❌ unit tests", "(failed)",
		"Not verified:\n- page", "- [x] Docs — confirmed by the author without verification", "- [ ] Metrics — failed",
		"branch `adomnia/abc` (started at `01234567`)",
	} {
		if !strings.Contains(draft.Body, want) {
			t.Errorf("draft body misses %q:\n%s", want, draft.Body)
		}
	}
	if draft.Title != "Return 404 for unknown orders" {
		t.Fatalf("title = %q", draft.Title)
	}
}
