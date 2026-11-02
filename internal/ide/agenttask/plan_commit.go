package agenttask

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// WorkspaceCommitter commits on the task's own branch, inside its isolated workspace.
// It is an optional capability of the WorkspaceProvider, implemented by the host with Git.
type WorkspaceCommitter interface {
	PendingFiles(Workspace) ([]string, error)
	Commit(workspace Workspace, message string) (string, []string, error)
}

// StepCommitPreview is what committing a step would record: shown before the commit.
type StepCommitPreview struct {
	Message string   `json:"message"`
	Files   []string `json:"files"`
	Branch  string   `json:"branch"`
}

// PreviewStepCommit returns the files and message a step commit would contain, or why
// the step's changes cannot be committed on their own.
func (service *Service) PreviewStepCommit(id, stepID string) (StepCommitPreview, error) {
	workspace, step, committer, message, err := service.stepCommitTarget(id, stepID)
	if err != nil {
		return StepCommitPreview{}, err
	}
	files, err := committer.PendingFiles(workspace)
	if err != nil {
		return StepCommitPreview{}, err
	}
	if len(files) == 0 {
		return StepCommitPreview{}, fmt.Errorf("step %q left no changes to commit", step.Title)
	}
	return StepCommitPreview{Message: message, Files: files, Branch: workspace.Branch}, nil
}

// CommitStep commits the workspace changes of a completed step on the task branch.
// The project branch is not touched: integration stays an explicit, separate action.
func (service *Service) CommitStep(id, stepID string) (Task, error) {
	workspace, _, committer, message, err := service.stepCommitTarget(id, stepID)
	if err != nil {
		return Task{}, err
	}
	sha, files, err := committer.Commit(workspace, message)
	if err != nil {
		return Task{}, err
	}
	return service.updateTask(id, func(task *Task, now time.Time) error {
		plan := clonePlan(task.Plan)
		step := stepAt(plan, stepID)
		if step == nil {
			return fmt.Errorf("the step was removed after commit %s", shortSHA(sha))
		}
		step.CommitSHA, step.CommittedFiles, step.UpdatedAt = sha, files, now
		task.Plan = plan
		return nil
	})
}

func (service *Service) stepCommitTarget(id, stepID string) (Workspace, PlanStep, WorkspaceCommitter, string, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return Workspace{}, PlanStep{}, nil, "", errors.New("agent task not found")
	}
	if task.Active() || len(task.VerifyingIDs) > 0 {
		return Workspace{}, PlanStep{}, nil, "", errors.New("wait for the agent and the verifications to finish")
	}
	if task.Workspace == nil || task.Workspace.State != WorkspaceReady {
		return Workspace{}, PlanStep{}, nil, "", errors.New("steps are committed on the task branch: create an isolated workspace first")
	}
	committer, ok := service.workspaces.(WorkspaceCommitter)
	if !ok {
		return Workspace{}, PlanStep{}, nil, "", errors.New("step commits are not available")
	}
	step := stepAt(task.Plan, stepID)
	if step == nil {
		return Workspace{}, PlanStep{}, nil, "", errors.New("step not found")
	}
	if step.Status != StepCompleted {
		return Workspace{}, PlanStep{}, nil, "", errors.New("only a completed step can be committed")
	}
	if step.CommitSHA != "" {
		return Workspace{}, PlanStep{}, nil, "", fmt.Errorf("this step is already committed as %s", shortSHA(step.CommitSHA))
	}
	// Le modifiche sono attribuibili allo step solo se ogni altro step che ha lavorato nel
	// workspace è già stato committato: altrimenti i file pendenti mescolano più step.
	var mixed []string
	for _, other := range task.Plan.Steps {
		if other.ID != stepID && len(other.AttemptIDs) > 0 && other.CommitSHA == "" {
			mixed = append(mixed, other.Title)
		}
	}
	if len(mixed) > 0 {
		return Workspace{}, PlanStep{}, nil, "", fmt.Errorf("the pending changes also belong to %s; commit or discard those first", strings.Join(mixed, ", "))
	}
	return *task.Workspace, *step, committer, stepCommitMessage(task, *step), nil
}

func stepCommitMessage(task Task, step PlanStep) string {
	var builder strings.Builder
	builder.WriteString(step.Title)
	builder.WriteString("\n\n")
	objective, _, _ := strings.Cut(strings.TrimSpace(task.Objective), "\n")
	fmt.Fprintf(&builder, "adOmnia task: %s\n", objective)
	if step.ConfirmedWithoutVerification {
		builder.WriteString("Step confirmed by the user without verification.\n")
	} else {
		fmt.Fprintf(&builder, "Step completed: %d verification(s) passed.\n", len(step.VerificationIDs))
	}
	return builder.String()
}

func shortSHA(sha string) string {
	if len(sha) > 8 {
		return sha[:8]
	}
	return sha
}
