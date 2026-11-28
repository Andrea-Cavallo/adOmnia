package main

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/loadtest"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// LoadTest is the Wails service of the load testing engine (internal/loadtest).
// Progress and results arrive as loadtest:progress / loadtest:finished events.
type LoadTest struct {
	manager *loadtest.Manager
}

func NewLoadTest() *LoadTest { return &LoadTest{manager: loadtest.NewManager()} }

func (lt *LoadTest) attachDesktop(desktop *application.App) {
	lt.manager.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
}

// Start runs the scenario in the background and returns its run id.
func (lt *LoadTest) Start(scenario loadtest.Scenario) (string, error) {
	return lt.manager.Start(scenario)
}

// StartPlan runs a Flow Builder stress plan — the same file `adomnia stress` runs in CI —
// with the app's variables (vault resolved), dataset rows and transport settings.
func (lt *LoadTest) StartPlan(plan loadtest.Plan, input loadtest.FlowInput) (string, error) {
	scenario, err := plan.Scenario(input)
	if err != nil {
		return "", err
	}
	return lt.manager.Start(scenario)
}

// Stop ends the run with that id; its partial result arrives as aborted.
func (lt *LoadTest) Stop(runID string) { lt.manager.Stop(runID) }

// Running returns the id of the run in progress, or "".
func (lt *LoadTest) Running() string { return lt.manager.Running() }

func (lt *LoadTest) ServiceShutdown() error {
	lt.manager.Shutdown()
	return nil
}
