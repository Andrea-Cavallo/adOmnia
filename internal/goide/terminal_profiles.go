package goide

import (
	"context"
	"fmt"
	"os/exec"
	"sync"
	"time"

	"adomnia/internal/ide/remote"
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
	profiles := append(detectTerminalProfiles(), remoteTerminalProfiles()...)
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

// remoteTerminalProfiles aggiunge un terminale per ogni host di ~/.ssh/config e ogni container in esecuzione.
func remoteTerminalProfiles() []TerminalProfile {
	var profiles []TerminalProfile
	if ssh, err := exec.LookPath("ssh"); err == nil {
		for _, host := range remote.SSHHosts() {
			profiles = append(profiles, TerminalProfile{ID: "ssh:" + host, Name: host + " (SSH)", Kind: "ssh", Shell: ssh, Arguments: []string{host}})
		}
	}
	if docker, err := exec.LookPath("docker"); err == nil {
		for _, container := range remote.Containers(context.Background()) {
			profiles = append(profiles, TerminalProfile{ID: "container:" + container, Name: container + " (container)", Kind: "container", Shell: docker,
				Arguments: []string{"exec", "-it", container, "sh", "-c", "command -v bash >/dev/null && exec bash || exec sh"}})
		}
	}
	return profiles
}
