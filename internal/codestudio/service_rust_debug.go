package codestudio

import (
	"fmt"

	"adomnia/internal/ide/dap"
	"adomnia/internal/jsonutil"
	"adomnia/internal/languages/rust"
)

// RustDebugRequest chiede il debug di un bin o di un example Cargo, con gli stessi target e opzioni
// di build della Run. CodeLLDB deve essere installato (azione esplicita, mai in automatico).
type RustDebugRequest struct {
	SessionID         SessionID         `json:"sessionId"`
	Package           string            `json:"package,omitempty"`
	Bin               string            `json:"bin,omitempty"`
	Example           string            `json:"example,omitempty"`
	Source            string            `json:"source,omitempty"`
	// Test è il singolo test da debuggare (RS-5.5): con Test valorizzato si compila l'eseguibile
	// del test (`cargo test --no-run`) e non un bin/example.
	Test              string            `json:"test,omitempty"`
	// TestFile è il sorgente del test relativo al crate: sceglie il target di test senza indovinare.
	TestFile          string            `json:"testFile,omitempty"`
	Features         []string          `json:"features,omitempty"`
	AllFeatures       bool              `json:"allFeatures,omitzero"`
	NoDefaultFeatures bool              `json:"noDefaultFeatures,omitzero"`
	Profile           string            `json:"profile,omitempty"`
	Target            string            `json:"target,omitempty"`
	Toolchain         string            `json:"toolchain,omitempty"`
	WorkingDirectory  string            `json:"workingDirectory,omitempty"`
	ProgramArguments  []string          `json:"programArguments,omitempty"`
	Environment       map[string]string `json:"environment,omitempty"`
}

// StartRustDebug avvia il debug Rust per un progetto autorizzato, su azione esplicita: la build
// esegue build.rs e proc-macro del progetto, quindi richiede lo stesso consenso della Run.
func (s *Service) StartRustDebug(request RustDebugRequest) (DebugSessionInfo, error) {
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
	environment, err := s.executionEnvironment(session.ID, rust.ID, request.Environment)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	// L'installazione gestita si usa solo se verificata (RS-9.4): se il manifest non torna,
	// l'errore dice di reinstallare invece di eseguire una cartella modificata.
	adapter, _, adapterWarning := rust.LocateCodeLLDB(s.toolsRoot)
	if adapter == "" && adapterWarning != nil {
		return DebugSessionInfo{}, adapterWarning
	}
	options, err := jsonutil.Marshal(rust.DebugOptions{
		Toolchain: request.Toolchain, Package: request.Package, Bin: request.Bin, Example: request.Example, Source: request.Source,
		Test: request.Test, TestFile: request.TestFile,
		ProgramArguments: request.ProgramArguments, Features: request.Features,
		AllFeatures: request.AllFeatures, NoDefaultFeatures: request.NoDefaultFeatures,
		Profile: request.Profile, Target: request.Target, Adapter: adapter,
	})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	spec, err := rust.New().DebugAdapter(dap.LaunchRequest{
		Root: session.Project.RealPath, WorkingDirectory: workingDirectory,
		Environment: environment, LanguageOptions: options,
	})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	s.seedBreakpoints(session)
	return s.debug.DebugManager.Start(dap.Launch{SessionID: session.ID, Root: session.Project.RealPath, Spec: spec})
}

// PreviewRustDebuggerInstall dice cosa farebbe l'installazione di CodeLLDB (comando incluso).
func (s *Service) PreviewRustDebuggerInstall(sessionID string) (ServerInstallPreview, error) {
	if _, err := s.session(sessionID); err != nil {
		return ServerInstallPreview{}, err
	}
	return rust.CodeLLDBInstallPlan(s.toolsRoot)
}

// InstallRustDebugger scarica CodeLLDB (release pinnata, SHA-256 verificato) nella cartella
// strumenti di adOmnia, solo dopo conferma esplicita; il comando gira nella console Run.
func (s *Service) InstallRustDebugger(sessionID string, confirmed bool) (Execution, error) {
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
	plan, err := rust.CodeLLDBInstallPlan(s.toolsRoot)
	if err != nil {
		return Execution{}, err
	}
	return s.runInstallPlan(session, plan)
}
