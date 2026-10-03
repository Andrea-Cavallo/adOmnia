package goide

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"adomnia/internal/languages/golang"
	"adomnia/internal/languages/golang/golangtest"
)

func timingOf(info ToolchainInfo, phase string) (ToolchainTiming, bool) {
	for _, timing := range info.Timings {
		if timing.Phase == phase {
			return timing, true
		}
	}
	return ToolchainTiming{}, false
}

func TestDetectedToolchainSurvivesRestart(t *testing.T) {
	binary := golangtest.FakeSDK(t, true)
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

// Un gopls o un golangci-lint rotti non devono toccare l'SDK rilevato.
func TestToolFailuresDoNotInvalidateTheGoSDK(t *testing.T) {
	binary := golangtest.FakeSDK(t, true)
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
	broken := filepath.Join(t.TempDir(), "broken"+golangtest.ExeSuffix())
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

func TestSelectInstalledToolchainPinsItsOwnGOROOT(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	if err := service.ConfigureToolchainStorage(root); err != nil {
		t.Fatal(err)
	}
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module example.com/pinned\n\ngo 1.26\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	version := "go1.27.1"
	binary := filepath.Join(root, version, "go", "bin", golang.GoExecutableName())
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := service.SelectInstalledToolchain(string(session.ID), version); err != nil {
		t.Fatal(err)
	}
	config := service.toolchain.Configuration(session.ID)
	if config.Environment["GOROOT"] != filepath.Join(root, version, "go") {
		t.Fatalf("GOROOT gestito inatteso: %q", config.Environment["GOROOT"])
	}
	if config.Environment["GOTOOLCHAIN"] != "local" {
		t.Fatalf("GOTOOLCHAIN non confinato: %q", config.Environment["GOTOOLCHAIN"])
	}
}
