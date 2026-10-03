package golang

import (
	"bufio"
	"context"
	"fmt"
	goversion "go/version"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"adomnia/internal/devlog"
	"adomnia/internal/ide/sdk"
)

// versionQueryTimeout vale solo per il ripiego `go version` quando manca il file VERSION dell'SDK.
const versionQueryTimeout = 5 * time.Second

// envQueryTimeout limita go env in background: scaduto, l'SDK resta valido e usa i valori salvati.
var envQueryTimeout = 30 * time.Second

var toolchainEnvKeys = []string{"GOROOT", "GOPATH", "GOPROXY", "GOPRIVATE", "GOMODCACHE", "GONOSUMDB", "GONOPROXY", "CGO_ENABLED", "GOOS", "GOARCH", "GOFLAGS", "GOTOOLCHAIN"}

// neutralDirectory è la cartella in cui girano go version e go env: fuori dal progetto nessun go.mod
// può chiedere una toolchain più nuova, quindi go non tenta mai un download dal GOPROXY (con la VPN
// lenta costava oltre 20 secondi e faceva scadere il rilevamento).
func neutralDirectory() string {
	return os.TempDir()
}

// sdkVersionFile legge la versione dal file VERSION dell'SDK (GOROOT/VERSION, accanto a bin/go):
// nessun processo, nessuna rete. Vuoto se il file non c'è (SDK di distribuzione senza VERSION).
func sdkVersionFile(binary string) string {
	file, err := os.Open(filepath.Join(filepath.Dir(filepath.Dir(binary)), "VERSION"))
	if err != nil {
		return ""
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	if scanner.Scan() {
		if version := strings.TrimSpace(scanner.Text()); goversion.IsValid(version) {
			return version
		}
	}
	return ""
}

// Detect rende disponibile l'SDK con sole operazioni locali (lookup del binario e versione) e legge
// go env in background. Con lo stesso binario dell'ultima volta riusa subito i valori salvati.
// projectRoot è la cartella reale del progetto: serve solo a leggere le direttive del go.mod.
func (m *ToolchainManager[K]) Detect(sessionID K, projectRoot string) ToolchainInfo {
	info := m.detectFast(sessionID, projectRoot)
	m.mu.Lock()
	m.generation[sessionID]++
	generation := m.generation[sessionID]
	m.detected[sessionID] = info
	m.mu.Unlock()
	if info.Available {
		go m.refreshEnvironment(sessionID, projectRoot, info, generation)
	}
	return info
}

func (m *ToolchainManager[K]) detectFast(sessionID K, projectRoot string) ToolchainInfo {
	started := time.Now()
	config := m.Configuration(sessionID)
	scope := "global"
	if m.Settings(sessionID).Project != nil {
		scope = "project"
	}
	goDirective, toolchainDirective := readModuleDirectives(projectRoot)
	base := ToolchainInfo{Scope: scope, GoDirective: goDirective, ToolchainDirective: toolchainDirective}
	timed := func(phase, note string, since time.Time) {
		base.Timings = append(base.Timings, ToolchainTiming{Phase: phase, Millis: time.Since(since).Milliseconds(), Note: note})
	}

	lookup := time.Now()
	binary, err := resolveGoBinary(config.GoBinary)
	timed("Go executable lookup", config.GoBinary, lookup)
	if err != nil {
		base.Error = "Go non trovato. Installa Go oppure configura il percorso del binario nelle impostazioni del progetto."
		logToolchainTimings(projectRoot, base)
		return base
	}
	base.GoBinary = binary

	cacheCheck := time.Now()
	stamp := sdk.BinaryStamp(binary)
	m.mu.RLock()
	previous, hasPrevious := m.detected[sessionID]
	m.mu.RUnlock()
	if hasPrevious && previous.Available && previous.GoBinary == binary && previous.BinaryStamp == stamp && stamp != "" && previous.SDKVersion != "" {
		cached := previous
		cached.Scope, cached.GoDirective, cached.ToolchainDirective = scope, goDirective, toolchainDirective
		cached.Cached, cached.EnvPending, cached.Error, cached.EnvError = true, true, "", ""
		cached.Timings = append(base.Timings, ToolchainTiming{Phase: "Load saved Go config", Millis: time.Since(cacheCheck).Milliseconds(), Note: "same binary, skipped go version"})
		cached.Warning = toolchainWarning(cached.SDKVersion, goDirective, toolchainDirective, cached.GOTOOLCHAIN)
		cached.Timings = append(cached.Timings, ToolchainTiming{Phase: "IDE usable", Millis: time.Since(started).Milliseconds()})
		logToolchainTimings(projectRoot, cached)
		return cached
	}

	versionStart := time.Now()
	version := sdkVersionFile(binary)
	if version != "" {
		base.Version = "go version " + version + " " + runtime.GOOS + "/" + runtime.GOARCH
		timed("go version", "GOROOT/VERSION file, no process", versionStart)
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), versionQueryTimeout)
		output, err := sdk.Query(ctx, "Go", binary, neutralDirectory(), queryEnvLocalToolchain(config.Environment), "version")
		cancel()
		timed("go version", "process in neutral dir, GOTOOLCHAIN=local", versionStart)
		if err != nil {
			base.Error = err.Error()
			logToolchainTimings(projectRoot, base)
			return base
		}
		base.Version = strings.TrimSpace(output)
		version = localGoVersion(base.Version)
	}
	base.SDKVersion = version
	base.BinaryStamp = stamp
	provisionalGoEnv(&base, binary, config.Environment)
	base.Available = true
	base.EnvPending = true
	base.Warning = toolchainWarning(version, goDirective, toolchainDirective, "")
	base.Timings = append(base.Timings, ToolchainTiming{Phase: "IDE usable", Millis: time.Since(started).Milliseconds()})
	logToolchainTimings(projectRoot, base)
	return base
}

