package main

import (
	"errors"
	"path/filepath"

	"github.com/Andrea-Cavallo/adOmnia/internal/codestudio"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type AgentTasks struct {
	service *agenttask.Service
	initErr error
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

func (tasks *AgentTasks) ready() (*agenttask.Service, error) {
	if tasks.initErr != nil {
		return nil, tasks.initErr
	}
	if tasks.service == nil {
		return nil, errors.New("agent task service is not available")
	}
	return tasks.service, nil
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
	return service.Create(draft)
}

func (tasks *AgentTasks) Update(id string, draft agenttask.Draft) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
		return agenttask.Task{}, err
	}
	return service.Update(id, draft)
}

func (tasks *AgentTasks) Start(id, message string, receipt agenttask.ContextReceipt) (agenttask.Task, error) {
	service, err := tasks.ready()
	if err != nil {
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
