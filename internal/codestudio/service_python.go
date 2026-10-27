package codestudio

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/python"
)

// PythonInterpreterReport è ciò che serve a scegliere l'interprete Python: i candidati con la
// loro origine (ambiente del progetto, ambiente attivato, PATH), la scelta corrente e — solo con
// il progetto autorizzato — versione e strumenti presenti.
type PythonInterpreterReport struct {
	Installed []python.Interpreter `json:"installed"`
	// Selected è l'interprete scelto per il progetto (o per l'unità richiesta).
	Selected string `json:"selected"`
	// Probed dice se versione e pacchetti sono stati verificati eseguendo gli interpreti.
	Probed bool `json:"probed"`
	// RequiresPython è il vincolo più restrittivo dichiarato dalle unità Python ("" = nessuno).
	RequiresPython string `json:"requiresPython,omitempty"`
}

// PythonInterpreters elenca gli interpreti candidati del progetto. La scoperta è statica; con il
// progetto autorizzato ogni candidato viene sondato una volta (versione, eseguibile reale,
// architettura, pytest/debugpy/basedpyright presenti) e segnalato se la versione non soddisfa
// `requires-python` dell'unità. Nessun ambiente viene installato o modificato.
func (s *Service) PythonInterpreters(sessionID string) (PythonInterpreterReport, error) {
	return s.PythonUnitInterpreters(sessionID, "")
}

// PythonUnitInterpreters reports candidates and constraints for the selected unit.
// The project-wide binding remains available for existing callers.
func (s *Service) PythonUnitInterpreters(sessionID, unit string) (PythonInterpreterReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return PythonInterpreterReport{}, err
	}
	root := session.Project.RealPath
	directory, err := pythonEnvironmentDirectory(root, unit)
	if err != nil {
		return PythonInterpreterReport{}, err
	}
	installed := python.DiscoverInterpreters(root, directory)
	if saved := python.ProjectInterpreter(root, directory); saved != "" {
		installed = slices.DeleteFunc(installed, func(interpreter python.Interpreter) bool { return interpreter.Path == saved })
		installed = append([]python.Interpreter{{Path: saved, Source: "saved"}}, installed...)
	}
	report := PythonInterpreterReport{Installed: installed, Selected: python.ProjectInterpreter(root, directory), RequiresPython: python.RequiresPython(directory)}
	if session.Project.Authorization == AuthorizationPermitted {
		report.Installed = python.FlagIncompatible(python.ProbeInterpreters(report.Installed), report.RequiresPython)
		report.Probed = true
	}
	return report, nil
}

// SetPythonInterpreter sceglie l'interprete del progetto (unit == "") o di un'unità; una stringa
// vuota torna all'interpretazione automatica. La scelta è locale alla macchina: non finisce nei
// file di configurazione condivisi via Git.
func (s *Service) SetPythonInterpreter(sessionID, unit, path string) error {
	root, err := s.SessionRoot(sessionID)
	if err != nil {
		return err
	}
	directory, err := pythonEnvironmentDirectory(root, unit)
	if err != nil {
		return err
	}
	selection := directory
	if unit == "" {
		selection = ""
	}
	if err := python.SetProjectInterpreter(root, selection, path); err != nil {
		return err
	}
	return s.lsp.RefreshConfiguration(SessionID(sessionID), python.ID)
}

// pythonEnvironmentDirectory risolve la cartella dell'unità ("" = progetto) e la valida.
func pythonEnvironmentDirectory(root, unit string) (string, error) {
	if strings.TrimSpace(unit) == "" {
		return root, nil
	}
	if err := run.ValidateTarget(root, root, unit); err != nil {
		return "", err
	}
	directory := filepath.Join(root, filepath.FromSlash(unit))
	if info, err := os.Stat(directory); err != nil || !info.IsDir() {
		return "", fmt.Errorf("the project unit %q does not exist", unit)
	}
	return directory, nil
}

// pythonBaseInterpreter sceglie l'interprete con cui creare un ambiente: la scelta salvata se non
// vive già dentro l'ambiente dell'unità, altrimenti il primo Python del PATH.
func pythonBaseInterpreter(root, directory string) string {
	if selected, err := python.ResolveInterpreter(root, directory, ""); err == nil && !python.InsideEnvironment(directory, selected.Path) {
		return selected.Path
	}
	for _, candidate := range python.DiscoverInterpreters(root, directory) {
		if candidate.Source == "PATH" && candidate.Problem == "" {
			return candidate.Path
		}
	}
	return ""
}

// PythonEnvironment descrive l'ambiente dell'unità (unit == "" è il progetto) e le due azioni
// esplicite possibili: creare l'ambiente e installare le dipendenze. La lettura è statica.
func (s *Service) PythonEnvironment(sessionID, unit string) (python.EnvironmentPlan, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return python.EnvironmentPlan{}, err
	}
	root := session.Project.RealPath
	directory, err := pythonEnvironmentDirectory(root, unit)
	if err != nil {
		return python.EnvironmentPlan{}, err
	}
	return python.PlanEnvironment(root, directory, pythonBaseInterpreter(root, directory)), nil
}

// CreatePythonEnvironment crea `.venv` nell'unità con l'interprete scelto, solo su conferma e con
// il comando visibile (PY-2.3/2.4). Non sovrascrive un ambiente esistente e non scarica Python.
func (s *Service) CreatePythonEnvironment(sessionID, unit, interpreter string, confirmed bool) (Execution, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	if !confirmed {
		return Execution{}, fmt.Errorf("confirm the environment creation to continue")
	}
	root := session.Project.RealPath
	directory, err := pythonEnvironmentDirectory(root, unit)
	if err != nil {
		return Execution{}, err
	}
	base := strings.TrimSpace(interpreter)
	if base == "" {
		base = pythonBaseInterpreter(root, directory)
	}
	plan := python.PlanEnvironment(root, directory, base)
	return s.startEnvironmentCommand(session, directory, plan.Create, "the environment already exists in this folder")
}

