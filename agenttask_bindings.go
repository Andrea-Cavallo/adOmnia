package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/codestudio"
	"github.com/Andrea-Cavallo/adOmnia/internal/devlog"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/acceptance"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type AgentTasks struct {
	// evidenceDir holds evidence files (page screenshots); EvidenceImage reads only from it.
	evidenceDir string
	service     *agenttask.Service
	initErr     error
	// trusted verifies that the user authorized tooling in the project. Agent tasks
	// create worktrees and run processes, so they inherit the same trust as Code Studio.
	trusted func(string) bool
}

func NewAgentTasks(milkManager, claudeManager *milk.Manager, piManagers ...*milk.Manager) *AgentTasks {
	store := agenttask.NewFileStore(filepath.Join(dataDir(), "code-studio", "agent-tasks.json"))
	service, err := agenttask.NewService(store)
	if err == nil {
		service.RegisterRuntime("milk", codestudio.NewAgentTaskRuntime(map[string]*milk.Manager{"milk": milkManager}))
		service.RegisterRuntime("claude", codestudio.NewAgentTaskRuntime(map[string]*milk.Manager{"claude": claudeManager}))
		if len(piManagers) > 0 {
			service.RegisterRuntime("pi", codestudio.NewAgentTaskRuntime(map[string]*milk.Manager{"pi": piManagers[0]}))
		}
	}
	return &AgentTasks{service: service, initErr: err}
}

// configure wires isolated workspaces, verification and project trust into the task service.
// It is called once at startup, after the Code Studio service exists. It stays unexported
// so it is not part of the Wails contract: a verifier is not JSON-encodable state.
func (tasks *AgentTasks) configure(workspaceRoot string, ide *codestudio.Service) {
	tasks.trusted = ide.Trusted
	// Un worktree di un task aperto in Code Studio eredita la fiducia del suo progetto.
	ide.SetAgentWorktreeRoot(workspaceRoot)
	if tasks.service == nil {
		return
	}
	tasks.service.SetWorkspaceProvider(codestudio.NewGitWorkspaceProvider(workspaceRoot))
	// Gli screenshot delle verifiche restano accanto ai worktree, fuori dal progetto.
	tasks.evidenceDir = filepath.Join(filepath.Dir(workspaceRoot), "evidence")
	tasks.service.SetVerifier(ide.AgentTaskVerifier(tasks.evidenceDir))
	// Revocare la fiducia ferma agenti, verifiche e servizi avviati dai task del progetto
	// e invalida le regole di permesso decise per quel progetto.
	service := tasks.service
	ide.OnTrustRevoked(func(root string) {
		service.StopForRoot(root)
		if err := projectPermissions().Forget(root); err != nil {
			devlog.Err("agentTasks", "project permission rules not cleared", err, nil)
		}
	})
	// Le associazioni salvate vengono confrontate con git worktree list al riavvio.
	tasks.service.ReconcileWorkspaces()
}

func (tasks *AgentTasks) ready() (*agenttask.Service, error) {
	if tasks.initErr != nil {
		return nil, tasks.initErr
	}
	if tasks.service == nil {
		return nil, errors.New("agent task service is not available")
	}
	return tasks.service, nil
}

func (tasks *AgentTasks) requireTrust(root string) error {
	if tasks.trusted == nil || strings.TrimSpace(root) == "" {
		return nil
	}
	if !tasks.trusted(filepath.Clean(root)) {
		return errors.New("this project is not trusted: authorize tooling in Code Studio before running an agent task")
	}
	return nil
}

func (tasks *AgentTasks) requireTaskTrust(id string) error {
	service, err := tasks.ready()
	if err != nil {
		return err
	}
	task, err := service.Get(id)
	if err != nil {
		return err
	}
	return tasks.requireTrust(task.Root)
}

func (tasks *AgentTasks) attachDesktop(desktop *application.App) {
	if tasks.service != nil {
		tasks.service.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
	}
}

func (tasks *AgentTasks) ServiceShutdown() error {
	if tasks.service == nil {
		return nil
	}
	return tasks.service.Shutdown()
}

func (tasks *AgentTasks) List(root string) ([]agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return nil, err
	}
	return service.List(root), nil
}

