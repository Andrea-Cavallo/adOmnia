package codestudio

import (
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/rust"
)

// PreviewDebuggerInstall shows the exact command that would install the debugger of languageID:
// the adapter's own plan (PHP, a pinned VSIX) or CodeLLDB for the native rows that debug with LLDB.
func (s *Service) PreviewDebuggerInstall(sessionID, languageID string) (ServerInstallPreview, error) {
	if _, err := s.session(sessionID); err != nil {
		return ServerInstallPreview{}, err
	}
	return s.debuggerInstallPlan(languageID)
}

// InstallDebugger downloads the debugger into adOmnia's tools folder after explicit confirmation;
// the command runs in the Run console, visible, and never modifies the project or global tools.
func (s *Service) InstallDebugger(sessionID, languageID string, confirmed bool) (Execution, error) {
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
	plan, err := s.debuggerInstallPlan(languageID)
	if err != nil {
		return Execution{}, err
	}
	return s.runInstallPlan(session, plan)
}

func (s *Service) debuggerInstallPlan(languageID string) (lsp.InstallPlan, error) {
	adapter, ok := s.workspace.languages.Get(languageID)
	if !ok {
		return lsp.InstallPlan{}, fmt.Errorf("language not registered: %s", languageID)
	}
	// The adapter's own plan (PHP today). A script row without one keeps its own explanation.
	if installer, ok := adapter.(language.DebuggerInstaller); ok {
		if plan, installErr := installer.DebuggerInstallPlan(s.toolsRoot); installErr == nil {
			return plan, nil
		} else if _, native := adapter.(language.NativeLLDBDebugger); !native {
			return lsp.InstallPlan{}, installErr
		}
	}
	// Native rows debug with CodeLLDB (preferred) or lldb-dap on PATH: install the pinned CodeLLDB.
	if lldb, ok := adapter.(language.NativeLLDBDebugger); ok && lldb.UsesLLDB() {
		return rust.CodeLLDBInstallPlan(s.toolsRoot)
	}
	return lsp.InstallPlan{}, fmt.Errorf("%s has no installable debugger", languageID)
}
