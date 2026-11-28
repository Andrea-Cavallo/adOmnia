package main

import (
	"context"
	"encoding/json/jsontext"
	"errors"

	"github.com/Andrea-Cavallo/adOmnia/internal/loadtest"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// LoadTest is the Wails service of the load testing engine (internal/loadtest).
// Progress and results arrive as loadtest:progress / loadtest:finished events; every
// finished run lands in the history.
type LoadTest struct {
	manager *loadtest.Manager
	history *loadtest.History
}

func NewLoadTest() *LoadTest {
	loadtest.BuildVersion, loadtest.BuildCommit = Version, GitCommit
	h := &loadtest.History{Put: storage.Put, Get: storage.Get, List: storage.List, Delete: storage.Delete}
	m := loadtest.NewManager()
	m.SetHistory(h)
	return &LoadTest{manager: m, history: h}
}

func (lt *LoadTest) attachDesktop(desktop *application.App) {
	lt.manager.SetEmitter(func(event string, payload any) { desktop.Event.Emit(event, payload) })
}

// ServiceStartup moves the results the drawer saved by name into the history, once, off
// the startup path. App opens bbolt first (it is registered before this service).
func (lt *LoadTest) ServiceStartup(context.Context, application.ServiceOptions) error {
	if storage.DB() != nil {
		go lt.history.MigrateLegacyResults()
	}
	return nil
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

// StartFile runs a scenario file with the app's variables, data rows and transport settings.
func (lt *LoadTest) StartFile(file loadtest.ScenarioFile, input loadtest.FlowInput) (string, error) {
	scenario, err := file.Scenario(input)
	if err != nil {
		return "", err
	}
	return lt.manager.Start(scenario)
}

// Stop ends the run with that id; its partial result arrives as aborted.
func (lt *LoadTest) Stop(runID string) { lt.manager.Stop(runID) }

// Running returns the id of the run in progress, or "".
func (lt *LoadTest) Running() string { return lt.manager.Running() }

// Runs lists the history, newest first.
func (lt *LoadTest) Runs() ([]loadtest.RunSummary, error) { return lt.history.Runs() }

// Run returns a saved run's full report.
func (lt *LoadTest) Run(id string) (loadtest.Result, error) { return lt.history.Run(id) }

// DeleteRun removes a run from the history.
func (lt *LoadTest) DeleteRun(id string) error { return lt.history.DeleteRun(id) }

// ImportRun adds a run made elsewhere (old Flow Stress history, a JSON report) to the history.
func (lt *LoadTest) ImportRun(result loadtest.Result) (loadtest.RunSummary, error) {
	return lt.history.Import(result)
}

// Compare compares two saved runs (base → head); tolerance in percent, 0 = default 10%.
func (lt *LoadTest) Compare(baseID, headID string, tolerancePct float64) (loadtest.Comparison, error) {
	base, err := lt.history.Run(baseID)
	if err != nil {
		return loadtest.Comparison{}, err
	}
	head, err := lt.history.Run(headID)
	if err != nil {
		return loadtest.Comparison{}, err
	}
	return loadtest.Compare(base, head, tolerancePct), nil
}

// CompareResults compares two reports the caller already has.
func (lt *LoadTest) CompareResults(base, head loadtest.Result, tolerancePct float64) loadtest.Comparison {
	return loadtest.Compare(base, head, tolerancePct)
}

// Report renders a report: json, md, html, junit, csv (per step) or samples (per request).
func (lt *LoadTest) Report(result loadtest.Result, format string) (string, error) {
	data, err := loadtest.Render(result, format)
	return string(data), err
}

// SaveScenarioFile writes a scenario to <folder>/.adomnia/loadtests and returns its path.
func (lt *LoadTest) SaveScenarioFile(folder string, file loadtest.ScenarioFile) (string, error) {
	return loadtest.SaveScenarioFile(folder, file)
}

// ScenarioFiles lists the scenario files of a workspace folder.
func (lt *LoadTest) ScenarioFiles(folder string) ([]loadtest.ScenarioFileEntry, error) {
	return loadtest.ListScenarioFiles(folder)
}

// ReadScenarioFile reads one scenario file.
func (lt *LoadTest) ReadScenarioFile(path string) (loadtest.ScenarioFile, error) {
	return loadtest.ReadScenarioFile(path)
}

// PlanScenarioFile turns a Flow Stress CI plan into a scenario file (not yet saved).
func (lt *LoadTest) PlanScenarioFile(plan loadtest.Plan) (loadtest.ScenarioFile, error) {
	return loadtest.ScenarioFileOf(plan)
}

// SavedSettings lists the drawer's saved settings (scenarios saved by name).
func (lt *LoadTest) SavedSettings() ([]string, error) { return lt.history.SavedScenarios() }

// SaveSettings stores the drawer's settings under name.
func (lt *LoadTest) SaveSettings(name string, config jsontext.Value) error {
	return lt.history.SaveSettings(name, config)
}

// LoadSettings returns the drawer's settings saved under name.
func (lt *LoadTest) LoadSettings(name string) (jsontext.Value, error) {
	if name == "" {
		return nil, errors.New("name required")
	}
	return lt.history.LoadSettings(name)
}

func (lt *LoadTest) ServiceShutdown() error {
	lt.manager.Shutdown()
	return nil
}
