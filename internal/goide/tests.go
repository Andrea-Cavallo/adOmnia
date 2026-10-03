package goide

import (
	"adomnia/internal/ide/testing"
	"adomnia/internal/languages/golang"
	"encoding/json"
	"time"
)

type TestRunRequest = golang.TestOptions

// TestRunSnapshot è lo stato di un'esecuzione di test; Results non include l'output dei singoli nodi.
type TestRunSnapshot struct {
	RunID     RunID          `json:"runId"`
	SessionID SessionID      `json:"sessionId"`
	Request   TestRunRequest `json:"request"`
	Command   string         `json:"command"`
	Status    string         `json:"status"`
	Summary   TestSummary    `json:"summary"`
	Results   []TestResult   `json:"results"`
	Overflow  bool           `json:"overflow,omitempty"`
	StartedAt time.Time      `json:"startedAt"`
	// FinishedAt è presente solo quando il processo di test è terminato; permette
	// di distinguere la durata reale della run dalla metrica ns/op del benchmark.
	FinishedAt *time.Time      `json:"finishedAt,omitempty"`
	Coverage   *CoverageReport `json:"coverage,omitempty"`
	// RaceReports sono i blocchi "WARNING: DATA RACE" completi, nell'ordine in cui go test li ha scritti.
	RaceReports []string `json:"raceReports,omitempty"`
}

type TestManager struct{ core *testing.Manager }

func NewTestManager() *TestManager { return &TestManager{core: testing.NewManager()} }

var testArguments = golang.TestArguments

type testMetadata struct {
	Coverage    *CoverageReport `json:"coverage,omitempty"`
	RaceReports []string        `json:"raceReports,omitempty"`
}

func hostTestSnapshot(s testing.Snapshot) TestRunSnapshot {
	var request TestRunRequest
	_ = json.Unmarshal(s.Request, &request)
	var meta testMetadata
	_ = json.Unmarshal(s.Metadata, &meta)
	return TestRunSnapshot{RunID: s.RunID, SessionID: s.SessionID, Request: request, Command: s.Command, Status: s.Status, Summary: s.Summary, Results: s.Results, Overflow: s.Overflow, StartedAt: s.StartedAt, FinishedAt: s.FinishedAt, Coverage: meta.Coverage, RaceReports: meta.RaceReports}
}
func (m *TestManager) Snapshot(id RunID) (TestRunSnapshot, error) {
	s, err := m.core.Snapshot(id)
	return hostTestSnapshot(s), err
}
func (m *TestManager) Output(id RunID, node string) (string, error) { return m.core.Output(id, node) }
func (m *TestManager) List(id SessionID) []TestRunSnapshot {
	out := []TestRunSnapshot{}
	for _, s := range m.core.List(id) {
		out = append(out, hostTestSnapshot(s))
	}
	return out
}
func (m *TestManager) CloseSession(id SessionID) { m.core.CloseSession(id) }
