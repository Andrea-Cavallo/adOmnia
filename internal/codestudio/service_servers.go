package codestudio

import (
	"fmt"

	"adomnia/internal/ide/language"
	"adomnia/internal/ide/lsp"
)

// Language server gestiti da adOmnia (web, Java, …): localizzazione, installazione e ciclo di vita
// sono uguali per ogni linguaggio che implementa lsp.ServerProvider; qui non c'è codice per linguaggio.

type (
	// LanguageServerInfo descrive la disponibilità del server di un linguaggio.
	LanguageServerInfo = lsp.ServerInfo
	// ServerInstallPreview è ciò che la UI mostra prima di chiedere conferma: il comando esatto.
	ServerInstallPreview = lsp.InstallPlan
)

func (s *Service) serverProvider(languageID string) (lsp.ServerProvider, error) {
	adapter, ok := s.workspace.languages.Get(languageID)
	if !ok {
		return nil, fmt.Errorf("unknown language %q", languageID)
	}
	provider, ok := adapter.(language.ServerProvider)
	if !ok {
		return nil, fmt.Errorf("%s has no managed language server", adapter.Name())
	}
	return provider, nil
}

func (s *Service) locateServer(session Session, provider lsp.ServerProvider) LanguageServerInfo {
	info := provider.LocateServer(session.Project.RealPath, s.toolsRoot)
	if perUnit, ok := provider.(language.UnitServers); ok && perUnit.ServersPerUnit() && !info.Available {
		for _, unit := range session.Project.Units {
			if unit.Language == info.Language {
				if candidate := provider.LocateServer(unit.Root, s.toolsRoot); candidate.Available {
					info = candidate
					break
				}
			}
		}
	}
	if !info.Available {
		_, err := provider.InstallPlan(s.toolsRoot)
		info.Installable = err == nil
	}
	return info
}

func (s *Service) providedServers(session Session, languageIDs []string) []LanguageServerInfo {
	servers := make([]LanguageServerInfo, 0, len(languageIDs))
	for _, id := range languageIDs {
		if provider, err := s.serverProvider(id); err == nil {
			servers = append(servers, s.locateServer(session, provider))
		}
	}
	return servers
}

// ProvidedLanguageServers restituisce la disponibilità dei server gestiti di tutti i linguaggi registrati.
func (s *Service) ProvidedLanguageServers(sessionID string) ([]LanguageServerInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, adapter := range s.workspace.languages.All() {
		if _, ok := adapter.(language.ServerProvider); ok {
			ids = append(ids, adapter.ID())
		}
	}
	return s.providedServers(session, ids), nil
}

// StartProvidedLanguageServer avvia il server di un linguaggio per un progetto autorizzato. Se manca
// l'errore lo dice: l'editor continua con le funzioni di Monaco.
func (s *Service) StartProvidedLanguageServer(sessionID, languageID string) (LanguageServerStatus, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return LanguageServerStatus{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return LanguageServerStatus{}, fmt.Errorf("trust the project before starting a language server")
	}
	provider, err := s.serverProvider(languageID)
	if err != nil {
		return LanguageServerStatus{}, err
	}
	spec := lsp.ServerSpec{Language: languageID}
	if factory := s.perUnitSpec(languageID, session.Project.RealPath); factory != nil {
		spec.PerUnitSpec = factory
	} else {
		spec, err = provider.ServerSpec(session.Project.RealPath, s.toolsRoot)
		if err != nil {
			return LanguageServerStatus{}, err
		}
	}
	s.trackLanguageDocuments(session, languageID)
	return s.lsp.Start(session, spec)
}

// perUnitSpec restituisce la factory con cui l'host avvia un server per ogni unità del linguaggio,
// o nil se il linguaggio ne vuole uno solo per progetto. È l'unico punto in cui il core decide: la
// risposta viene dall'adapter (language.UnitServers), mai da un elenco di linguaggi qui dentro.
func (s *Service) perUnitSpec(languageID, projectRoot string) func(string) (lsp.ServerSpec, error) {
	adapter, ok := s.workspace.languages.Get(languageID)
	if !ok {
		return nil
	}
	perUnit, ok := adapter.(language.UnitServers)
	if !ok || !perUnit.ServersPerUnit() {
		return nil
	}
	return func(root string) (lsp.ServerSpec, error) {
		return perUnit.UnitServerSpec(projectRoot, root, s.toolsRoot)
	}
}

// StopProvidedLanguageServer ferma il server gestito del linguaggio.
func (s *Service) StopProvidedLanguageServer(sessionID, languageID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	s.lsp.Stop(SessionID(sessionID), languageID)
	return nil
}

// ProvidedLanguageServerStatus restituisce lo stato del server gestito del linguaggio.
func (s *Service) ProvidedLanguageServerStatus(sessionID, languageID string) (LanguageServerStatus, error) {
	if _, err := s.session(sessionID); err != nil {
		return LanguageServerStatus{}, err
	}
	return s.lsp.Status(SessionID(sessionID), languageID), nil
}

// PreviewServerInstall dice cosa farebbe l'installazione (comando incluso), senza eseguire nulla.
func (s *Service) PreviewServerInstall(sessionID, languageID string) (ServerInstallPreview, error) {
	if _, err := s.session(sessionID); err != nil {
		return ServerInstallPreview{}, err
	}
	provider, err := s.serverProvider(languageID)
	if err != nil {
		return ServerInstallPreview{}, err
	}
	return provider.InstallPlan(s.toolsRoot)
}

// InstallProvidedLanguageServer installa il server nella cartella strumenti di adOmnia (mai nel
// progetto), solo dopo conferma esplicita. Il comando gira nella console Run, visibile.
func (s *Service) InstallProvidedLanguageServer(sessionID, languageID string, confirmed bool) (Execution, error) {
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
	plan, err := s.PreviewServerInstall(sessionID, languageID)
	if err != nil {
		return Execution{}, err
	}
	return s.runInstallPlan(session, plan)
}

// runInstallPlan esegue un'installazione già confermata, nella console Run e senza shell dell'utente.
func (s *Service) runInstallPlan(session Session, plan ServerInstallPreview) (Execution, error) {
	if plan.Prepare != nil {
		if err := plan.Prepare(); err != nil {
			return Execution{}, fmt.Errorf("could not prepare the tools folder: %w", err)
		}
	}
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "install", Executable: plan.Executable, Arguments: plan.Arguments,
		WorkingDirectory: plan.Directory, Environment: environmentWith(nil), DisplayCommand: plan.Command,
	})
}
