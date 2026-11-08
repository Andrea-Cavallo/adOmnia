package codestudio

import (
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

// PreviewTestRunnerInstall is the exact command that would install a language's test runner (the JUnit
// Console Launcher for Ant and Eclipse projects), shown in the confirmation.
func (s *Service) PreviewTestRunnerInstall(sessionID, languageID string) (ServerInstallPreview, error) {
	if _, err := s.session(sessionID); err != nil {
		return ServerInstallPreview{}, err
	}
	return s.testRunnerInstallPlan(languageID)
}

// InstallTestRunner downloads the test runner into adOmnia's tools folder after explicit confirmation; the
// command runs in the Run console, visible, and never touches the project.
func (s *Service) InstallTestRunner(sessionID, languageID string, confirmed bool) (Execution, error) {
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
	plan, err := s.testRunnerInstallPlan(languageID)
	if err != nil {
		return Execution{}, err
	}
	return s.runInstallPlan(session, plan)
}

func (s *Service) testRunnerInstallPlan(languageID string) (lsp.InstallPlan, error) {
	adapter, ok := s.workspace.languages.Get(languageID)
	if !ok {
		return lsp.InstallPlan{}, fmt.Errorf("language not registered: %s", languageID)
	}
	installer, ok := adapter.(language.TestRunnerInstaller)
	if !ok {
		return lsp.InstallPlan{}, fmt.Errorf("%s has no test runner to install", languageID)
	}
	return installer.TestRunnerInstallPlan(s.toolsRoot)
}
