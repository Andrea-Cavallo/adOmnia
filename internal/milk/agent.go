package milk

import (
	"errors"
	"fmt"
)

// Agent descrive l'agente ACP ospitato da un Manager. milk è il primo; Claude Code
// (internal/claudecode) riusa lo stesso client: processo, sessioni, chat e permessi.
type Agent struct {
	// Name compare nei messaggi per l'utente ("milk", "Claude Code").
	Name string
	// Event è il prefisso degli eventi frontend: <Event>.status, <Event>.chat, …
	Event string
	// Protocol è la protocolVersion ACP: 2 = dialetto milk, 1 = ACP standard.
	Protocol int
	// Resolve trova il comando da avviare. Errori: ErrNotInstalled o ErrOutdated
	// (anche avvolti) diventano gli stati omonimi; Launch resta valorizzato quanto possibile.
	Resolve func(Settings) (Launch, error)
}

// Launch è il comando che avvia l'agente in modalità ACP su stdio.
type Launch struct {
	Binary  string
	Args    []string
	Version string
	// Env sostituisce l'ambiente del processo; nil eredita quello di adOmnia.
	Env []string
}

// ErrOutdated indica un agente installato ma troppo vecchio per gO Studio.
var ErrOutdated = errors.New("agent is outdated")

// userError porta un messaggio per l'utente e risponde a errors.Is con il sentinel.
type userError struct {
	message  string
	sentinel error
}

func (e userError) Error() string        { return e.message }
func (e userError) Is(target error) bool { return target == e.sentinel }

// NotInstalled crea un errore leggibile che vale ErrNotInstalled.
func NotInstalled(message string) error { return userError{message, ErrNotInstalled} }

// Outdated crea un errore leggibile che vale ErrOutdated.
func Outdated(message string) error { return userError{message, ErrOutdated} }

// MilkAgent è milk (`milk serve --acp`).
func MilkAgent() Agent {
	return Agent{Name: "milk", Event: "milk", Protocol: 2, Resolve: resolveMilk}
}

func resolveMilk(settings Settings) (Launch, error) {
	binary, err := resolveBinary(settings)
	if err != nil {
		return Launch{}, err
	}
	launch := Launch{Binary: binary, Args: []string{"serve", "--acp"}}
	version, err := installedVersion(binary)
	if err == nil {
		launch.Version = version
		if !versionAtLeast(version, MinVersion) {
			return launch, Outdated(fmt.Sprintf("milk %s is too old: gO Studio needs v%s or later (milk serve --acp). Update it from milk settings", version, MinVersion))
		}
	}
	return launch, nil
}
