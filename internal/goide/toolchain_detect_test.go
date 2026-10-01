package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeGoSource è un `go` finto: version risponde subito, env dorme FAKE_GO_ENV_SLEEP e annota la cartella di lavoro.
const fakeGoSource = `package main

import (
	"fmt"
	"os"
	"time"
)

func main() {
	wd, _ := os.Getwd()
	if log := os.Getenv("FAKE_GO_LOG"); log != "" {
		f, _ := os.OpenFile(log, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		fmt.Fprintf(f, "%s|%s|%s\n", os.Args[1], wd, os.Getenv("GOTOOLCHAIN"))
		f.Close()
	}
	switch os.Args[1] {
	case "version":
		fmt.Println("go version go1.26.0 fake/amd64")
	case "env":
		if d, err := time.ParseDuration(os.Getenv("FAKE_GO_ENV_SLEEP")); err == nil {
			time.Sleep(d)
		}
		for _, key := range os.Args[2:] {
			switch key {
			case "GOPATH":
				fmt.Println("/fake/gopath")
			case "GOPROXY":
				fmt.Println(os.Getenv("GOPROXY"))
			case "GOTOOLCHAIN":
				fmt.Println("auto")
			default:
				fmt.Println("")
			}
		}
	}
}
`

var buildFakeGoOnce sync.Once
var fakeGoBuilt string

