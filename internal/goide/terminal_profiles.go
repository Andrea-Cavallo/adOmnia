package goide

import (
	"fmt"
	"sync"
	"time"
	"unicode/utf16"
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
	terminalProfilesAt     time.Time
)

// terminalProfilesTTL: le shell installate cambiano di rado, mentre `wsl -l -q` costa centinaia di ms.
const terminalProfilesTTL = 5 * time.Minute

// ListTerminalProfiles restituisce le shell disponibili (la prima è la predefinita), rilevandole
// di nuovo solo se l'ultimo rilevamento è più vecchio di terminalProfilesTTL.
func ListTerminalProfiles() []TerminalProfile {
	terminalProfilesMu.Lock()
	if terminalProfilesCached != nil && time.Since(terminalProfilesAt) < terminalProfilesTTL {
		profiles := append([]TerminalProfile(nil), terminalProfilesCached...)
		terminalProfilesMu.Unlock()
		return profiles
	}
	terminalProfilesMu.Unlock()
	profiles := detectTerminalProfiles()
	terminalProfilesMu.Lock()
	terminalProfilesCached, terminalProfilesAt = profiles, time.Now()
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

// decodeWSLOutput converte l'output UTF-16LE di `wsl -l` in stringa; fuori da Windows serve solo ai test.
func decodeWSLOutput(output []byte) string {
	if len(output) < 2 || len(output)%2 != 0 || output[1] != 0 && !(output[0] == 0xff && output[1] == 0xfe) {
		return string(output) // WSL_UTF8=1 o versioni che scrivono già UTF-8
	}
	units := make([]uint16, 0, len(output)/2)
	for i := 0; i+1 < len(output); i += 2 {
		units = append(units, uint16(output[i])|uint16(output[i+1])<<8)
	}
	return string(utf16.Decode(units))
}
