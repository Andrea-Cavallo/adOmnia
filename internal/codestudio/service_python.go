package codestudio

import (
	"fmt"
	"path/filepath"
	"strings"

	"adomnia/internal/languages/python"
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
// pytest/debugpy/basedpyright presenti). Nessun ambiente viene installato o modificato.
func (s *Service) PythonInterpreters(sessionID string) (PythonInterpreterReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return PythonInterpreterReport{}, err
	}
	root := session.Project.RealPath
	installed := python.DiscoverInterpreters(root, root)
	if saved := python.ProjectInterpreter(root, ""); saved != "" {
		installed = append([]python.Interpreter{{Path: saved, Source: "saved"}}, installed...)
	}
	report := PythonInterpreterReport{Installed: installed, Selected: python.ProjectInterpreter(root, "")}
	if session.Project.Authorization == AuthorizationPermitted {
		report.Installed = python.ProbeInterpreters(report.Installed)
		report.Probed = true
	}
	for _, unit := range session.Project.Units {
		if unit.Language != python.ID {
			continue
		}
		if constraint := python.RequiresPython(unit.Root); constraint != "" {
			report.RequiresPython = constraint
		}
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
	return python.SetProjectInterpreter(root, unit, path)
}

// pythonInstallableTools sono gli strumenti che si installano nell'interprete scelto con un
// comando visibile e una versione pinnata (PY-8.3): niente `pip install` generico, nessuna
// installazione implicita prima di questo.
var pythonInstallableTools = map[string]string{
	"debugpy": "1.8.22",
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
		Environment:   environmentWith(nil),
		DisplayCommand: strings.Join(append([]string{filepath.Base(interpreter)}, arguments...), " "),
	})
}
