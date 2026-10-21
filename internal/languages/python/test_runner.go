package python

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
)

// TestOptions sono le opzioni di LanguageOptions dei test Python. Hanno gli stessi nomi JSON
// della richiesta generica dell'host: Packages sono file/percorsi o node ID pytest, Run è un
// node ID singolo oppure un filtro `-k` scritto come "k:espressione".
type TestOptions struct {
	Interpreter string   `json:"interpreter"`
	Packages    []string `json:"packages"`
	Run         string   `json:"run"`
	// Coverage chiede `--cov` a pytest: richiede pytest-cov nell'interprete scelto (PY-5.5).
	Coverage bool `json:"coverage,omitempty"`
}

const (
	pytestPluginModule = "adomnia_pytest_events"
	maxTestTargets     = 256
	maxNodeIDLength    = 2048
)

//go:embed adomnia_pytest_events.py
var pytestPluginSource []byte

// TestCommand esegue pytest con l'interprete scelto e raccoglie gli eventi del plugin adOmnia:
// node ID veri (compresi i parametrizzati), esiti, durate e traceback, senza parsing dell'output
// umano. La collection importa i moduli del progetto: come ogni test, parte solo su richiesta
// esplicita con il progetto autorizzato (PY-5.1).
func (*Language) TestCommand(request idetesting.Request) (run.CommandSpec, idetesting.EventParser, error) {
	var options TestOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return run.CommandSpec{}, nil, fmt.Errorf("invalid test options: %w", err)
		}
	}
	interpreter, err := ResolveInterpreter(request.Root, request.WorkingDirectory, options.Interpreter)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	targets, err := testTargets(request, options)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	pluginDirectory, err := preparePytestPlugin()
	if err != nil {
		return run.CommandSpec{}, nil, fmt.Errorf("could not prepare the pytest plugin: %w", err)
	}
	events, err := os.CreateTemp(pluginDirectory, "events-*.jsonl")
	if err != nil {
		return run.CommandSpec{}, nil, fmt.Errorf("could not prepare the pytest events file: %w", err)
	}
	eventsPath := events.Name()
	_ = events.Close()
	arguments := []string{"-m", "pytest", "-p", pytestPluginModule}
	arguments = append(arguments, targets...)
	switch {
	case options.Run == "":
	case strings.HasPrefix(options.Run, "k:"):
		arguments = append(arguments, "-k", strings.TrimPrefix(options.Run, "k:"))
	default:
		arguments = append(arguments, options.Run)
	}
	// Copertura opzionale: pytest-cov scrive un report JSON nella cartella strumenti, fuori dal
	// progetto, e il parser lo legge a fine run. Senza pytest-cov pytest rifiuta `--cov` con un
	// messaggio chiaro: nessun pacchetto viene installato qui.
	coveragePath := ""
	if options.Coverage {
		coveragePath = eventsPath + ".coverage.json"
		arguments = append(arguments, "--cov", "--cov-report=json:"+coveragePath)
	}
	if err := run.CheckBatchSafe(interpreter.Path, arguments); err != nil {
		return run.CommandSpec{}, nil, err
	}
	spec := run.CommandSpec{
		Executable: interpreter.Path, Arguments: arguments,
		WorkingDirectory: request.WorkingDirectory,
		Environment:      withPythonPath(withEventsFile(request.Environment, eventsPath), pluginDirectory),
		DisplayCommand:   "python " + strings.Join(arguments, " "),
	}
	return spec, newPytestParser(request.Root, eventsPath, coveragePath), nil
}

// withEventsFile dice al plugin dove scrivere gli eventi: un file temporaneo dell'IDE, mai
// dentro il progetto.
func withEventsFile(environment []string, path string) []string {
	result := make([]string, 0, len(environment)+1)
	replaced := false
	for _, entry := range environment {
		key, _, found := strings.Cut(entry, "=")
		if found && strings.EqualFold(key, "ADOMNIA_PYTEST_EVENTS") {
			if !replaced {
				result = append(result, "ADOMNIA_PYTEST_EVENTS="+path)
				replaced = true
			}
			continue
		}
		result = append(result, entry)
	}
	if !replaced {
		result = append(result, "ADOMNIA_PYTEST_EVENTS="+path)
	}
	return result
}

// testTargets traduce le richieste in argomenti pytest: node ID (file::classe::test) e percorsi,
// tutti confinati al progetto e mai con la forma di un'opzione (niente "-..." in argv).
func testTargets(request idetesting.Request, options TestOptions) ([]string, error) {
	if len(options.Packages) > maxTestTargets {
		return nil, fmt.Errorf("too many test targets: at most %d", maxTestTargets)
	}
	if options.Run != "" && !strings.HasPrefix(options.Run, "k:") {
		if err := validateNodeID(options.Run); err != nil {
			return nil, err
		}
	}
	targets := make([]string, 0, len(options.Packages))
	for _, target := range options.Packages {
		if strings.Contains(target, "::") {
			if err := validateNodeID(target); err != nil {
				return nil, err
			}
			targets = append(targets, target)
			continue
		}
		if err := run.ValidateTarget(request.Root, request.WorkingDirectory, target); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, nil
}

// validateNodeID accetta un node ID pytest scritto dall'utente: senza controlli finirebbe
// nell'argv di pytest come se fosse un'opzione.
func validateNodeID(nodeID string) error {
	if nodeID == "" || len(nodeID) > maxNodeIDLength {
		return fmt.Errorf("invalid test id: it is too long or empty")
	}
	if strings.HasPrefix(nodeID, "-") || strings.ContainsAny(nodeID, "\x00\r\n") {
		return fmt.Errorf("invalid test id %q", nodeID)
	}
	file, _, _ := strings.Cut(nodeID, "::")
	if file == "" {
		return fmt.Errorf("invalid test id %q", nodeID)
	}
	return nil
}

// withPythonPath mette la cartella del plugin in testa al PYTHONPATH del solo processo di test:
// serve a importare adomnia_pytest_events, non cambia il sys.path del progetto in modo permanente.
func withPythonPath(environment []string, directory string) []string {
	result := make([]string, 0, len(environment)+1)
	replaced := false
	for _, entry := range environment {
		key, value, found := strings.Cut(entry, "=")
		if found && strings.EqualFold(key, "PYTHONPATH") {
			if !replaced {
				result = append(result, "PYTHONPATH="+directory+string(os.PathListSeparator)+value)
				replaced = true
			}
			continue
		}
		result = append(result, entry)
	}
	if !replaced {
		result = append(result, "PYTHONPATH="+directory)
	}
	return result
}

var (
	pytestPluginOnce  sync.Once
	pytestPluginDir   string
	pytestPluginError error
)

// preparePytestPlugin scrive il plugin nella cartella strumenti per-utente (locale, minuscola,
// mai dentro il progetto). Il file è condiviso da tutte le esecuzioni: nessun download.
func preparePytestPlugin() (string, error) {
	pytestPluginOnce.Do(func() {
		directory := filepath.Join(os.TempDir(), "adomnia-python-tools")
		if err := os.MkdirAll(directory, 0o755); err != nil {
			pytestPluginError = err
			return
		}
		path := filepath.Join(directory, pytestPluginModule+".py")
		if current, err := os.ReadFile(path); err != nil || !bytes.Equal(current, pytestPluginSource) {
			if err := os.WriteFile(path, pytestPluginSource, 0o644); err != nil {
				pytestPluginError = err
				return
			}
		}
		pytestPluginDir = directory
	})
	return pytestPluginDir, pytestPluginError
}
