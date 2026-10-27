package codestudio

import (
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/web"
)

// WebDebugRequest chiede il debug di un file JavaScript/TypeScript oppure di un comando del package
// manager (lo stesso della Run, es. `npm run dev`). js-debug deve essere installato in modo esplicito
// dalla cartella strumenti di adOmnia: nessun download automatico, nessuna modifica del progetto.
type WebDebugRequest struct {
	SessionID SessionID `json:"sessionId"`
	// Kind è "script" (file del progetto) o "command" (script del package manager).
	Kind string `json:"kind"`
	// Program è il file da eseguire, relativo alla working directory (solo kind "script").
	Program string `json:"program,omitempty"`
	// RuntimeExecutable e RuntimeArgs sono il comando della Run (solo kind "command").
	RuntimeExecutable string            `json:"runtimeExecutable,omitempty"`
	RuntimeArgs       []string          `json:"runtimeArgs,omitempty"`
	ProgramArguments  []string          `json:"programArguments,omitempty"`
	WorkingDirectory  string            `json:"workingDirectory,omitempty"`
	Environment       map[string]string `json:"environment,omitempty"`
	Node              string            `json:"node,omitempty"`
}

// StartWebDebug avvia il debug JS/TS per un progetto autorizzato, su azione esplicita: il programma
// (o il comando del package manager) parte come figlio di js-debug, quindi richiede lo stesso
// consenso della Run.
func (s *Service) StartWebDebug(request WebDebugRequest) (DebugSessionInfo, error) {
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
	environment, err := s.executionEnvironment(session.ID, web.ScriptID, request.Environment)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	// L'installazione gestita si usa solo se verificata: se il manifest non torna, l'errore dice
	// di reinstallare invece di eseguire una cartella modificata.
	adapter, _, adapterWarning := web.LocateJSDebug(s.toolsRoot)
	if adapter == "" {
		if adapterWarning != nil {
			return DebugSessionInfo{}, adapterWarning
		}
		return DebugSessionInfo{}, fmt.Errorf("the JavaScript debugger (js-debug) is not installed: install it from the editor notice")
	}
	options, err := jsonutil.Marshal(web.DebugOptions{
		Kind: request.Kind, Program: request.Program,
		RuntimeExecutable: request.RuntimeExecutable, RuntimeArgs: request.RuntimeArgs,
		ProgramArguments: request.ProgramArguments, Node: request.Node, Adapter: adapter,
	})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	debugAdapter, ok := web.ScriptLanguage().(dap.DebugAdapterProvider)
	if !ok {
		return DebugSessionInfo{}, fmt.Errorf("this build cannot debug JavaScript/TypeScript")
	}
	spec, err := debugAdapter.DebugAdapter(dap.LaunchRequest{
		Root: session.Project.RealPath, WorkingDirectory: workingDirectory,
		Environment: environment, LanguageOptions: options,
	})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	s.seedBreakpoints(session)
	return s.debug.DebugManager.Start(dap.Launch{SessionID: session.ID, Root: session.Project.RealPath, Spec: spec})
}

// PreviewWebDebuggerInstall dice cosa farebbe l'installazione di js-debug (comando incluso).
func (s *Service) PreviewWebDebuggerInstall(sessionID string) (ServerInstallPreview, error) {
	if _, err := s.session(sessionID); err != nil {
		return ServerInstallPreview{}, err
	}
	return web.JSDebugInstallPlan(s.toolsRoot)
}

// InstallWebDebugger scarica js-debug (release pinnata, SHA-256 verificato) nella cartella strumenti
// di adOmnia, solo dopo conferma esplicita; il comando gira nella console Run.
func (s *Service) InstallWebDebugger(sessionID string, confirmed bool) (Execution, error) {
	if !confirmed {
		return Execution{}, fmt.Errorf("explicit confirmation required before downloading the tools")
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("trust the project before installing tools")
	}
	plan, err := web.JSDebugInstallPlan(s.toolsRoot)
	if err != nil {
		return Execution{}, err
	}
	return s.runInstallPlan(session, plan)
}
