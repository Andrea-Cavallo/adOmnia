package codestudio

import (
	"adomnia/internal/ide/testing"
	"adomnia/internal/languages/golang"
	"encoding/json"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type TestRunRequest = golang.TestOptions

// TestRunSnapshot è lo stato di un'esecuzione di test; Results non include l'output dei singoli nodi.
type TestRunSnapshot struct {
	RunID       RunID          `json:"runId"`
	SessionID   SessionID      `json:"sessionId"`
	Request     TestRunRequest `json:"request"`
	Command     string         `json:"command"`
	Status      string         `json:"status"`
	ExitCode    *int           `json:"exitCode,omitempty"`
	Diagnostics string         `json:"diagnostics,omitempty"`
	Summary     TestSummary    `json:"summary"`
	Results     []TestResult   `json:"results"`
	Overflow    bool           `json:"overflow,omitempty"`
	StartedAt   time.Time      `json:"startedAt"`
	// FinishedAt è presente solo quando il processo di test è terminato; permette
	// di distinguere la durata reale della run dalla metrica ns/op del benchmark.
	FinishedAt *time.Time      `json:"finishedAt,omitempty"`
	Coverage   *CoverageReport `json:"coverage,omitempty"`
	// RaceReports sono i blocchi "WARNING: DATA RACE" completi, nell'ordine in cui go test li ha scritti.
	RaceReports []string `json:"raceReports,omitempty"`
}

type TestManager struct {
	core *testing.Manager
	// projectRoot risolve la radice del progetto di una sessione: serve a calcolare il token del
	// file e a rendere relative le coperture degli adapter (PY-5.5).
	projectRoot func(SessionID) string
}

func NewTestManager() *TestManager { return &TestManager{core: testing.NewManager()} }

// SetProjectRoot collega la risoluzione della radice del progetto (impostata dal Service).
func (m *TestManager) SetProjectRoot(resolver func(SessionID) string) { m.projectRoot = resolver }

var testArguments = golang.TestArguments

type testMetadata struct {
	Coverage      *CoverageReport `json:"coverage,omitempty"`
	CoverageError string          `json:"coverageError,omitempty"`
	RaceReports   []string        `json:"raceReports,omitempty"`
}

func (m *TestManager) hostTestSnapshot(s testing.Snapshot) TestRunSnapshot {
	var request TestRunRequest
	_ = json.Unmarshal(s.Request, &request)
	var meta testMetadata
	_ = json.Unmarshal(s.Metadata, &meta)
	diagnostics := s.Diagnostics
	if meta.CoverageError != "" {
		if diagnostics != "" && diagnostics[len(diagnostics)-1] != '\n' {
			diagnostics += "\n"
		}
		diagnostics += "Coverage: " + meta.CoverageError
	}
	coverage := meta.Coverage
	// Un adapter può produrre la copertura da sé (pytest-cov): il core la espone in forma neutra.
	if s.Coverage != nil {
		coverage = m.hostCoverage(s, coverage)
	}
	return TestRunSnapshot{RunID: s.RunID, SessionID: s.SessionID, Request: request, Command: s.Command, Status: s.Status, ExitCode: s.ExitCode, Diagnostics: diagnostics, Summary: s.Summary, Results: s.Results, Overflow: s.Overflow, StartedAt: s.StartedAt, FinishedAt: s.FinishedAt, Coverage: coverage, RaceReports: meta.RaceReports}
}

// hostCoverage converte il report neutro del core nel modello della vista: percorsi relativi,
// token del file (per non mostrare annotazioni superate) e un package per cartella di primo livello.
func (m *TestManager) hostCoverage(s testing.Snapshot, existing *CoverageReport) *CoverageReport {
	if existing != nil {
		return existing
	}
	report := &CoverageReport{Mode: s.Coverage.Mode, Statements: s.Coverage.Statements, Covered: s.Coverage.Covered, Percent: s.Coverage.Percent, GeneratedAt: time.Now().UTC()}
	root := ""
	if m.projectRoot != nil {
		root = m.projectRoot(s.SessionID)
	}
	type packageTotal struct{ statements, covered int }
	packages := map[string]*packageTotal{}
	for _, file := range s.Coverage.Files {
		relative := filepath.ToSlash(file.Path)
		entry := CoverageFile{
			ImportPath: relative, RelativePath: relative,
			Statements: file.Statements, Covered: file.Covered, Percent: file.Percent,
		}
		if root != "" {
			if text, info, _, err := readTextFile(filepath.Join(root, filepath.FromSlash(relative))); err == nil {
				entry.DiskToken = diskToken([]byte(text), info)
			}
		}
		for _, block := range file.Blocks {
			entry.Blocks = append(entry.Blocks, CoverageBlock{StartLine: block.StartLine, StartColumn: block.StartColumn, EndLine: block.EndLine, EndColumn: block.EndColumn, Covered: block.Covered, Statements: block.Statements})
		}
		report.Files = append(report.Files, entry)
		if index := strings.Index(relative, "/"); index > 0 {
			name := relative[:index]
			if packages[name] == nil {
				packages[name] = &packageTotal{}
			}
			packages[name].statements += file.Statements
			packages[name].covered += file.Covered
		}
	}
	names := make([]string, 0, len(packages))
	for name := range packages {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		total := packages[name]
		percent := 0.0
		if total.statements > 0 {
			percent = math.Round(float64(total.covered)/float64(total.statements)*1000) / 10
		}
		report.Packages = append(report.Packages, CoveragePackage{ImportPath: name, RelativePath: name, Statements: total.statements, Covered: total.covered, Percent: percent})
	}
	return report
}

func (m *TestManager) Snapshot(id RunID) (TestRunSnapshot, error) {
	s, err := m.core.Snapshot(id)
	return m.hostTestSnapshot(s), err
}
func (m *TestManager) Output(id RunID, node string) (string, error) { return m.core.Output(id, node) }
func (m *TestManager) List(id SessionID) []TestRunSnapshot {
	out := []TestRunSnapshot{}
	for _, s := range m.core.List(id) {
		out = append(out, m.hostTestSnapshot(s))
	}
	return out
}
func (m *TestManager) CloseSession(id SessionID) { m.core.CloseSession(id) }
