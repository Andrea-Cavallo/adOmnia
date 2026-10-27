package codestudio

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// StartTests avvia `go test -json` sul perimetro richiesto; l'albero dei risultati arriva con gli eventi tests.updated.
func (s *Service) StartTests(request TestRunRequest) (TestRunSnapshot, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return TestRunSnapshot{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return TestRunSnapshot{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	moduleDir, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return TestRunSnapshot{}, err
	}
	id := request.Language
	if id == "" {
		id = golang.ID
	}
	if id == golang.ID && len(request.LanguageOptions) > 0 {
		var options TestRunRequest
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return TestRunSnapshot{}, fmt.Errorf("invalid Go test options: %w", err)
		}
		options.SessionID, options.WorkingDirectory, options.Environment = request.SessionID, request.WorkingDirectory, request.Environment
		options.Language, options.LanguageOptions = request.Language, request.LanguageOptions
		request = options
	}
	for _, pattern := range request.Packages {
		if err := validateRunTarget(session.Project.RealPath, moduleDir, strings.TrimSuffix(pattern, "/...")); err != nil {
			return TestRunSnapshot{}, err
		}
	}

	adapter, found := s.workspace.languages.Get(id)
	runner, supported := adapter.(language.TestRunner)
	if !found || !supported {
		return TestRunSnapshot{}, fmt.Errorf("tests unavailable for %s", id)
	}
	coverageFile := ""
	binary := ""
	if id == golang.ID {
		binary, err = s.toolchain.GoBinary(session.ID)
		if err != nil {
			return TestRunSnapshot{}, errors.New("go unavailable: detect or configure the toolchain before running tests")
		}
		if request.Coverage {
			coverageFile, err = newCoverageProfilePath()
			if err != nil {
				return TestRunSnapshot{}, err
			}
		}
	}
	cleanupCoverage := coverageFile
	startedOK := false
	defer func() {
		if !startedOK && cleanupCoverage != "" {
			_ = os.Remove(cleanupCoverage)
		}
	}()
	environment, err := s.executionEnvironment(session.ID, id, request.Environment)
	if err != nil {
		return TestRunSnapshot{}, err
	}
	options := request.LanguageOptions
	if len(options) == 0 {
		options, err = jsonutil.Marshal(request)
		if err != nil {
			return TestRunSnapshot{}, err
		}
	}
	spec, parser, err := runner.TestCommand(idetesting.Request{Root: session.Project.RealPath, Executable: binary, WorkingDirectory: moduleDir, Environment: environment, CoverageFile: coverageFile, LanguageOptions: options})
	if err != nil {
		return TestRunSnapshot{}, err
	}

	request.SessionID = session.ID
	relativeModule := filepath.ToSlash(relativeWithin(session.Project.RealPath, moduleDir))
	if relativeModule == "." {
		relativeModule = ""
	}
	modulePath := ""
	if id == golang.ID {
		modulePath = golang.ReadModulePath(filepath.Join(moduleDir, "go.mod"))
	}
	var races golang.RaceCollector
	var coverage *CoverageReport
	coverageError := ""
	coverageModules := []coverageModule{{directory: relativeModule, path: modulePath}}
	seenCoverageModules := map[string]bool{relativeModule + "\x00" + modulePath: true}
	for _, unit := range session.Project.Units {
		if unit.Language != golang.ID || unit.Kind != golang.UnitModule || unit.Name == "" {
			continue
		}
		directory := filepath.ToSlash(relativeWithin(session.Project.RealPath, unit.Root))
		if directory == "" {
			directory = filepath.ToSlash(relativeWithin(session.Project.RootPath, unit.Root))
		}
		if directory == "" {
			continue
		}
		if directory == "." {
			directory = ""
		}
		key := directory + "\x00" + unit.Name
		if !seenCoverageModules[key] {
			coverageModules = append(coverageModules, coverageModule{directory: directory, path: unit.Name})
			seenCoverageModules[key] = true
		}
	}
	hooks := idetesting.Hooks{
		Metadata: func() jsonv1.RawMessage {
			data, _ := jsonutil.Marshal(testMetadata{Coverage: coverage, CoverageError: coverageError, RaceReports: races.Reports()})
			return data
		},
		Publish: func(snapshot idetesting.Snapshot) {
			s.emit("tests.updated", snapshot.SessionID, string(snapshot.RunID), s.tests.hostTestSnapshot(snapshot))
		},
	}
	if id == java.ID && request.Coverage {
		started := time.Now().Add(-2 * time.Second)
		hooks.Finish = func(_ Execution) {
			report, coverageErr := javaCoverageReport(session.Project.RealPath, moduleDir, started)
			coverage = report
			if coverageErr != nil {
				coverageError = coverageErr.Error()
			}
		}
	}
	if id == golang.ID {
		hooks.Line = races.ConsumeJSON
		hooks.Results = func(results []TestResult) { golang.ResolveTestLocations(results, relativeModule, modulePath) }
		hooks.Finish = func(_ Execution) {
			if coverageFile != "" {
				report, coverageErr := loadCoverageForModules(session.Project.RealPath, coverageModules, coverageFile)
				coverage = report
				if coverageErr != nil {
					coverageError = coverageErr.Error()
				}
				_ = os.Remove(coverageFile)
			}
		}
	}
	spec.SessionID, spec.Kind = session.ID, "tests"
	payload, _ := jsonutil.Marshal(request)
	snapshot, err := s.tests.core.Start(s.processes, spec, parser, payload, hooks)
	if err != nil {
		return TestRunSnapshot{}, err
	}
	startedOK = true
	return s.tests.hostTestSnapshot(snapshot), nil
}

func newCoverageProfilePath() (string, error) {
	// CreateTemp riserva un nome casuale con permessi restrittivi nella cartella temporanea
	// dell'utente: nessuna directory fissa da condividere con altri utenti (S6554).
	file, err := os.CreateTemp("", "adomnia-cover-*.out")
	if err != nil {
		return "", fmt.Errorf("temporary coverage profile unavailable: %w", err)
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("temporary coverage profile unavailable: %w", err)
	}
	return path, nil
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
