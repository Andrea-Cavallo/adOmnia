package codestudio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/rust"
)

// RS-2: la vista dell'ambiente legge .cargo/config.toml dal filesystem e riporta la cartella target
// che adOmnia gestisce per rust-analyzer, con la sua dimensione.
func TestRustEnvironmentReportsConfigAndAnalyzerCache(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, ".cargo/config.toml", strings.Join([]string{
		"[build]",
		"target-dir = \"build-target\"",
		"[alias]",
		"dev = \"run --bin app\"",
		"[env]",
		"RUST_BACKTRACE = \"1\"",
	}, "\n"))
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	report, err := service.RustEnvironment(string(session.ID))
	if err != nil {
		t.Fatalf("RustEnvironment: %v", err)
	}
	if report.Environment.Aliases["dev"] != "run --bin app" {
		t.Fatalf("aliases = %v", report.Environment.Aliases)
	}
	if report.Environment.Env["RUST_BACKTRACE"] != "1" || report.Environment.TargetDir != "build-target" {
		t.Fatalf("environment = %+v", report.Environment)
	}
	managed := rust.AnalyzerCacheDir(session.Project.RealPath)
	if managed == "" {
		// CARGO_TARGET_DIR impostato nella shell di test: niente cache gestita, e va detto.
		if report.AnalyzerCacheManaged || report.AnalyzerTargetDir != "" {
			t.Fatalf("cache dichiarata senza cartella gestita: %+v", report)
		}
		return
	}
	if !report.AnalyzerCacheManaged || report.AnalyzerTargetDir != managed {
		t.Fatalf("report = %+v, want managed cache %q", report, managed)
	}
}

// La pulizia della cache non è mai implicita e non tocca la cartella dell'utente.
func TestCleanRustAnalyzerCacheRequiresConfirmation(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	if _, err := service.CleanRustAnalyzerCache(string(session.ID), false); err == nil || !strings.Contains(err.Error(), "confirmation") {
		t.Fatalf("without confirmation: %v", err)
	}
	// Un progetto non autorizzato non si pulisce.
	if _, err := service.CleanRustAnalyzerCache(string(session.ID), true); err == nil || !strings.Contains(err.Error(), "trust") {
		t.Fatalf("untrusted project: %v", err)
	}
	if _, err := service.CleanRustAnalyzerCache("missing", true); err == nil {
		t.Fatal("an unknown session was accepted")
	}
}

// Con il progetto autorizzato e una cache gestita la pulizia libera spazio e la cartella sparisce.
func TestCleanRustAnalyzerCacheRemovesOnlyTheManagedFolder(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	managed := rust.AnalyzerCacheDir(session.Project.RealPath)
	if managed == "" {
		t.Skip("CARGO_TARGET_DIR is set: nothing is managed by adOmnia here")
	}
	// Una cartella target dell'utente non deve essere toccata.
	userTarget := filepath.Join(root, "target")
	writeFixtureFile(t, userTarget, "debug/app", "binary")
	if err := os.MkdirAll(filepath.Join(managed, "debug"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFixtureFile(t, managed, "debug/fingerprint", "0123456789")
	t.Cleanup(func() { _ = os.RemoveAll(managed) })

	result, err := service.CleanRustAnalyzerCache(string(session.ID), true)
	if err != nil {
		t.Fatalf("CleanRustAnalyzerCache: %v", err)
	}
	if result.FreedBytes < 10 || result.AnalyzerTargetDir != managed {
		t.Fatalf("result = %+v", result)
	}
	if _, err := os.Stat(managed); !os.IsNotExist(err) {
		t.Fatalf("the analyzer cache still exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(userTarget, "debug", "app")); err != nil {
		t.Fatalf("the user target/ was touched: %v", err)
	}
}
