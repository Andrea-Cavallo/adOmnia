package main

import (
	"errors"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/codestudio"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type AgentTasks struct {
	service *agenttask.Service
	initErr error
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
func (tasks *AgentTasks) configure(workspaceRoot string, verifier agenttask.Verifier, trusted func(string) bool) {
	tasks.trusted = trusted
	if tasks.service == nil {
		return
	}
	tasks.service.SetWorkspaceProvider(codestudio.NewGitWorkspaceProvider(workspaceRoot))
	tasks.service.SetVerifier(verifier)
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

func (tasks *AgentTasks) StartCorrection(id string, evidenceIDs []string, note string) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	if err := tasks.requireTaskTrust(id); err != nil {
		return agenttask.Task{}, err
	}
	return service.StartCorrection(id, evidenceIDs, note)
}