// refreshEnvironment legge go env fuori dal progetto; un errore o un timeout lasciano l'SDK valido
// e conservano i valori già noti (cache), segnalando solo EnvError.
func (m *ToolchainManager[K]) refreshEnvironment(sessionID K, projectRoot string, info ToolchainInfo, generation int) {
	config := m.Configuration(sessionID)
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), envQueryTimeout)
	output, err := sdk.Query(ctx, "Go", info.GoBinary, neutralDirectory(), config.Environment, append([]string{"env"}, toolchainEnvKeys...)...)
	cancel()
	elapsed := time.Since(started)
	updated := info
	updated.EnvPending = false
	if err != nil {
		updated.EnvError = fmt.Sprintf("go env non ha risposto (%s): restano i valori salvati, l'SDK è comunque utilizzabile. %s", elapsed.Round(time.Millisecond), err.Error())
	} else {
		applyGoEnv(&updated, output)
		updated.Cached = false
		updated.EnvError = ""
	}
	updated.Warning = toolchainWarning(updated.SDKVersion, updated.GoDirective, updated.ToolchainDirective, updated.GOTOOLCHAIN)
	updated.Timings = append(append([]ToolchainTiming{}, info.Timings...), ToolchainTiming{Phase: "go env", Millis: elapsed.Milliseconds(), Note: "background, neutral dir"})
	m.mu.Lock()
	if m.generation[sessionID] != generation {
		m.mu.Unlock()
		return
	}
	m.detected[sessionID] = updated
	notify := m.notify
	m.mu.Unlock()
	logToolchainTimings(projectRoot, updated)
	if notify != nil {
		notify(sessionID, updated)
	}
}

func applyGoEnv(info *ToolchainInfo, output string) {
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	for len(lines) < len(toolchainEnvKeys) {
		lines = append(lines, "")
	}
	value := func(index int) string { return strings.TrimSpace(lines[index]) }
	info.GOROOT = value(0)
	info.GOPATH = value(1)
	info.GOPROXY = sdk.RedactURLList(value(2))
	info.GOPRIVATE = sdk.RedactURLList(value(3))
	info.GOMODCACHE = value(4)
	info.GONOSUMDB = value(5)
	info.GONOPROXY = value(6)
	info.CGOEnabled = value(7)
	info.GOOS = value(8)
	info.GOARCH = value(9)
	info.GOFLAGS = value(10)
	info.GOTOOLCHAIN = value(11)
}

