package codestudio

import (
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/python"
)

// PythonDebugRequest chiede il debug di uno script, di un modulo o di test pytest, con gli stessi
// target della Run. Il programma è il debuggee: debugpy deve essere installato nel suo interprete
// e nessun ambiente viene modificato in automatico.
type PythonDebugRequest struct {
	SessionID SessionID `json:"sessionId"`
	// Kind è "script", "module" o "pytest".
	Kind             string            `json:"kind"`
	Script           string            `json:"script,omitempty"`
	Module           string            `json:"module,omitempty"`
	App              string            `json:"app,omitempty"`
	Host             string            `json:"host,omitempty"`
	Port             int               `json:"port,omitzero"`
	Reload           bool              `json:"reload,omitzero"`
	Targets          []string          `json:"targets,omitempty"`
	Run              string            `json:"run,omitempty"`
	WorkingDirectory string            `json:"workingDirectory,omitempty"`
	ProgramArguments []string          `json:"programArguments,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
	Interpreter      string            `json:"interpreter,omitempty"`
	JustMyCode       *bool             `json:"justMyCode,omitempty"`
}

// StartPythonDebug avvia il debug Python per un progetto autorizzato, su azione esplicita:
// breakpoint, step, variabili e valutazione sono quelli di ogni altro linguaggio.
func (s *Service) StartPythonDebug(request PythonDebugRequest) (DebugSessionInfo, error) {
	session, err := s.session(string(request.SessionID))
	if err != nil {
		return DebugSessionInfo{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return DebugSessionInfo{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	workingDirectory, err := s.documents.resolveDirectory(session.Project, request.WorkingDirectory)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	environment, err := s.executionEnvironment(session.ID, python.ID, request.Environment)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	options, err := jsonutil.Marshal(python.DebugOptions{
		Interpreter: request.Interpreter, Kind: request.Kind,
		Script: request.Script, Module: request.Module,
		App: request.App, Host: request.Host, Port: request.Port, Reload: request.Reload,
		Targets: request.Targets, Run: request.Run,
		ProgramArguments: request.ProgramArguments,
		JustMyCode:       request.JustMyCode,
	})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	spec, err := python.New().DebugAdapter(dap.LaunchRequest{
		Root: session.Project.RealPath, WorkingDirectory: workingDirectory,
		Environment: environment, LanguageOptions: options,
	})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	s.seedBreakpoints(session)
	return s.debug.DebugManager.Start(dap.Launch{SessionID: session.ID, Root: session.Project.RealPath, Spec: spec})
}
