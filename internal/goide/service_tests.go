package goide

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// StartTests avvia `go test -json` sul perimetro richiesto; l'albero dei risultati arriva con gli eventi tests.updated.
func (s *Service) StartTests(request TestRunRequest) (TestRunSnapshot, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return TestRunSnapshot{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return TestRunSnapshot{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	moduleDir, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return TestRunSnapshot{}, err
	}
	for _, pattern := range request.Packages {
		if err := validateRunTarget(session.Project.RealPath, moduleDir, strings.TrimSuffix(pattern, "/...")); err != nil {
			return TestRunSnapshot{}, err
		}
	}
	coverageFile := ""
	if request.Coverage {
		coverageFile, err = newCoverageProfilePath()
		if err != nil {
			return TestRunSnapshot{}, err
		}
	}
	arguments, err := testArguments(request, coverageFile)
	if err != nil {
		return TestRunSnapshot{}, err
	}
	binary, err := s.toolchain.GoBinary(session.ID)
	if err != nil {
		return TestRunSnapshot{}, errors.New("go non disponibile: rileva o configura la toolchain prima di eseguire i test")
	}
	environment, err := s.toolchain.Environment(session.ID, request.Environment)
	if err != nil {
		return TestRunSnapshot{}, err
	}
	request.SessionID = session.ID
	relativeModule := filepath.ToSlash(relativeWithin(session.Project.RealPath, moduleDir))
	run := &testRun{
		tree: newTestTree(), moduleDir: relativeModule, modulePath: readModulePath(filepath.Join(moduleDir, "go.mod")), coverageFile: coverageFile,
		snapshot: TestRunSnapshot{SessionID: session.ID, Request: request, Status: TestRunning, StartedAt: time.Now().UTC(), Results: []TestResult{}},
	}
	stopTicker := make(chan struct{})
	spec := CommandSpec{
		SessionID: session.ID, Kind: "tests", Executable: binary, Arguments: arguments, WorkingDirectory: moduleDir,
		Environment: environment, DisplayCommand: displayCommand("go", arguments), QuietStdout: true,
		OutputTap: func(stream string, data []byte) {
			if stream == "stdout" {
				run.consume(data)
			}
		},
		OnExit: func(execution Execution) {
			close(stopTicker)
			s.finishTests(session, run, execution)
		},
	}
	execution, err := s.processes.Start(spec)
	if err != nil {
		if coverageFile != "" {
			_ = os.Remove(coverageFile)
		}
		return TestRunSnapshot{}, err
	}
	run.mu.Lock()
	run.snapshot.RunID = execution.ID
	run.snapshot.Command = execution.Command
	run.mu.Unlock()
	s.tests.register(run)
	go s.publishTestProgress(run, stopTicker)
	snapshot, _ := run.publishable(true)
	return snapshot, nil
}

// publishTestProgress invia al più un aggiornamento ogni testUpdateInterval mentre i test girano.
func (s *Service) publishTestProgress(run *testRun, stop <-chan struct{}) {
	ticker := time.NewTicker(testUpdateInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if snapshot, ok := run.publishable(false); ok {
				s.emit("tests.updated", snapshot.SessionID, string(snapshot.RunID), snapshot)
			}
		}
	}
}

// finishTests chiude l'albero, legge la coverage se richiesta e pubblica lo stato finale.
func (s *Service) finishTests(session Session, run *testRun, execution Execution) {
	run.mu.Lock()
	run.finished = true
	status := execution.Status
	if status == "exited" || status == "failed" {
		status = "finished"
	}
	run.snapshot.Status = status
	coverageFile := run.coverageFile
	run.mu.Unlock()
	if coverageFile != "" {
		report, err := loadCoverage(session.Project.RealPath, run.moduleDir, run.modulePath, coverageFile)
		run.mu.Lock()
		if err == nil {
			run.snapshot.Coverage = report
		}
		run.mu.Unlock()
	}
	snapshot, _ := run.publishable(true)
	s.emit("tests.updated", snapshot.SessionID, string(snapshot.RunID), snapshot)
}

func newCoverageProfilePath() (string, error) {
	directory := filepath.Join(os.TempDir(), "adomnia-coverage")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("cartella temporanea per la coverage non disponibile: %w", err)
	}
	return filepath.Join(directory, newID("cover")+".out"), nil
}

// GetTestRun restituisce l'esecuzione di test con l'output completo di ogni nodo.
func (s *Service) GetTestRun(runID string) (TestRunSnapshot, error) {
	return s.tests.Snapshot(RunID(runID))
}

// GetTestOutput restituisce l'output di un solo test, per il dettaglio nel pannello Tests.
func (s *Service) GetTestOutput(runID, nodeID string) (string, error) {
	return s.tests.Output(RunID(runID), nodeID)
}

// ListTestRuns restituisce le esecuzioni di test della sessione, dalla più recente.
func (s *Service) ListTestRuns(sessionID string) ([]TestRunSnapshot, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	return s.tests.List(SessionID(sessionID)), nil
}
