package agenttask

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

// StepStatus is the explicit state of a plan step. A step reaches "completed" only
// through its verifications or an explicit user confirmation, never because the agent says so.
type StepStatus string

const (
	StepTodo      StepStatus = "todo"
	StepRunning   StepStatus = "running"
	StepToVerify  StepStatus = "to_verify"
	StepCompleted StepStatus = "completed"
	StepFailed    StepStatus = "failed"
	StepCancelled StepStatus = "cancelled"
)

// PlanStep is one step of a task plan.
type PlanStep struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	Goal            string     `json:"goal,omitempty"`
	DependsOn       []string   `json:"dependsOn,omitempty"`
	ExpectedFiles   []string   `json:"expectedFiles,omitempty"`
	VerificationIDs []string   `json:"verificationIds,omitempty"`
	Status          StepStatus `json:"status"`
	// ConfirmedWithoutVerification marks a step completed by the user because it has no verification.
	ConfirmedWithoutVerification bool     `json:"confirmedWithoutVerification,omitempty"`
	AttemptIDs                   []string `json:"attemptIds,omitempty"`
	// CommitSHA is the commit of this step on the task branch, once the user committed it.
	CommitSHA      string    `json:"commitSha,omitempty"`
	CommittedFiles []string  `json:"committedFiles,omitempty"`
	Note           string    `json:"note,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// PlanStepDraft is a step as edited by the user. An empty ID creates a new step.
type PlanStepDraft struct {
	ID              string   `json:"id,omitempty"`
	Title           string   `json:"title"`
	Goal            string   `json:"goal,omitempty"`
	DependsOn       []string `json:"dependsOn,omitempty"`
	ExpectedFiles   []string `json:"expectedFiles,omitempty"`
	VerificationIDs []string `json:"verificationIds,omitempty"`
}

// PlanRevision is a saved version of the plan's content (without execution state).
type PlanRevision struct {
	Revision int             `json:"revision"`
	Steps    []PlanStepDraft `json:"steps"`
	At       time.Time       `json:"at"`
}

// Plan is the persistent, approvable plan of a task.
type Plan struct {
	Steps            []PlanStep     `json:"steps"`
	Revision         int            `json:"revision"`
	ApprovedRevision int            `json:"approvedRevision,omitempty"`
	ApprovedAt       *time.Time     `json:"approvedAt,omitempty"`
	Revisions        []PlanRevision `json:"revisions,omitempty"`
}

// Approved reports whether the current revision is the approved one.
func (plan *Plan) Approved() bool {
	return plan != nil && plan.Revision > 0 && plan.ApprovedRevision == plan.Revision
}

const (
	maxPlanSteps     = 40
	maxPlanRevisions = 20
	maxStepText      = 2 * 1024
)

func clonePlan(plan *Plan) *Plan {
	if plan == nil {
		return nil
	}
	clone := *plan
	clone.Steps = make([]PlanStep, len(plan.Steps))
	for index, step := range plan.Steps {
		clone.Steps[index] = step
		clone.Steps[index].DependsOn = slices.Clone(step.DependsOn)
		clone.Steps[index].ExpectedFiles = slices.Clone(step.ExpectedFiles)
		clone.Steps[index].VerificationIDs = slices.Clone(step.VerificationIDs)
		clone.Steps[index].AttemptIDs = slices.Clone(step.AttemptIDs)
		clone.Steps[index].CommittedFiles = slices.Clone(step.CommittedFiles)
	}
	clone.Revisions = slices.Clone(plan.Revisions)
	if plan.ApprovedAt != nil {
		at := *plan.ApprovedAt
		clone.ApprovedAt = &at
	}
	return &clone
}

func normalizeStepDrafts(task Task, drafts []PlanStepDraft) ([]PlanStepDraft, error) {
	if len(drafts) == 0 {
		return nil, errors.New("a plan needs at least one step")
	}
	if len(drafts) > maxPlanSteps {
		return nil, fmt.Errorf("a plan can have at most %d steps", maxPlanSteps)
	}
	known := map[string]bool{}
	for _, verification := range task.Verifications {
		known[verification.ID] = true
	}
	ids := map[string]bool{}
	normalized := make([]PlanStepDraft, len(drafts))
	for index, draft := range drafts {
		draft.ID = strings.TrimSpace(draft.ID)
		if draft.ID == "" {
			draft.ID = newID("step")
		}
		if ids[draft.ID] {
			return nil, fmt.Errorf("step %s appears twice", draft.ID)
		}
		ids[draft.ID] = true
		draft.Title = strings.TrimSpace(draft.Title)
		if draft.Title == "" {
			return nil, fmt.Errorf("step %d needs a title", index+1)
		}
		if len(draft.Title) > 200 || len(draft.Goal) > maxStepText {
			return nil, fmt.Errorf("step %d is too long", index+1)
		}
		draft.Goal = strings.TrimSpace(draft.Goal)
		var err error
		if draft.ExpectedFiles, err = cleanList(draft.ExpectedFiles, true); err != nil {
			return nil, fmt.Errorf("step %d: %w", index+1, err)
		}
		for _, verificationID := range draft.VerificationIDs {
			if !known[verificationID] {
				return nil, fmt.Errorf("step %d refers to a verification that no longer exists", index+1)
			}
		}
		draft.VerificationIDs = slices.Compact(slices.Sorted(slices.Values(draft.VerificationIDs)))
		normalized[index] = draft
	}
	// Una dipendenza può puntare solo a uno step precedente: niente cicli, ordine leggibile.
	for index, draft := range normalized {
		for _, dependency := range draft.DependsOn {
			position := slices.IndexFunc(normalized, func(candidate PlanStepDraft) bool { return candidate.ID == dependency })
			if position < 0 || position >= index {
				return nil, fmt.Errorf("step %q can only depend on steps that come before it", draft.Title)
			}
		}
	}
	return normalized, nil
}

// SetPlan saves a new revision of the plan. The plan must be approved again; steps
// that keep their ID and content keep their execution state.
func (service *Service) SetPlan(id string, drafts []PlanStepDraft) (Task, error) {
	return service.updateTask(id, func(task *Task, now time.Time) error {
		if task.Active() {
			return errors.New("stop the task before changing its plan")
		}
		normalized, err := normalizeStepDrafts(*task, drafts)
		if err != nil {
			return err
		}
		plan := clonePlan(task.Plan)
		if plan == nil {
			plan = &Plan{}
		}
		previous := map[string]PlanStep{}
		for _, step := range plan.Steps {
			previous[step.ID] = step
		}
		steps := make([]PlanStep, len(normalized))
		for index, draft := range normalized {
			step := PlanStep{
				ID: draft.ID, Title: draft.Title, Goal: draft.Goal, DependsOn: draft.DependsOn,
				ExpectedFiles: draft.ExpectedFiles, VerificationIDs: draft.VerificationIDs,
				Status: StepTodo, UpdatedAt: now,
			}
			if old, ok := previous[draft.ID]; ok {
				// Tentativi e commit sono fatti avvenuti: restano anche se il testo dello step cambia.
				step.AttemptIDs, step.CommitSHA, step.CommittedFiles = old.AttemptIDs, old.CommitSHA, old.CommittedFiles
				if sameStepContent(old, step) {
					step.Status, step.ConfirmedWithoutVerification, step.Note, step.UpdatedAt = old.Status, old.ConfirmedWithoutVerification, old.Note, old.UpdatedAt
				}
			}
			steps[index] = step
		}
		plan.Steps = steps
		plan.Revision++
		plan.ApprovedRevision, plan.ApprovedAt = 0, nil
		plan.Revisions = append(plan.Revisions, PlanRevision{Revision: plan.Revision, Steps: normalized, At: now})
		if len(plan.Revisions) > maxPlanRevisions {
			plan.Revisions = slices.Clone(plan.Revisions[len(plan.Revisions)-maxPlanRevisions:])
		}
		task.Plan = plan
		return nil
	})
}

func sameStepContent(left, right PlanStep) bool {
	return left.Title == right.Title && left.Goal == right.Goal &&
		slices.Equal(left.DependsOn, right.DependsOn) && slices.Equal(left.ExpectedFiles, right.ExpectedFiles) &&
		slices.Equal(left.VerificationIDs, right.VerificationIDs)
}

// ApprovePlan approves the current revision: steps can run only after this.
func (service *Service) ApprovePlan(id string) (Task, error) {
	return service.updateTask(id, func(task *Task, now time.Time) error {
		if task.Plan == nil || len(task.Plan.Steps) == 0 {
			return errors.New("this task has no plan to approve")
		}
		plan := clonePlan(task.Plan)
		plan.ApprovedRevision, plan.ApprovedAt = plan.Revision, &now
		task.Plan = plan
		return nil
	})
}

// ConfirmStep completes a step that has no verification, by explicit user decision.
func (service *Service) ConfirmStep(id, stepID string) (Task, error) {
	return service.updateTask(id, func(task *Task, now time.Time) error {
		plan := clonePlan(task.Plan)
		step := stepAt(plan, stepID)
		if step == nil {
			return errors.New("step not found")
		}
		if len(step.VerificationIDs) > 0 {
			return errors.New("this step is completed by its verifications, not by a confirmation")
		}
		if step.Status != StepToVerify {
			return errors.New("run the step before confirming it")
		}
		step.Status, step.ConfirmedWithoutVerification, step.UpdatedAt = StepCompleted, true, now
		step.Note = "completed by user confirmation: no verification was run"
		task.Plan = plan
		return nil
	})
}

// StepPrompt is the exact text sent to the agent for a step: the user approves it before the start.
func (service *Service) StepPrompt(id, stepID string) (string, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return "", errors.New("agent task not found")
	}
	_, prompt, err := stepStartCheck(task, stepID)
	return prompt, err
}

// StartStep runs the agent on one approved plan step. When it finishes, the step's
// verifications run on the new content and decide whether the step is completed.
func (service *Service) StartStep(id, stepID string) (Task, error) {
	service.mu.Lock()
	task, ok := service.tasks[id]
	if !ok {
		service.mu.Unlock()
		return Task{}, errors.New("agent task not found")
	}
	step, prompt, err := stepStartCheck(task, stepID)
	if err != nil {
		service.mu.Unlock()
		return Task{}, err
	}
	service.mu.Unlock()
	// Il prompt dello step è solo testo: nessun file viene allegato, l'agente legge il workspace.
	receipt := ContextReceipt{Bytes: len(prompt)}
	return service.start(id, prompt, receipt, startOptions{stepID: step.ID, autoVerify: step.VerificationIDs})
}

func stepStartCheck(task Task, stepID string) (PlanStep, string, error) {
	if !task.Plan.Approved() {
		return PlanStep{}, "", errors.New("approve the current plan before running its steps")
	}
	step := stepAt(task.Plan, stepID)
	if step == nil {
		return PlanStep{}, "", errors.New("step not found")
	}
	if step.Status == StepCompleted || step.Status == StepRunning {
		return PlanStep{}, "", fmt.Errorf("step %q is %s", step.Title, step.Status)
	}
	for _, dependency := range step.DependsOn {
		if other := stepAt(task.Plan, dependency); other == nil || other.Status != StepCompleted {
			return PlanStep{}, "", fmt.Errorf("step %q waits for the steps it depends on", step.Title)
		}
	}
	prompt, _ := boundText(stepMessage(task, *step), task.Limits.MaxContextBytes)
	return *step, prompt, nil
}

func stepMessage(task Task, step PlanStep) string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "You are working on one step of an approved plan.\n\nTask objective:\n%s\n", task.Objective)
	if len(task.Criteria) > 0 {
		builder.WriteString("Task completion criteria:\n")
		for _, criterion := range task.Criteria {
			fmt.Fprintf(&builder, "- %s\n", criterion)
		}
	}
	builder.WriteString("\nSteps already completed:\n")
	completed := 0
	for _, other := range task.Plan.Steps {
		if other.Status == StepCompleted {
			fmt.Fprintf(&builder, "- %s\n", other.Title)
			completed++
		}
	}
	if completed == 0 {
		builder.WriteString("- none\n")
	}
	fmt.Fprintf(&builder, "\nCurrent step: %s\n", step.Title)
	if step.Goal != "" {
		fmt.Fprintf(&builder, "Goal:\n%s\n", step.Goal)
	}
	if len(step.ExpectedFiles) > 0 {
		builder.WriteString("Files expected to change:\n")
		for _, file := range step.ExpectedFiles {
			fmt.Fprintf(&builder, "- %s\n", file)
		}
	}
	builder.WriteString(scenariosMessage(task.Scenarios))
	builder.WriteString("\nDo only this step. ")
	if len(step.VerificationIDs) > 0 {
		builder.WriteString("adOmnia will run the step's verifications when you finish: a claim in your reply does not complete the step.\n")
	} else {
		builder.WriteString("The user will review the result before the step is considered done.\n")
	}
	return builder.String()
}

func stepAt(plan *Plan, stepID string) *PlanStep {
	if plan == nil {
		return nil
	}
	for index := range plan.Steps {
		if plan.Steps[index].ID == stepID {
			return &plan.Steps[index]
		}
	}
	return nil
}

// stepStarted marks the step running and links the attempt to it.
func stepStarted(task *Task, stepID, attemptID string, now time.Time) {
	plan := clonePlan(task.Plan)
	if step := stepAt(plan, stepID); step != nil {
		step.Status, step.Note, step.UpdatedAt = StepRunning, "", now
		step.AttemptIDs = append(step.AttemptIDs, attemptID)
		task.Plan = plan
	}
}

// stepFinished moves the step after its attempt: to verify on success, failed or
// cancelled otherwise. The step's verifications are re-run by the attempt's auto-verify.
func stepFinished(task *Task, stepID string, status Status, now time.Time) {
	plan := clonePlan(task.Plan)
	step := stepAt(plan, stepID)
	if step == nil {
		return
	}
	switch status {
	case StatusCompleted:
		step.Status = StepToVerify
	case StatusStopped:
		step.Status, step.Note = StepCancelled, "stopped by the user"
	default:
		step.Status, step.Note = StepFailed, "the agent attempt did not complete"
	}
	step.UpdatedAt = now
	task.Plan = plan
}

// evaluateSteps decides steps waiting for verification once every verification of the
// step has evidence measured after its last attempt: all passed → completed, otherwise failed.
func evaluateSteps(task *Task, now time.Time) {
	if task.Plan == nil {
		return
	}
	plan := clonePlan(task.Plan)
	changed := false
	for index := range plan.Steps {
		step := &plan.Steps[index]
		if step.Status != StepToVerify || len(step.VerificationIDs) == 0 || len(step.AttemptIDs) == 0 {
			continue
		}
		attemptID := step.AttemptIDs[len(step.AttemptIDs)-1]
		allPassed, complete := true, true
		for _, verificationID := range step.VerificationIDs {
			outcome, found := latestOutcome(task.Evidences, verificationID, attemptID)
			if !found {
				complete = false
				break
			}
			allPassed = allPassed && outcome == EvidencePassed
		}
		if !complete {
			continue
		}
		step.Status, step.UpdatedAt = StepCompleted, now
		step.Note = "all step verifications passed"
		if !allPassed {
			step.Status, step.Note = StepFailed, "a step verification did not pass"
		}
		changed = true
	}
	if changed {
		task.Plan = plan
	}
}

func latestOutcome(evidences []Evidence, verificationID, attemptID string) (EvidenceOutcome, bool) {
	for _, evidence := range slices.Backward(evidences) {
		if evidence.VerificationID == verificationID && evidence.AttemptID == attemptID {
			return evidence.Outcome, true
		}
	}
	return "", false
}

// interruptSteps marks running steps as failed after a restart: nothing is re-run on its own.
func interruptSteps(task *Task, now time.Time) {
	if task.Plan == nil {
		return
	}
	plan := clonePlan(task.Plan)
	for index := range plan.Steps {
		if plan.Steps[index].Status == StepRunning {
			plan.Steps[index].Status, plan.Steps[index].UpdatedAt = StepFailed, now
			plan.Steps[index].Note = "adOmnia restarted while this step was running; run it again explicitly"
		}
	}
	task.Plan = plan
}
