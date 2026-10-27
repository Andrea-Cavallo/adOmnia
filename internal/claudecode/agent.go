// Package claudecode collega Claude Code a Code Studio come agente ACP. Il client
// (processo, sessioni, chat, permessi) è quello di milk: qui c'è solo come avviarlo.
package claudecode

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
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
	env := agentEnvironment()
	if settings.IgnoreAPIKey {
		env = withoutVar(env, apiKeyVar)
	}
	// Su Windows exec.LookPath("claude") trova lo shim claude.cmd di npm, che Node non riesce ad avviare (EINVAL,
	// session/new -32603): NativeClaude dà un .exe vero. Va impostato prima delle variabili esplicite, che vincono.
	if claude := milk.NativeClaude(exec.LookPath); claude != "" {
		env = setEnv(env, "CLAUDE_CODE_EXECUTABLE", claude)
	}
	for name, value := range settingsEnvironment(root, os.Getenv) {
		env = setEnv(env, name, value)
	}
	for name, value := range settings.Env {
		env = setEnv(env, name, value)
	}
	launch.Args = append(launch.Args, settings.ExtraArgs...)
	launch.Env = env
	launch.Key = launchKey(launch, env)
	return launch, nil
}

var offlineAdapterProbe = probeOfflineAdapter

// adapterDirs è sostituibile nei test: un adapter installato sulla macchina non deve falsarli.
var adapterDirs = adapterDirectories

// command sceglie, in ordine: percorso dalle impostazioni, adapter nel PATH,
// installazioni npm globali, cartella gestita/cache e infine la cache offline di npx.
func command(settings milk.Settings, lookPath func(string) (string, error)) (milk.Launch, error) {
	candidates := sdk.ToolSearch{Names: []string{"claude-agent-acp"}, Custom: settings.BinaryPath, LookPath: lookPath}.Candidates()
	for _, directory := range adapterDirs() {
		candidates = append(candidates, sdk.ToolCandidate{Name: "claude-agent-acp", Binary: filepath.Join(directory, sdk.ExecutableName("claude-agent-acp")), Source: directory})
		if runtime.GOOS == "windows" {
			candidates = append(candidates, sdk.ToolCandidate{Name: "claude-agent-acp", Binary: filepath.Join(directory, "claude-agent-acp.cmd"), Source: directory})
		}
	}
	located, found := sdk.Locate(candidates, "Claude Code adapter not found at "+settings.BinaryPath, func(sdk.ToolCandidate) (string, error) { return "", nil })
	if found {
		if located.Error != "" {
			return milk.Launch{Binary: located.Binary}, milk.NotInstalled(located.Error)
		}
		return milk.Launch{Binary: located.Binary}, nil
	}
	npx, err := lookPath("npx")
	if err != nil {
		return milk.Launch{}, milk.NotInstalled("Claude Code adapter is not installed and npx was not found. Install Node.js or choose a claude-agent-acp executable")
	}
	if offlineAdapterProbe(npx) {
		return milk.Launch{Binary: npx, Args: []string{"--offline", "--no-install", AdapterPackage}}, nil
	}
	return milk.Launch{Binary: npx}, milk.NotInstalled("Claude Code adapter is not installed. Use Install adapter, install @agentclientprotocol/claude-agent-acp manually, or choose its executable. No download was attempted")
}

func adapterDirectories() []string {
	directories := []string{}
	if appData := strings.TrimSpace(os.Getenv("APPDATA")); appData != "" {
		directories = append(directories, filepath.Join(appData, "npm"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		directories = append(directories, filepath.Join(home, ".npm-global", "bin"), filepath.Join(home, ".local", "bin"))
	}
	if cache, err := os.UserCacheDir(); err == nil {
		directories = append(directories, filepath.Join(cache, "adomnia", "tools", "claude-agent-acp", "node_modules", ".bin"))
	}
	return directories
}

func probeOfflineAdapter(npx string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := procutil.CommandContext(ctx, npx, "--offline", "--no-install", AdapterPackage, "--version")
	cmd.Env = agentEnvironment()
	return cmd.Run() == nil
}

func agentEnvironment() []string {
	env := netpolicy.Environ()
	proxy := envValue(env, "HTTPS_PROXY")
	if proxy == "" {
		proxy = envValue(env, "HTTP_PROXY")
	}
	if proxy != "" {
		env = setEnv(env, "NPM_CONFIG_PROXY", proxy)
		env = setEnv(env, "NPM_CONFIG_HTTPS_PROXY", proxy)
	}
	ca := envValue(env, "SSL_CERT_FILE")
	if ca != "" {
		env = setEnv(env, "NPM_CONFIG_CAFILE", ca)
		if envValue(env, "NODE_EXTRA_CA_CERTS") == "" {
			env = setEnv(env, "NODE_EXTRA_CA_CERTS", ca)
		}
	}
	return env
}

func envValue(env []string, name string) string {
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if ok && strings.EqualFold(key, name) {
			return value
		}
	}
	return ""
}

func setEnv(env []string, name, value string) []string {
	return append(withoutVar(env, name), name+"="+value)
}

func launchKey(launch milk.Launch, env []string) string {
	interesting := []string{"ANTHROPIC_MODEL", "ANTHROPIC_CUSTOM_MODEL_OPTION", "CLAUDE_CODE_EXECUTABLE", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS"}
	sort.Strings(interesting)
	material := launch.Binary + "\x00" + strings.Join(launch.Args, "\x00")
	for _, name := range interesting {
		material += "\x00" + name + "=" + envValue(env, name)
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(material)))
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
