package agenttask

import (
	"errors"
	"slices"
	"time"
)

// WorkspaceComparison describes what integrating a task workspace would mean: what the
// agent changed since the starting commit and what happened meanwhile on the project
// branch that would receive it.
type WorkspaceComparison struct {
	// Fingerprint identifies the workspace content: evidence with the same fingerprint
	// measured exactly what would be integrated.
	Fingerprint  string   `json:"fingerprint"`
	ChangedFiles []string `json:"changedFiles"`
	TargetBranch string   `json:"targetBranch"`
	TargetHead   string   `json:"targetHead"`
	// TargetCommits counts the commits the target received after the workspace started.
	TargetCommits int      `json:"targetCommits"`
	TargetChanged []string `json:"targetChanged"`
	LocalChanges  []string `json:"localChanges"`
	// Overlaps are workspace files the target also changed after the start: likely conflicts.
	Overlaps []string `json:"overlaps"`
	// LocalOverlaps are workspace files with uncommitted changes in the project.
	LocalOverlaps []string `json:"localOverlaps"`
}

// Integration records the application of a workspace to the project. Nothing is
// committed: the changes are staged in the project and the user decides what follows.
type Integration struct {
	Applied      bool      `json:"applied"`
	Checked      bool      `json:"checked"`
	TargetBranch string    `json:"targetBranch"`
	TargetHead   string    `json:"targetHead"`
	Fingerprint  string    `json:"fingerprint"`
	Files        []string  `json:"files"`
	Conflicts    []string  `json:"conflicts"`
	Output       string    `json:"output,omitempty"`
	At           time.Time `json:"at"`
}

// WorkspaceIntegrator compares a workspace with its target and applies it. It is an
// optional capability of the WorkspaceProvider, implemented by the host with Git.
type WorkspaceIntegrator interface {
	Compare(Workspace) (WorkspaceComparison, error)
	Integrate(workspace Workspace, check bool) (Integration, error)
}

// CompareWorkspace reads the comparison without changing anything.
func (service *Service) CompareWorkspace(id string) (WorkspaceComparison, error) {
	workspace, integrator, err := service.integrationTarget(id)
	if err != nil {
		return WorkspaceComparison{}, err
	}
	comparison, err := integrator.Compare(workspace)
	if err != nil {
		return WorkspaceComparison{}, err
	}
	comparison.Overlaps = intersect(comparison.ChangedFiles, comparison.TargetChanged)
	comparison.LocalOverlaps = intersect(comparison.ChangedFiles, comparison.LocalChanges)
	return comparison, nil
}

// IntegrateWorkspace applies the workspace to the project (check = dry run). A real
// integration is recorded on the task, conflicts included; a check is only returned.
func (service *Service) IntegrateWorkspace(id string, check bool) (Integration, error) {
	workspace, integrator, err := service.integrationTarget(id)
	if err != nil {
		return Integration{}, err
	}
	integration, err := integrator.Integrate(workspace, check)
	if err != nil {
		return Integration{}, err
	}
	integration.Checked = check
	integration.At = service.now().UTC()
	if check {
		return integration, nil
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok || task.Workspace == nil {
		// Il task è sparito mentre Git applicava la patch: le modifiche restano nel progetto.
		return integration, nil
	}
	updated := *task.Workspace
	updated.Integration = integration
	task.Workspace = &updated
	task.UpdatedAt = integration.At
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		service.reportPersistenceErrorLocked(&task, err)
	}
	service.publishLocked(task)
	return integration, nil
}

func (service *Service) integrationTarget(id string) (Workspace, WorkspaceIntegrator, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return Workspace{}, nil, errors.New("agent task not found")
	}
	if task.Active() || len(task.VerifyingIDs) > 0 {
		return Workspace{}, nil, errors.New("wait for the agent and the verifications to finish")
	}
	if task.Workspace == nil || task.Workspace.State != WorkspaceReady {
		return Workspace{}, nil, errors.New("this task has no isolated workspace to integrate")
	}
	integrator, ok := service.workspaces.(WorkspaceIntegrator)
	if !ok {
		return Workspace{}, nil, errors.New("workspace integration is not available")
	}
	return *task.Workspace, integrator, nil
}

func intersect(left, right []string) []string {
	shared := []string{}
	for _, item := range left {
		if slices.Contains(right, item) {
			shared = append(shared, item)
		}
	}
	return shared
}
