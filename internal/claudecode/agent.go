// Package claudecode collega Claude Code a gO Studio come agente ACP. Il client
// (processo, sessioni, chat, permessi) è quello di milk: qui c'è solo come avviarlo.
package claudecode

import (
	"os"
	"os/exec"
	"strings"

	"adomnia/internal/milk"
)

// AdapterPackage è l'adapter ACP ufficiale di Claude Code, avviato con npx quando
// `claude-agent-acp` non è nel PATH.
// ponytail: versione fissa per avvii offline dalla cache di npx; aggiornala con le release.
const AdapterPackage = "@agentclientprotocol/claude-agent-acp@0.89.1"

// apiKeyVar fa preferire all'adapter la chiave API al login dell'abbonamento.
const apiKeyVar = "ANTHROPIC_API_KEY"

// Agent descrive Claude Code per milk.Manager.
func Agent() milk.Agent {
	return milk.Agent{Name: "Claude Code", Event: "claude", Protocol: 1, Resolve: resolve, ProjectScoped: true}
}

func resolve(settings milk.Settings, root string) (milk.Launch, error) {
	launch, err := command(settings, exec.LookPath)
	if err != nil {
		return launch, err
	}
	env := os.Environ()
	if settings.IgnoreAPIKey {
		env = withoutVar(env, apiKeyVar)
	}
	lifted := liftedEnv(root, os.Getenv)
	for _, name := range adapterEnvVars {
		if value, ok := lifted[name]; ok {
			env = append(withoutVar(env, name), name+"="+value)
			launch.Key += name + "=" + value + ";"
		}
	}
	launch.Env = env
	return launch, nil
}

// command sceglie, in ordine: percorso dalle impostazioni, adapter nel PATH, npx.
func command(settings milk.Settings, lookPath func(string) (string, error)) (milk.Launch, error) {
	if settings.BinaryPath != "" {
		if info, err := os.Stat(settings.BinaryPath); err != nil || info.IsDir() {
			return milk.Launch{}, milk.NotInstalled("Claude Code adapter not found at " + settings.BinaryPath)
		}
		return milk.Launch{Binary: settings.BinaryPath}, nil
	}
	if path, err := lookPath("claude-agent-acp"); err == nil {
		return milk.Launch{Binary: path}, nil
	}
	npx, err := lookPath("npx")
	if err != nil {
		return milk.Launch{}, milk.NotInstalled("Claude Code needs Node.js 22+ (npx was not found). Install Node.js, or set the path of claude-agent-acp in Claude Code settings")
	}
	return milk.Launch{Binary: npx, Args: []string{"--yes", AdapterPackage}}, nil
}

func withoutVar(env []string, name string) []string {
	kept := make([]string, 0, len(env))
	for _, entry := range env {
		// Windows tratta i nomi delle variabili senza distinzione di maiuscole.
		if key, _, _ := strings.Cut(entry, "="); !strings.EqualFold(key, name) {
			kept = append(kept, entry)
		}
	}
	return kept
}
