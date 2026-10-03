package goide

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

// binaryStamp identifica il binario Go senza eseguirlo: cambia se l'SDK viene aggiornato o sostituito.
func binaryStamp(binary string) string {
	info, err := os.Stat(binary)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano())
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
func (m *ToolchainManager) Detect(session Session) ToolchainInfo {
	info := m.detectFast(session)
	m.mu.Lock()
	m.generation[session.ID]++
	generation := m.generation[session.ID]
	m.detected[session.ID] = info
	m.mu.Unlock()
	if info.Available {
		go m.refreshEnvironment(session, info, generation)
	}
	return info
}

func (m *ToolchainManager) detectFast(session Session) ToolchainInfo {
	started := time.Now()
	config := m.Configuration(session.ID)
	scope := "global"
	if m.Settings(session.ID).Project != nil {
		scope = "project"
	}
	goDirective, toolchainDirective := readModuleDirectives(session.Project.RealPath)
	base := ToolchainInfo{Scope: scope, GoDirective: goDirective, ToolchainDirective: toolchainDirective}
	timed := func(phase, note string, since time.Time) {
		base.Timings = append(base.Timings, ToolchainTiming{Phase: phase, Millis: time.Since(since).Milliseconds(), Note: note})
	}

	lookup := time.Now()
	binary, err := resolveGoBinary(config.GoBinary)
	timed("Go executable lookup", config.GoBinary, lookup)
	if err != nil {
		base.Error = "Go non trovato. Installa Go oppure configura il percorso del binario nelle impostazioni del progetto."
		logToolchainTimings(session, base)
		return base
	}
	base.GoBinary = binary

	cacheCheck := time.Now()
	stamp := binaryStamp(binary)
	m.mu.RLock()
	previous, hasPrevious := m.detected[session.ID]
	m.mu.RUnlock()
	if hasPrevious && previous.Available && previous.GoBinary == binary && previous.BinaryStamp == stamp && stamp != "" && previous.SDKVersion != "" {
		cached := previous
		cached.Scope, cached.GoDirective, cached.ToolchainDirective = scope, goDirective, toolchainDirective
		cached.Cached, cached.EnvPending, cached.Error, cached.EnvError = true, true, "", ""
		cached.Timings = append(base.Timings, ToolchainTiming{Phase: "Load saved Go config", Millis: time.Since(cacheCheck).Milliseconds(), Note: "same binary, skipped go version"})
		cached.Warning = toolchainWarning(cached.SDKVersion, goDirective, toolchainDirective, cached.GOTOOLCHAIN)
		cached.Timings = append(cached.Timings, ToolchainTiming{Phase: "IDE usable", Millis: time.Since(started).Milliseconds()})
		logToolchainTimings(session, cached)
		return cached
	}

	versionStart := time.Now()
	version := sdkVersionFile(binary)
	if version != "" {
		base.Version = "go version " + version + " " + runtime.GOOS + "/" + runtime.GOARCH
		timed("go version", "GOROOT/VERSION file, no process", versionStart)
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), versionQueryTimeout)
		output, err := runToolchainQuery(ctx, binary, neutralDirectory(), queryEnvLocalToolchain(config.Environment), "version")
		cancel()
		timed("go version", "process in neutral dir, GOTOOLCHAIN=local", versionStart)
		if err != nil {
			base.Error = err.Error()
			logToolchainTimings(session, base)
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
	logToolchainTimings(session, base)
	return base
}

// refreshEnvironment legge go env fuori dal progetto; un errore o un timeout lasciano l'SDK valido
// e conservano i valori già noti (cache), segnalando solo EnvError.
func (m *ToolchainManager) refreshEnvironment(session Session, info ToolchainInfo, generation int) {
	config := m.Configuration(session.ID)
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), envQueryTimeout)
	output, err := runToolchainQuery(ctx, info.GoBinary, neutralDirectory(), config.Environment, append([]string{"env"}, toolchainEnvKeys...)...)
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
	if m.generation[session.ID] != generation {
		m.mu.Unlock()
		return
	}
	m.detected[session.ID] = updated
	notify := m.notify
	m.mu.Unlock()
	logToolchainTimings(session, updated)
	if notify != nil {
		notify(session.ID, updated)
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
	info.GOPROXY = sanitizeToolchainValue(value(2))
	info.GOPRIVATE = sanitizeToolchainValue(value(3))
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
	result := copyEnvironment(environment)
	result["GOTOOLCHAIN"] = "local"
	return result
}

func logToolchainTimings(session Session, info ToolchainInfo) {
	data := map[string]any{"project": session.Project.RealPath, "binary": info.GoBinary, "version": info.SDKVersion, "available": info.Available, "cached": info.Cached, "envPending": info.EnvPending}
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
func (m *ToolchainManager) RestoreDetected(detected map[SessionID]ToolchainInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, info := range detected {
		info.Timings, info.EnvPending, info.EnvError, info.Error = nil, false, "", ""
		m.detected[id] = info
	}
}

// DetectedSnapshot restituisce i rilevamenti riusciti da salvare, senza tempi né stati transitori.
func (m *ToolchainManager) DetectedSnapshot() map[SessionID]ToolchainInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	snapshot := make(map[SessionID]ToolchainInfo, len(m.detected))
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
func (m *ToolchainManager) SetNotifier(notify func(SessionID, ToolchainInfo)) {
	m.mu.Lock()
	m.notify = notify
	m.mu.Unlock()
}

// userChoseToolchain dice se go env (file di go env -w) riporta un GOTOOLCHAIN diverso dal predefinito auto.
func (m *ToolchainManager) userChoseToolchain(sessionID SessionID) bool {
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
	info.GOPROXY = sanitizeToolchainValue(lookup("GOPROXY"))
	info.GOPRIVATE = sanitizeToolchainValue(lookup("GOPRIVATE"))
	info.GONOPROXY = lookup("GONOPROXY")
	info.GONOSUMDB = lookup("GONOSUMDB")
	info.GOFLAGS = lookup("GOFLAGS")
	info.GOTOOLCHAIN = lookup("GOTOOLCHAIN")
}