// fakeGoSDK crea <root>/bin/go(.exe) e, se withVersionFile, <root>/VERSION come in un SDK ufficiale.
func fakeGoSDK(t *testing.T, withVersionFile bool) string {
	t.Helper()
	buildFakeGoOnce.Do(func() {
		dir, err := os.MkdirTemp("", "fakego")
		if err != nil {
			return
		}
		source := filepath.Join(dir, "main.go")
		_ = os.WriteFile(source, []byte(fakeGoSource), 0o644)
		output := filepath.Join(dir, "go"+exeSuffix())
		build := exec.Command("go", "build", "-o", output, source)
		build.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOFLAGS=")
		if out, err := build.CombinedOutput(); err == nil {
			fakeGoBuilt = output
		} else {
			t.Logf("build fake go: %v %s", err, out)
		}
	})
	if fakeGoBuilt == "" {
		t.Skip("impossibile compilare il go finto")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(fakeGoBuilt)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(root, "bin", "go"+exeSuffix())
	if err := os.WriteFile(binary, data, 0o755); err != nil {
		t.Fatal(err)
	}
	if withVersionFile {
		if err := os.WriteFile(filepath.Join(root, "VERSION"), []byte("go1.26.0\ntime 2026-01-01T00:00:00Z\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return binary
}

func exeSuffix() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

func timingOf(info ToolchainInfo, phase string) (ToolchainTiming, bool) {
	for _, timing := range info.Timings {
		if timing.Phase == phase {
			return timing, true
		}
	}
	return ToolchainTiming{}, false
}

func detectSession(t *testing.T, manager *ToolchainManager, binary string) Session {
	t.Helper()
	project := t.TempDir()
	// Un go.mod che chiede una toolchain più nuova: dentro il progetto go tenterebbe un download.
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module x\n\ngo 1.26\n\ntoolchain go1.99.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session := Session{ID: SessionID("s-" + filepath.Base(project)), Project: Project{RealPath: project, RootPath: project}}
	if err := manager.Configure(session.ID, ToolchainConfiguration{GoBinary: binary}); err != nil {
		t.Fatal(err)
	}
	return session
}

func TestDetectIsUsableBeforeSlowGoEnvAndNeverRunsInTheProject(t *testing.T) {
	binary := fakeGoSDK(t, true)
	logFile := filepath.Join(t.TempDir(), "calls.log")
	t.Setenv("FAKE_GO_LOG", logFile)
	t.Setenv("FAKE_GO_ENV_SLEEP", "1500ms")
	manager := NewToolchainManager()
	done := make(chan ToolchainInfo, 1)
	manager.SetNotifier(func(_ SessionID, info ToolchainInfo) { done <- info })
	session := detectSession(t, manager, binary)

	started := time.Now()
	info := manager.Detect(session)
	elapsed := time.Since(started)
	if !info.Available || !info.EnvPending || info.SDKVersion != "go1.26.0" {
		t.Fatalf("SDK non disponibile subito: %+v", info)
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("il rilevamento ha aspettato go env: %s", elapsed)
	}
	if timing, ok := timingOf(info, "go version"); !ok || !strings.Contains(timing.Note, "VERSION file") {
		t.Fatalf("la versione deve venire dal file VERSION senza processi: %+v", info.Timings)
	}
	if _, ok := timingOf(info, "Go executable lookup"); !ok {
		t.Fatalf("manca il tempo del lookup: %+v", info.Timings)
	}
	if _, ok := manager.LastDetected(session.ID); !ok {
		t.Fatal("l'SDK deve risultare utilizzabile mentre go env è in corso")
	}
	select {
	case refreshed := <-done:
		if refreshed.EnvPending || refreshed.GOPATH != "/fake/gopath" || refreshed.EnvError != "" {
			t.Fatalf("go env in background non applicato: %+v", refreshed)
		}
		if timing, ok := timingOf(refreshed, "go env"); !ok || timing.Millis < 1000 {
			t.Fatalf("manca il tempo di go env: %+v", refreshed.Timings)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("go env in background mai completato")
	}
	calls, _ := os.ReadFile(logFile)
	if strings.Contains(strings.ToLower(string(calls)), strings.ToLower(session.Project.RealPath)) {
		t.Fatalf("go è stato eseguito nella cartella del progetto:\n%s", calls)
	}
	if strings.Contains(string(calls), "version|") {
		t.Fatalf("con il file VERSION go version non va eseguito:\n%s", calls)
	}
}

func TestGoEnvTimeoutKeepsAWorkingSDKAndCachedValues(t *testing.T) {
	binary := fakeGoSDK(t, true)
	manager := NewToolchainManager()
	results := make(chan ToolchainInfo, 2)
	manager.SetNotifier(func(_ SessionID, info ToolchainInfo) { results <- info })
	session := detectSession(t, manager, binary)
	t.Setenv("FAKE_GO_ENV_SLEEP", "0s")
	manager.Detect(session)
	first := <-results
	if first.GOPATH != "/fake/gopath" {
		t.Fatalf("primo go env: %+v", first)
	}

	// VPN giù: go env non risponde più entro il timeout.
	previous := envQueryTimeout
	envQueryTimeout = 300 * time.Millisecond
	t.Cleanup(func() { envQueryTimeout = previous })
	t.Setenv("FAKE_GO_ENV_SLEEP", "5s")
	started := time.Now()
	cached := manager.Detect(session)
	if !cached.Available || !cached.Cached || time.Since(started) > 200*time.Millisecond {
		t.Fatalf("il secondo avvio deve usare la cache subito: %+v (%s)", cached, time.Since(started))
	}
	if _, ran := timingOf(cached, "go version"); ran {
		t.Fatalf("con la cache valida go version non serve: %+v", cached.Timings)
	}
	if cached.GOPATH != "/fake/gopath" {
		t.Fatalf("i valori salvati devono essere subito disponibili: %+v", cached)
	}
	timedOut := <-results
	if !timedOut.Available || timedOut.EnvError == "" || timedOut.GOPATH != "/fake/gopath" {
		t.Fatalf("un timeout di go env non deve invalidare l'SDK né i valori salvati: %+v", timedOut)
	}
	if info, ok := manager.LastDetected(session.ID); !ok || info.GOPATH != "/fake/gopath" {
		t.Fatalf("SDK invalidato dal timeout: %+v", info)
	}
}

func TestDetectFallsBackToGoVersionOutsideTheProjectAndRevalidatesAChangedBinary(t *testing.T) {
	binary := fakeGoSDK(t, false)
	logFile := filepath.Join(t.TempDir(), "calls.log")
	t.Setenv("FAKE_GO_LOG", logFile)
	manager := NewToolchainManager()
	session := detectSession(t, manager, binary)
	info := manager.Detect(session)
	if !info.Available || info.SDKVersion != "go1.26.0" {
		t.Fatalf("ripiego su go version fallito: %+v", info)
	}
	calls, _ := os.ReadFile(logFile)
	if !strings.Contains(string(calls), "version|") || !strings.Contains(string(calls), "|local") {
		t.Fatalf("go version deve girare con GOTOOLCHAIN=local:\n%s", calls)
	}
	// SDK aggiornato sul posto: stessa path, data diversa → niente cache.
	future := time.Now().Add(time.Hour)
	if err := os.Chtimes(binary, future, future); err != nil {
		t.Fatal(err)
	}
	if again := manager.Detect(session); again.Cached {
		t.Fatalf("un binario cambiato non deve usare la cache: %+v", again)
	}
}

func TestDetectedToolchainSurvivesRestart(t *testing.T) {
	binary := fakeGoSDK(t, true)
	t.Setenv("FAKE_GO_ENV_SLEEP", "0s")
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module x\n\ngo 1.26\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{}
	recorder := &eventRecorder{}
	first := NewService(store, recorder.record)
	session, err := first.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	config := ToolchainConfiguration{GoBinary: binary, Environment: map[string]string{"GOPRIVATE": "corp.example.com/*"}}
	if err := first.ConfigureToolchain(string(session.ID), config); err != nil {
		t.Fatal(err)
	}
	if _, err := first.DetectToolchain(string(session.ID)); err != nil {
		t.Fatal(err)
	}
	recorder.waitFor(t, 10*time.Second, func(event EventEnvelope) bool {
		info, ok := event.Payload.(ToolchainInfo)
		return event.Type == "toolchain.detected" && ok && !info.EnvPending
	})
	first.Shutdown()

	second := NewService(store, nil)
	t.Cleanup(second.Shutdown)
	if err := second.restore(); err != nil {
		t.Fatal(err)
	}
	restored, ok := second.toolchain.LastDetected(session.ID)
	if !ok || restored.GoBinary == "" || restored.GOPATH != "/fake/gopath" {
		t.Fatalf("SDK salvato non ripristinato dopo il riavvio: %+v", restored)
	}
	if settings := second.toolchain.Settings(session.ID); settings.Project == nil || settings.Project.Environment["GOPRIVATE"] != "corp.example.com/*" {
		t.Fatalf("configurazione utente persa al riavvio: %+v", settings)
	}
	started := time.Now()
	info, err := second.DetectToolchain(string(session.ID))
	if err != nil || !info.Available || !info.Cached {
		t.Fatalf("al riavvio la config salvata va caricata senza discovery completa: %v %+v", err, info)
	}
	if load, ok := timingOf(info, "Load saved Go config"); !ok || load.Millis >= 100 || time.Since(started) > 300*time.Millisecond {
		t.Fatalf("caricamento della config salvata troppo lento: %+v (%s)", info.Timings, time.Since(started))
	}
}

func TestProcessEnvironmentInheritsCorporateVariablesWithoutOverriding(t *testing.T) {
	corporate := map[string]string{
		"GOPROXY": "https://proxy.corp.example.com,direct", "GOPRIVATE": "*.corp.example.com", "GONOPROXY": "git.corp.example.com",
		"GONOSUMDB": "git.corp.example.com", "HTTP_PROXY": "http://proxy.corp:8080", "HTTPS_PROXY": "http://proxy.corp:8080", "NO_PROXY": "localhost,.corp.example.com",
	}
	for key, value := range corporate {
		t.Setenv(key, value)
	}
	t.Setenv("GOTOOLCHAIN", "")
	os.Unsetenv("GOTOOLCHAIN")
	manager := NewToolchainManager()
	environment, err := manager.Environment("s", nil)
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]string{}
	for _, item := range environment {
		key, value, _ := strings.Cut(item, "=")
		values[key] = value
	}
	for key, value := range corporate {
		if values[key] != value {
			t.Fatalf("%s = %q, atteso il valore aziendale %q", key, values[key], value)
		}
	}
	if values["GOTOOLCHAIN"] != "local" {
		t.Fatalf("senza scelta esplicita gO Studio non deve scaricare toolchain: GOTOOLCHAIN=%q", values["GOTOOLCHAIN"])
	}
	t.Setenv("GOTOOLCHAIN", "auto")
	environment, _ = manager.Environment("s", nil)
	if !slicesContains(environment, "GOTOOLCHAIN=auto") {
		t.Fatal("un GOTOOLCHAIN scelto dall'utente va rispettato")
	}
}

func slicesContains(items []string, wanted string) bool {
	for _, item := range items {
		if item == wanted {
			return true
		}
	}
	return false
}

// Go reale, progetto che chiede go1.99.0 e GOPROXY irraggiungibile (VPN lenta o rete assente):
// l'SDK deve essere disponibile subito e go env non deve tentare download.
func TestRealGoDetectionIgnoresAnUnreachableProxy(t *testing.T) {
	if testing.Short() {
		t.Skip("usa il Go reale")
	}
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go non nel PATH")
	}
	t.Setenv("GOPROXY", "http://10.255.255.1:3128")
	t.Setenv("HTTPS_PROXY", "http://10.255.255.1:3128")
	manager := NewToolchainManager()
	done := make(chan ToolchainInfo, 1)
	manager.SetNotifier(func(_ SessionID, info ToolchainInfo) { done <- info })
	session := detectSession(t, manager, "")
	started := time.Now()
	info := manager.Detect(session)
	if !info.Available || time.Since(started) > 2*time.Second {
		t.Fatalf("Go reale non disponibile subito: %+v (%s)", info, time.Since(started))
	}
	select {
	case refreshed := <-done:
		if refreshed.EnvError != "" || refreshed.GOPROXY != "http://10.255.255.1:3128" {
			t.Fatalf("go env con proxy irraggiungibile: %+v", refreshed)
		}
		if timing, _ := timingOf(refreshed, "go env"); timing.Millis > 5000 {
			t.Fatalf("go env ha tentato la rete: %d ms", timing.Millis)
		}
		t.Logf("timings: %+v", refreshed.Timings)
	case <-time.After(15 * time.Second):
		t.Fatal("go env bloccato dal proxy")
	}
}

// Un gopls o un golangci-lint rotti non devono toccare l'SDK rilevato.
func TestToolFailuresDoNotInvalidateTheGoSDK(t *testing.T) {
	binary := fakeGoSDK(t, true)
	t.Setenv("FAKE_GO_ENV_SLEEP", "0s")
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module x\n\ngo 1.26\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if err := service.ConfigureToolchain(id, ToolchainConfiguration{GoBinary: binary}); err != nil {
		t.Fatal(err)
	}
	if info, err := service.DetectToolchain(id); err != nil || !info.Available {
		t.Fatalf("SDK: %v %+v", err, info)
	}
	broken := filepath.Join(t.TempDir(), "broken"+exeSuffix())
	if err := os.WriteFile(broken, []byte("not an executable"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = service.ConfigureGopls(id, broken)
	if _, err := service.StartLanguageServer(id, LanguageServerSettings{}); err == nil {
		t.Log("gopls rotto accettato all'avvio: l'errore arriverà dal processo")
	}
	_ = service.ConfigureLinter(id, broken)
	if _, err := service.RunLint(t.Context(), id); err == nil {
		t.Fatal("un linter rotto deve fallire")
	}
	if info, ok := service.toolchain.LastDetected(session.ID); !ok || info.GoBinary != binary {
		t.Fatalf("un errore di gopls o del linter ha invalidato l'SDK: %+v", info)
	}
}