func (tasks *AgentTasks) Get(id string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.Get(id)
}

func (tasks *AgentTasks) Create(draft agenttask.Draft) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTrust(draft.Root); err != nil {
		return agenttask.Task{}, err
	}
	return service.Create(draft)
}

func (tasks *AgentTasks) Update(id string, draft agenttask.Draft) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTrust(draft.Root); err != nil {
		return agenttask.Task{}, err
	}
	return service.Update(id, draft)
}

func (tasks *AgentTasks) Start(id, message string, receipt agenttask.ContextReceipt) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.Task{}, err
	}
	return service.Start(id, message, receipt)
}

func (tasks *AgentTasks) Stop(id string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.Stop(id)
}

func (tasks *AgentTasks) Export(id string) (string, error) {
	service, err := tasks.ready()
	if err != nil {
		return "", err
	}
	return service.Export(id)
}

// --- Isolated workspace (AGI-01, first increment) ---

func (tasks *AgentTasks) CreateWorkspace(id, baseRef string, includeLocalChanges bool) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.Task{}, err
	}
	return service.CreateWorkspace(id, baseRef, includeLocalChanges)
}

// CompareWorkspace shows what integrating the task workspace would change.
func (tasks *AgentTasks) CompareWorkspace(id string) (agenttask.WorkspaceComparison, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.WorkspaceComparison{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.WorkspaceComparison{}, err
	}
	return service.CompareWorkspace(id)
}

// IntegrateWorkspace applies the task workspace to the project (check = dry run).
func (tasks *AgentTasks) IntegrateWorkspace(id string, check bool) (agenttask.Integration, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Integration{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.Integration{}, err
	}
	return service.IntegrateWorkspace(id, check)
}

func (tasks *AgentTasks) RemoveWorkspace(id string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.RemoveWorkspace(id)
}

func (tasks *AgentTasks) ReconcileWorkspaces() ([]agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return nil, err
	}
	return service.ReconcileWorkspaces(), nil
}

// --- Verifications and evidence (AGI-02, first increment) ---

func (tasks *AgentTasks) AddVerification(id string, draft agenttask.VerificationDraft) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.AddVerification(id, draft)
}

func (tasks *AgentTasks) RemoveVerification(id, verificationID string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.RemoveVerification(id, verificationID)
}

func (tasks *AgentTasks) StartVerifications(id string, verificationIDs []string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.Task{}, err
	}
	return service.StartVerifications(id, verificationIDs)
}

// --- Correction (AGI-03, first increment) ---

func (tasks *AgentTasks) StartCorrection(id string, evidenceIDs, commentIDs []string, note string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.Task{}, err
	}
	return service.StartCorrection(id, evidenceIDs, commentIDs, note)
}

// AddComment stores a review comment on a changed line range or on an evidence.
func (tasks *AgentTasks) AddComment(id string, draft agenttask.ReviewCommentDraft) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.AddComment(id, draft)
}

// SetCommentStatus resolves a comment or reopens it.
func (tasks *AgentTasks) SetCommentStatus(id, commentID string, resolved bool) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.SetCommentStatus(id, commentID, resolved)
}

// RemoveComment deletes a comment that is not part of a running correction.
func (tasks *AgentTasks) RemoveComment(id, commentID string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.RemoveComment(id, commentID)
}

// --- Plan with verified steps (AGI-04) ---

// SetPlan saves a new revision of the task plan; it must be approved again.
func (tasks *AgentTasks) SetPlan(id string, steps []agenttask.PlanStepDraft) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.SetPlan(id, steps)
}

// ApprovePlan approves the current plan revision.
func (tasks *AgentTasks) ApprovePlan(id string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.ApprovePlan(id)
}

// StepPrompt returns the exact text a step sends to the agent, for the user to approve.
func (tasks *AgentTasks) StepPrompt(id, stepID string) (string, error) {
	service, err := tasks.ready()
	if err != nil {
		return "", err
	}
	return service.StepPrompt(id, stepID)
}

// StartStep runs the agent on one approved step; its verifications decide the outcome.
func (tasks *AgentTasks) StartStep(id, stepID string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.Task{}, err
	}
	return service.StartStep(id, stepID)
}

