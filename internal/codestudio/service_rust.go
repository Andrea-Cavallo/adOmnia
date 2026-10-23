package codestudio

import (
	"fmt"

	"adomnia/internal/languages/rust"
)

// RustToolchainReport è ciò che serve a scegliere la toolchain Rust: i candidati con la loro
// origine, la scelta corrente e — solo con il progetto autorizzato — versione e host dal probe.
type RustToolchainReport struct {
	Installed []rust.Toolchain `json:"installed"`
	// Selected è il cargo scelto per il progetto ("" = automatico).
	Selected string `json:"selected"`
	// Probed dice se versione e host sono stati verificati eseguendo rustc.
	Probed bool `json:"probed"`
	// Channel è il canale dichiarato dal progetto (rust-toolchain.toml), "" se non c'è.
	Channel string `json:"channel,omitempty"`
}

// RustToolchains elenca le toolchain candidate del progetto (RS-2.4). La scoperta è statica; con
// il progetto autorizzato ogni candidato viene sondato con `rustc -vV` (versione + host).
func (s *Service) RustToolchains(sessionID string) (RustToolchainReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return RustToolchainReport{}, err
	}
	root := session.Project.RealPath
	installed := rust.DiscoverToolchains(root, root)
	if saved := rust.ProjectToolchain(root, ""); saved != "" {
		filtered := installed[:0]
		for _, candidate := range installed {
			if candidate.Cargo != saved {
				filtered = append(filtered, candidate)
			}
		}
		installed = append([]rust.Toolchain{{Cargo: saved, Source: "saved"}}, filtered...)
	}
	report := RustToolchainReport{
		Installed: installed,
		Selected:  rust.ProjectToolchain(root, ""),
		Channel:   rust.ToolchainChannel(root, root),
	}
	if session.Project.Authorization == AuthorizationPermitted {
		report.Installed = rust.ProbeToolchains(report.Installed)
		report.Probed = true
	}
	return report, nil
}

// SetRustToolchain sceglie il cargo del progetto; una stringa vuota torna all'automatico. La scelta
// è locale alla macchina (`.adomnia/rust.local.json`, non condivisa via Git) e alimenta Run, Test,
// Debug e rust-analyzer.
func (s *Service) SetRustToolchain(sessionID, path string) error {
	root, err := s.SessionRoot(sessionID)
	if err != nil {
		return err
	}
	if err := rust.SetProjectToolchain(root, "", path); err != nil {
		return err
	}
	return s.lsp.RefreshConfiguration(SessionID(sessionID), rust.ID)
}

// SetRustLowResources è l'opzione "Low resources" del server Rust (RS-9.5): disattiva proc-macro e
// build script di rust-analyzer (la parte più pesante) senza toccare l'editor né la Run; il cambio
// arriva al server con workspace/didChangeConfiguration, senza riavvio. La scelta persiste in
// `.adomnia/rust.local.json` come la toolchain.
func (s *Service) SetRustLowResources(sessionID string, enabled bool) error {
	root, err := s.SessionRoot(sessionID)
	if err != nil {
		return err
	}
	if err := rust.SetProjectLowResources(root, enabled); err != nil {
		return err
	}
	return s.lsp.RefreshConfiguration(SessionID(sessionID), rust.ID)
}

// RustDependencyTree è l'albero delle dipendenze dal Cargo.lock (formato TOML stabile, offline,
// nessuna esecuzione): i duplicati di versione sono in evidenza (RS-8.2). `cargo tree` resta
// l'azione esplicita per la risoluzione esatta.
func (s *Service) RustDependencyTree(sessionID string) ([]rust.CargoTreeNode, error) {
	root, err := s.SessionRoot(sessionID)
	if err != nil {
		return nil, err
	}
	return rust.CargoLockTree(root)
}

// PreviewRustComponentInstall dice cosa farebbe l'installazione di un componente rustup (RS-2.3).
func (s *Service) PreviewRustComponentInstall(sessionID, component string) (ServerInstallPreview, error) {
	if _, err := s.session(sessionID); err != nil {
		return ServerInstallPreview{}, err
	}
	return rust.New().ComponentInstallPlan(component)
}

// InstallRustComponent installa un componente rustup (es. rust-src, clippy), solo dopo conferma
// esplicita; il comando gira nella console Run come attività dell'IDE.
func (s *Service) InstallRustComponent(sessionID, component string, confirmed bool) (Execution, error) {
	if !confirmed {
		return Execution{}, fmt.Errorf("explicit confirmation required before installing tools")
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("trust the project before installing tools")
	}
	plan, err := rust.New().ComponentInstallPlan(component)
	if err != nil {
		return Execution{}, err
	}
	return s.runInstallPlan(session, plan)
}

// PreviewRustToolchainInstall dice cosa farebbe l'installazione di un canale rustup (RS-2.3).
func (s *Service) PreviewRustToolchainInstall(sessionID, channel string) (ServerInstallPreview, error) {
	if _, err := s.session(sessionID); err != nil {
		return ServerInstallPreview{}, err
	}
	return rust.New().ToolchainInstallPlan(channel)
}

// InstallRustToolchain installa un canale rustup (es. 1.85.0), solo dopo conferma esplicita; non
// cambia mai il default della macchina.
func (s *Service) InstallRustToolchain(sessionID, channel string, confirmed bool) (Execution, error) {
	if !confirmed {
		return Execution{}, fmt.Errorf("explicit confirmation required before installing tools")
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("trust the project before installing tools")
	}
	plan, err := rust.New().ToolchainInstallPlan(channel)
	if err != nil {
		return Execution{}, err
	}
	return s.runInstallPlan(session, plan)
}
