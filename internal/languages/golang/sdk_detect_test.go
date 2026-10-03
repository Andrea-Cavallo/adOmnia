package golang

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"adomnia/internal/languages/golang/golangtest"
)

// testSession è il minimo che il manager conosce di una sessione: ID e cartella del progetto.
type testSession struct{ ID, Root string }

func timingOf(info ToolchainInfo, phase string) (ToolchainTiming, bool) {
	for _, timing := range info.Timings {
		if timing.Phase == phase {
			return timing, true
		}
	}
	return ToolchainTiming{}, false
}

func detectSession(t *testing.T, manager *ToolchainManager[string], binary string) testSession {
	t.Helper()
	project := t.TempDir()
	// Un go.mod che chiede una toolchain più nuova: dentro il progetto go tenterebbe un download.
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module x\n\ngo 1.26\n\ntoolchain go1.99.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session := testSession{ID: "s-" + filepath.Base(project), Root: project}
	if err := manager.Configure(session.ID, ToolchainConfiguration{GoBinary: binary}); err != nil {
		t.Fatal(err)
	}
	return session
}

func TestDetectIsUsableBeforeSlowGoEnvAndNeverRunsInTheProject(t *testing.T) {
	binary := golangtest.FakeSDK(t, true)
	logFile := filepath.Join(t.TempDir(), "calls.log")
	t.Setenv("FAKE_GO_LOG", logFile)
	t.Setenv("FAKE_GO_ENV_SLEEP", "1500ms")
	manager := NewToolchainManager[string]()
	done := make(chan ToolchainInfo, 1)
	manager.SetNotifier(func(_ string, info ToolchainInfo) { done <- info })
	session := detectSession(t, manager, binary)

	started := time.Now()
	info := manager.Detect(session.ID, session.Root)
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
	if strings.Contains(strings.ToLower(string(calls)), strings.ToLower(session.Root)) {
		t.Fatalf("go è stato eseguito nella cartella del progetto:\n%s", calls)
	}
	if strings.Contains(string(calls), "version|") {
		t.Fatalf("con il file VERSION go version non va eseguito:\n%s", calls)
	}
}

func TestGoEnvTimeoutKeepsAWorkingSDKAndCachedValues(t *testing.T) {
	binary := golangtest.FakeSDK(t, true)
	manager := NewToolchainManager[string]()
	results := make(chan ToolchainInfo, 2)
	manager.SetNotifier(func(_ string, info ToolchainInfo) { results <- info })
	session := detectSession(t, manager, binary)
	t.Setenv("FAKE_GO_ENV_SLEEP", "0s")
	manager.Detect(session.ID, session.Root)
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
	cached := manager.Detect(session.ID, session.Root)
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
	binary := golangtest.FakeSDK(t, false)
	logFile := filepath.Join(t.TempDir(), "calls.log")
	t.Setenv("FAKE_GO_LOG", logFile)
	manager := NewToolchainManager[string]()
	session := detectSession(t, manager, binary)
	info := manager.Detect(session.ID, session.Root)
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
	if again := manager.Detect(session.ID, session.Root); again.Cached {
		t.Fatalf("un binario cambiato non deve usare la cache: %+v", again)
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
	manager := NewToolchainManager[string]()
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
	manager := NewToolchainManager[string]()
	done := make(chan ToolchainInfo, 1)
	manager.SetNotifier(func(_ string, info ToolchainInfo) { done <- info })
	session := detectSession(t, manager, "")
	started := time.Now()
	info := manager.Detect(session.ID, session.Root)
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