// InstallPythonDependencies installa le dipendenze dichiarate nell'ambiente dell'unità, con il
// pip dell'ambiente: un solo percorso, nessun `uv run` o `poetry install` implicito.
func (s *Service) InstallPythonDependencies(sessionID, unit string, confirmed bool) (Execution, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	if !confirmed {
		return Execution{}, fmt.Errorf("confirm the dependency installation to continue")
	}
	root := session.Project.RealPath
	directory, err := pythonEnvironmentDirectory(root, unit)
	if err != nil {
		return Execution{}, err
	}
	plan := python.PlanEnvironment(root, directory, pythonBaseInterpreter(root, directory))
	return s.startEnvironmentCommand(session, directory, plan.Install, "there is no environment to install into")
}

// startEnvironmentCommand avvia un comando di gestione ambiente già validato dal piano.
func (s *Service) startEnvironmentCommand(session Session, directory string, command python.CommandPlan, fallbackReason string) (Execution, error) {
	if !command.Available {
		if command.Reason == "" {
			command.Reason = fallbackReason
		}
		return Execution{}, fmt.Errorf("%s", command.Reason)
	}
	// Ricontrollo indipendente dal piano, che è costruito dall'adapter: l'eseguibile deve restare
	// un interprete Python e la directory deve esistere (python.ValidatePlanCommand).
	if err := python.ValidatePlanCommand(command, directory); err != nil {
		return Execution{}, err
	}
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "install",
		Executable: command.Executable, Arguments: command.Arguments,
		WorkingDirectory: directory,
		Environment:      environmentWith(nil),
		DisplayCommand:   command.Command,
	})
}

// pythonInstallableTools sono gli strumenti che si installano nell'interprete scelto con un
// comando visibile e una versione pinnata (PY-8.3): niente `pip install` generico, nessuna
// installazione implicita prima di questo.
var pythonInstallableTools = map[string]string{
	"debugpy": "1.8.22",
	// Ruff è opzionale: si installa solo con questa azione esplicita e resta nell'interprete scelto.
	"ruff": python.RuffVersion,
}

// InstallPythonTool installa uno strumento Python nell'interprete scelto, solo su conferma
// esplicita: il comando completo è visibile prima di partire e viene eseguito come attività
// dell'IDE (niente installazioni silenziose, niente pip globale).
func (s *Service) InstallPythonTool(sessionID, interpreter, tool string, confirmed bool) (Execution, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	if !confirmed {
		return Execution{}, fmt.Errorf("confirm the installation to continue")
	}
	version, ok := pythonInstallableTools[strings.ToLower(strings.TrimSpace(tool))]
	if !ok {
		return Execution{}, fmt.Errorf("unknown Python tool %q", tool)
	}
	if strings.TrimSpace(interpreter) == "" {
		selected, err := python.ResolveInterpreter(session.Project.RealPath, session.Project.RealPath, "")
		if err != nil {
			return Execution{}, err
		}
		interpreter = selected.Path
	}
	arguments := []string{"-m", "pip", "install", tool + "==" + version}
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "install",
		Executable: interpreter, Arguments: arguments,
		WorkingDirectory: session.Project.RealPath,
		Environment:      environmentWith(nil),
		DisplayCommand:   strings.Join(append([]string{filepath.Base(interpreter)}, arguments...), " "),
	})
}

// PythonUnitDependencies è ciò che la vista delle dipendenze mostra per un'unità Python: il manifest
// che le dichiara, il lockfile riconosciuto e ogni dipendenza con vincolo e versione risolta.
type PythonUnitDependencies struct {
	// Unit è la cartella dell'unità relativa al progetto ("." per la radice).
	Unit string `json:"unit"`
	// Name è il nome leggibile dell'unità (pyproject o cartella).
	Name string `json:"name"`
	// Manager è "uv", "poetry" o "pip" quando il progetto dichiara un gestore.
	Manager string `json:"manager,omitempty"`
	// Lockfile è il lockfile che fornisce le versioni risolte ("" se assente).
	Lockfile     string                      `json:"lockfile,omitempty"`
	Dependencies []python.DeclaredDependency `json:"dependencies"`
}

// PythonDependencies elenca le dipendenze dichiarate dalle unità Python del progetto, con le
// versioni risolte dal lockfile: la stessa vista che Go e Maven hanno nel dialog delle dipendenze.
// Lettura statica dei manifest, nessun processo e nessuna installazione.
func (s *Service) PythonDependencies(sessionID string) ([]PythonUnitDependencies, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	units := make([]PythonUnitDependencies, 0, 2)
	for _, unit := range session.Project.Units {
		if unit.Language != python.ID {
			continue
		}
		manager, lockfile := python.DetectEnvironmentManager(unit.Root)
		relative, err := filepath.Rel(session.Project.RealPath, unit.Root)
		if err != nil || relative == "" {
			relative = "."
		}
		units = append(units, PythonUnitDependencies{
			Unit:         filepath.ToSlash(relative),
			Name:         python.UnitName(unit),
			Manager:      manager,
			Lockfile:     lockfile,
			Dependencies: python.DeclaredDependencies(unit.Root),
		})
	}
	return units, nil
}