// queryEnvLocalToolchain copia l'ambiente configurato forzando GOTOOLCHAIN=local per le sole query informative.
func queryEnvLocalToolchain(environment map[string]string) map[string]string {
	result := sdk.CopyEnvironment(environment)
	result["GOTOOLCHAIN"] = "local"
	return result
}

func logToolchainTimings(projectRoot string, info ToolchainInfo) {
	data := map[string]any{"project": projectRoot, "binary": info.GoBinary, "version": info.SDKVersion, "available": info.Available, "cached": info.Cached, "envPending": info.EnvPending}
	for _, timing := range info.Timings {
		data[timing.Phase+" ms"] = timing.Millis
	}
	if info.EnvError != "" {
		data["envError"] = info.EnvError
	}
	if info.Error != "" {
		data["error"] = info.Error
	}
	devlog.Info("goide.toolchain", "Go toolchain detection timings", data)
}

// RestoreDetected ripristina i rilevamenti salvati: al riavvio l'SDK è subito noto e viene solo convalidato.
func (m *ToolchainManager[K]) RestoreDetected(detected map[K]ToolchainInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, info := range detected {
		info.Timings, info.EnvPending, info.EnvError, info.Error = nil, false, "", ""
		m.detected[id] = info
	}
}

// DetectedSnapshot restituisce i rilevamenti riusciti da salvare, senza tempi né stati transitori.
func (m *ToolchainManager[K]) DetectedSnapshot() map[K]ToolchainInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	snapshot := make(map[K]ToolchainInfo, len(m.detected))
	for id, info := range m.detected {
		if !info.Available {
			continue
		}
		info.Timings, info.EnvPending, info.Cached = nil, false, false
		snapshot[id] = info
	}
	return snapshot
}

// SetNotifier collega l'avviso dei rilevamenti completati in background.
func (m *ToolchainManager[K]) SetNotifier(notify func(K, ToolchainInfo)) {
	m.mu.Lock()
	m.notify = notify
	m.mu.Unlock()
}

// userChoseToolchain dice se go env (file di go env -w) riporta un GOTOOLCHAIN diverso dal predefinito auto.
func (m *ToolchainManager[K]) userChoseToolchain(sessionID K) bool {
	m.mu.RLock()
	info := m.detected[sessionID]
	m.mu.RUnlock()
	return info.GOTOOLCHAIN != "" && info.GOTOOLCHAIN != "auto" && info.GOTOOLCHAIN != "local"
}

// provisionalGoEnv riempie i valori ricavabili senza avviare go (ambiente e posizione dell'SDK),
// così gopls, linter e navigazione nell'SDK funzionano subito; go env li conferma in background.
func provisionalGoEnv(info *ToolchainInfo, binary string, configured map[string]string) {
	lookup := func(key string) string {
		if value, ok := configured[key]; ok {
			return value
		}
		return os.Getenv(key)
	}
	info.GOROOT = lookup("GOROOT")
	if info.GOROOT == "" && sdkVersionFile(binary) != "" {
		info.GOROOT = filepath.Dir(filepath.Dir(binary))
	}
	info.GOPATH = lookup("GOPATH")
	if info.GOPATH == "" {
		if home, err := os.UserHomeDir(); err == nil {
			info.GOPATH = filepath.Join(home, "go")
		}
	}
	info.GOMODCACHE = lookup("GOMODCACHE")
	if info.GOMODCACHE == "" && info.GOPATH != "" {
		info.GOMODCACHE = filepath.Join(filepath.SplitList(info.GOPATH)[0], "pkg", "mod")
	}
	info.GOPROXY = sdk.RedactURLList(lookup("GOPROXY"))
	info.GOPRIVATE = sdk.RedactURLList(lookup("GOPRIVATE"))
	info.GONOPROXY = lookup("GONOPROXY")
	info.GONOSUMDB = lookup("GONOSUMDB")
	info.GOFLAGS = lookup("GOFLAGS")
	info.GOTOOLCHAIN = lookup("GOTOOLCHAIN")
}