// ConfirmStep completes a step without verifications by explicit user decision.
func (tasks *AgentTasks) ConfirmStep(id, stepID string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.ConfirmStep(id, stepID)
}

// PreviewStepCommit shows the files and message a step commit would record on the task branch.
func (tasks *AgentTasks) PreviewStepCommit(id, stepID string) (agenttask.StepCommitPreview, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.StepCommitPreview{}, err
	}
	return service.PreviewStepCommit(id, stepID)
}

// CommitStep commits a completed step on the task branch, inside its workspace.
func (tasks *AgentTasks) CommitStep(id, stepID string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.Task{}, err
	}
	return service.CommitStep(id, stepID)
}

// --- Acceptance scenarios (AGI-05, first increment) ---

// ListScenarios reads the acceptance scenarios of a project (.adomnia/acceptance).
func (tasks *AgentTasks) ListScenarios(root string) (acceptance.LoadResult, error) {
	return acceptance.Load(root)
}

// SaveScenario writes a scenario as versionable JSON in the project.
func (tasks *AgentTasks) SaveScenario(root string, scenario acceptance.Scenario) (acceptance.Scenario, error) {
	return acceptance.Save(root, scenario)
}

// AddScenarioToTask adds the executable criteria of a project scenario as task verifications.
func (tasks *AgentTasks) AddScenarioToTask(id, scenarioID string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	task, err := service.Get(id)
	if err != nil {
		return agenttask.Task{}, err
	}
	loaded, err := acceptance.Load(task.Root)
	if err != nil {
		return agenttask.Task{}, err
	}
	for _, scenario := range loaded.Scenarios {
		if scenario.ID == scenarioID {
			return service.AddScenario(id, scenario)
		}
	}
	return agenttask.Task{}, fmt.Errorf("scenario %s was not found in %s", scenarioID, acceptance.Dir)
}

// EvidenceImage returns the screenshot of a page verification as base64 PNG. Only files
// inside the evidence folder are read, whatever the stored path says.
func (tasks *AgentTasks) EvidenceImage(id, evidenceID string) (string, error) {
	service, err := tasks.ready()
	if err != nil {
		return "", err
	}
	task, err := service.Get(id)
	if err != nil {
		return "", err
	}
	for _, evidence := range task.Evidences {
		if evidence.ID != evidenceID {
			continue
		}
		for _, observation := range evidence.Observations {
			if observation.Name != "screenshot" {
				continue
			}
			path := filepath.Clean(observation.Value)
			relative, err := filepath.Rel(tasks.evidenceDir, path)
			if tasks.evidenceDir == "" || err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.Ext(path) != ".png" {
				return "", errors.New("the screenshot is outside the evidence folder")
			}
			data, err := os.ReadFile(path) // #nosec G304 -- confined to the evidence folder above
			if err != nil {
				return "", fmt.Errorf("read the screenshot: %w", err)
			}
			return base64.StdEncoding.EncodeToString(data), nil
		}
		return "", errors.New("this evidence has no screenshot")
	}
	return "", errors.New("evidence not found")
}

// DraftPullRequest builds an editable PR title and body from the task evidence. Nothing is pushed.
func (tasks *AgentTasks) DraftPullRequest(id string) (agenttask.PRDraft, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.PRDraft{}, err
	}
	return service.DraftPullRequest(id)
}

// TouchedScenarios returns the project scenarios whose linked files the task workspace
// changed, so the user can re-run them. Without a workspace nothing is compared.
func (tasks *AgentTasks) TouchedScenarios(id string) ([]string, error) {
	service, err := tasks.ready()
	if err != nil {
		return nil, err
	}
	task, err := service.Get(id)
	if err != nil {
		return nil, err
	}
	if task.Workspace == nil || task.Workspace.State != agenttask.WorkspaceReady {
		return []string{}, nil
	}
	comparison, err := service.CompareWorkspace(id)
	if err != nil {
		return nil, err
	}
	loaded, err := acceptance.Load(task.Root)
	if err != nil {
		return nil, err
	}
	return acceptance.Touched(loaded.Scenarios, comparison.ChangedFiles), nil
}
