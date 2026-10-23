package python

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// EnvironmentManager è il gestore dichiarato dai file del progetto. È un'informazione, non
// un'autorizzazione: adOmnia non esegue `uv run`, `poetry run` o sync impliciti (PY-2.3).
const (
	ManagerUV     = "uv"
	ManagerPoetry = "poetry"
	ManagerPip    = "pip"
)

// CommandPlan è un'azione esplicita dell'utente: comando completo visibile, eseguibile e
// argomenti già separati (niente shell). Available=false spiega perché non è proponibile.
type CommandPlan struct {
	Available  bool     `json:"available"`
	Executable string   `json:"executable,omitempty"`
	Arguments  []string `json:"arguments,omitempty"`
	// Command è la forma leggibile mostrata nella conferma, con percorsi relativi alla radice.
	Command string `json:"command,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// EnvironmentPlan descrive l'ambiente Python di un'unità (o del progetto) e le due azioni
// separate che l'utente può chiedere: creare l'ambiente e installare le dipendenze.
type EnvironmentPlan struct {
	// Root è la cartella dell'unità relativa al progetto ("." per il progetto).
	Root string `json:"root"`
	// Manager è "uv", "poetry", "pip" o "" quando il progetto non dichiara dipendenze.
	Manager string `json:"manager,omitempty"`
	// Lockfile è il lockfile riconosciuto (uv.lock, poetry.lock), "" se non c'è.
	Lockfile string `json:"lockfile,omitempty"`
	// RequiresPython e PythonVersion sono i vincoli dichiarati dal progetto.
	RequiresPython string `json:"requiresPython,omitempty"`
	PythonVersion  string `json:"pythonVersion,omitempty"`
	// Environment è il percorso assoluto dell'ambiente riconosciuto ("" se non esiste).
	Environment string `json:"environment,omitempty"`
	// Exists dice se l'ambiente esiste già.
	Exists bool `json:"exists"`
	// Create e Install sono le azioni esplicite, con il comando visibile prima di partire.
	Create  CommandPlan `json:"create"`
	Install CommandPlan `json:"install"`
}

// DetectEnvironmentManager legge solo nomi di file e manifest: nessun processo, nessun import.
func DetectEnvironmentManager(unitRoot string) (manager, lockfile string) {
	if isFile(filepath.Join(unitRoot, "uv.lock")) {
		return ManagerUV, "uv.lock"
	}
	if isFile(filepath.Join(unitRoot, "poetry.lock")) {
		return ManagerPoetry, "poetry.lock"
	}
	if manifest := readManifest(unitRoot); manifest.Poetry {
		return ManagerPoetry, ""
	}
	if requirementsFile(unitRoot) != "" || hasProjectTable(unitRoot) {
		return ManagerPip, ""
	}
	return "", ""
}

// requirementsFile è il primo file requirements*.txt dell'unità (requirements.txt per primo).
func requirementsFile(unitRoot string) string {
	if isFile(filepath.Join(unitRoot, "requirements.txt")) {
		return "requirements.txt"
	}
	matches, err := filepath.Glob(filepath.Join(unitRoot, "requirements*.txt"))
	if err != nil {
		return ""
	}
	for _, match := range matches {
		if isFile(match) {
			return filepath.Base(match)
		}
	}
	return ""
}

// hasProjectTable dice se il pyproject dichiara dipendenze nel formato PEP 621.
func hasProjectTable(unitRoot string) bool {
	data, err := os.ReadFile(filepath.Join(unitRoot, "pyproject.toml"))
	if err != nil {
		return false
	}
	return strings.Contains(string(data), "[project]")
}

// PlanEnvironment costruisce il piano dell'unità senza eseguire nulla. baseInterpreter è
// l'interprete con cui creare l'ambiente: se è già dentro l'ambiente dell'unità non va bene
// (creare un venv da sé stessi non è supportato), e il piano lo dice.
func PlanEnvironment(projectRoot, unitRoot, baseInterpreter string) EnvironmentPlan {
	root := relativeDirectory(projectRoot, unitRoot)
	manager, lockfile := DetectEnvironmentManager(unitRoot)
	plan := EnvironmentPlan{
		Root: root, Manager: manager, Lockfile: lockfile,
		RequiresPython: RequiresPython(unitRoot),
		PythonVersion:  readPythonVersion(unitRoot),
	}
	if directory := environmentInterpreterDirectory(unitRoot); directory != "" {
		plan.Environment = directory
		plan.Exists = true
	}
	plan.Create = createPlan(unitRoot, baseInterpreter)
	plan.Install = installPlan(unitRoot, plan.Environment, plan.Exists)
	return plan
}

// environmentInterpreterDirectory trova la cartella dell'ambiente riconosciuto dell'unità.
func environmentInterpreterDirectory(unitRoot string) string {
	for _, name := range environmentDirectories {
		directory := filepath.Join(unitRoot, name)
		if environmentInterpreter(directory) != "" {
			return directory
		}
	}
	return ""
}

// createPlan propone `python -m venv .venv` con l'interprete scelto. Non sovrascrive un ambiente
// esistente e non accetta un interprete che vive già dentro l'ambiente da creare.
func createPlan(unitRoot, baseInterpreter string) CommandPlan {
	if environmentInterpreterDirectory(unitRoot) != "" {
		return CommandPlan{Reason: "this project already has an environment"}
	}
	if strings.TrimSpace(baseInterpreter) == "" {
		return CommandPlan{Reason: "select a Python interpreter first"}
	}
	if !filepath.IsAbs(baseInterpreter) || !isInterpreter(baseInterpreter) {
		return CommandPlan{Reason: "the selected interpreter is not an executable Python"}
	}
	if InsideEnvironment(unitRoot, baseInterpreter) {
		return CommandPlan{Reason: "choose a Python outside the project environment (for example the system Python)"}
	}
	arguments := []string{"-m", "venv", ".venv"}
	return CommandPlan{
		Available: true, Executable: baseInterpreter, Arguments: arguments,
		Command: strings.Join(append([]string{filepath.Base(baseInterpreter)}, arguments...), " "),
	}
}

// InsideEnvironment dice se binary vive dentro una cartella di ambiente riconosciuta dell'unità:
// un ambiente non può creare sé stesso.
func InsideEnvironment(unitRoot, binary string) bool {
	for _, name := range environmentDirectories {
		if within(filepath.Join(unitRoot, name), binary) {
			return true
		}
	}
	return false
}

// installPlan propone l'installazione con il pip dell'ambiente creato: un solo percorso, senza
// `uv run` o `poetry install` che potrebbero creare un secondo ambiente o sincronizzare da soli.
func installPlan(unitRoot, environment string, exists bool) CommandPlan {
	if !exists {
		return CommandPlan{Reason: "create the environment first"}
	}
	interpreter := environmentInterpreter(environment)
	if interpreter == "" {
		return CommandPlan{Reason: "the selected environment does not contain a Python interpreter"}
	}
	if requirements := requirementsFile(unitRoot); requirements != "" {
		arguments := []string{"-m", "pip", "install", "-r", requirements}
		return CommandPlan{
			Available: true, Executable: interpreter, Arguments: arguments,
			Command: strings.Join(append([]string{filepath.Base(interpreter)}, arguments...), " "),
		}
	}
	if isFile(filepath.Join(unitRoot, "pyproject.toml")) {
		arguments := []string{"-m", "pip", "install", "-e", "."}
		return CommandPlan{
			Available: true, Executable: interpreter, Arguments: arguments,
			Command: strings.Join(append([]string{filepath.Base(interpreter)}, arguments...), " "),
		}
	}
	return CommandPlan{Reason: "no requirements.txt or pyproject.toml declares dependencies"}
}

// readPythonVersion legge `.python-version` (una versione per riga, come pyenv/uv). È un vincolo
// locale del progetto: non si scarica né si installa nulla per soddisfarlo.
func readPythonVersion(unitRoot string) string {
	data, err := os.ReadFile(filepath.Join(unitRoot, ".python-version"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if value := strings.TrimSpace(line); value != "" && !strings.HasPrefix(value, "#") {
			return value
		}
	}
	return ""
}

// ValidatePlanCommand ricontrolla il piano prima di avviare un processo: l'host non si fida di un
// comando costruito altrove e il percorso deve restare dentro il progetto.
func ValidatePlanCommand(command CommandPlan, directory string) error {
	if !command.Available {
		return fmt.Errorf("%s", command.Reason)
	}
	if !isInterpreter(command.Executable) {
		return fmt.Errorf("the Python interpreter of this environment is not executable")
	}
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("the project directory does not exist")
	}
	return nil
}
