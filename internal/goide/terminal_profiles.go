package goide

import (
	"fmt"
	"sync"
)

// TerminalProfile è una shell rilevata sulla macchina (PowerShell, Git Bash, una distro WSL, zsh…).
type TerminalProfile struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Shell     string   `json:"shell"`
	Arguments []string `json:"arguments,omitempty"`
}

var (
	terminalProfilesMu     sync.Mutex
	terminalProfilesCached []TerminalProfile
)

// ListTerminalProfiles rileva di nuovo le shell disponibili; la prima è quella predefinita.
func ListTerminalProfiles() []TerminalProfile {
	profiles := detectTerminalProfiles()
	terminalProfilesMu.Lock()
	terminalProfilesCached = profiles
	terminalProfilesMu.Unlock()
	return append([]TerminalProfile(nil), profiles...)
}

// resolveTerminalProfile restituisce shell e argomenti del profilo ("" = predefinito).
// Il frontend sceglie solo fra profili rilevati: non può avviare un eseguibile arbitrario.
func resolveTerminalProfile(id string) (TerminalProfile, error) {
	terminalProfilesMu.Lock()
	profiles := terminalProfilesCached
	terminalProfilesMu.Unlock()
	if profiles == nil {
		profiles = ListTerminalProfiles()
	}
	if len(profiles) == 0 {
		return TerminalProfile{}, fmt.Errorf("nessuna shell disponibile su questa piattaforma")
	}
	if id == "" {
		return profiles[0], nil
	}
	for _, profile := range profiles {
		if profile.ID == id {
			return profile, nil
		}
	}
	return TerminalProfile{}, fmt.Errorf("profilo terminale %q non disponibile", id)
}
