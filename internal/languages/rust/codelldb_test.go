package rust

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"adomnia/internal/ide/toolmanifest"
)

// codeLLDBTestAsset è la release pinnata per la piattaforma del test: senza asset pinnati la
// verifica non esiste (l'installazione gestita non è proposta).
func codeLLDBTestAsset(t *testing.T) codeLLDBAsset {
	t.Helper()
	asset, ok := codeLLDBAssets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		t.Skipf("no pinned CodeLLDB build for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	return asset
}

// fakeCodeLLDBInstall simula la cartella strumenti dopo l'installazione: adapter estratto e, se
// report non è nil, il report di installazione scritto dal comando.
func fakeCodeLLDBInstall(t *testing.T, toolsRoot string, report []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(managedCodeLLDB(toolsRoot)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(managedCodeLLDB(toolsRoot), []byte("fake adapter"), 0o755); err != nil {
		t.Fatal(err)
	}
	if report != nil {
		if err := os.WriteFile(filepath.Join(codeLLDBDirectory(toolsRoot), toolmanifest.ReportFile), report, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestVerifyManagedCodeLLDBRequiresReport(t *testing.T) {
	codeLLDBTestAsset(t)
	toolsRoot := t.TempDir()
	fakeCodeLLDBInstall(t, toolsRoot, nil)

	err := verifyManagedCodeLLDB(toolsRoot)
	if err == nil || !strings.Contains(err.Error(), toolmanifest.ReportFile) || !strings.Contains(err.Error(), "reinstall it from the editor notice") {
		t.Fatalf("an install without report must require a reinstall, got %v", err)
	}
}

func TestVerifyManagedCodeLLDBRejectsArtifactsDifferentFromThePinnedRelease(t *testing.T) {
	codeLLDBTestAsset(t)
	toolsRoot := t.TempDir()

	// Report leggibile ma con uno SHA-256 diverso dalla release pinnata: artefatto non quello atteso.
	forged := strings.Repeat("b", 64)
	report := []byte(`{"tool":"codelldb","version":"` + codeLLDBVersion + `","artifacts":[{"name":"codelldb.vsix","version":"` + codeLLDBVersion + `","url":"https://example.invalid/codelldb.vsix","sha256":"` + forged + `"}]}`)
	fakeCodeLLDBInstall(t, toolsRoot, report)

	err := verifyManagedCodeLLDB(toolsRoot)
	if err == nil || !strings.Contains(err.Error(), "reinstall it from the editor notice") {
		t.Fatalf("a report with a different artifact must require a reinstall, got %v", err)
	}
}

func TestVerifyManagedCodeLLDBRecordsManifestAndThenComparesIt(t *testing.T) {
	asset := codeLLDBTestAsset(t)
	toolsRoot := t.TempDir()
	report, err := codeLLDBReport(asset)
	if err != nil {
		t.Fatal(err)
	}
	fakeCodeLLDBInstall(t, toolsRoot, report)

	if err := verifyManagedCodeLLDB(toolsRoot); err != nil {
		t.Fatalf("first verification must record the manifest: %v", err)
	}
	manifestPath := filepath.Join(codeLLDBDirectory(toolsRoot), toolmanifest.ManifestFile)
	if _, err := os.Stat(manifestPath); err != nil {
		t.Fatalf("the manifest was not recorded: %v", err)
	}
	if err := verifyManagedCodeLLDB(toolsRoot); err != nil {
		t.Fatalf("the same install must verify again: %v", err)
	}

	// Cartella strumenti cambiata dopo l'installazione: il manifest non torna più.
	if err := os.WriteFile(managedCodeLLDB(toolsRoot), []byte("tampered adapter"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codeLLDBDirectory(toolsRoot), toolmanifest.ReportFile), append(report, ' '), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := verifyManagedCodeLLDB(toolsRoot); err == nil || !strings.Contains(err.Error(), "manifest") {
		t.Fatalf("a changed tools folder must require a reinstall, got %v", err)
	}
}

func TestVerifyManagedCodeLLDBRejectsIncompleteInstall(t *testing.T) {
	asset := codeLLDBTestAsset(t)
	toolsRoot := t.TempDir()
	report, err := codeLLDBReport(asset)
	if err != nil {
		t.Fatal(err)
	}
	// Report valido ma senza il binario dell'adapter estratto.
	if err := os.MkdirAll(codeLLDBDirectory(toolsRoot), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codeLLDBDirectory(toolsRoot), toolmanifest.ReportFile), report, 0o644); err != nil {
		t.Fatal(err)
	}
	err = verifyManagedCodeLLDB(toolsRoot)
	if err == nil || !strings.Contains(err.Error(), "adapter binary") {
		t.Fatalf("an install without the adapter binary must be rejected, got %v", err)
	}
}

func TestLocateCodeLLDBDoesNotUseAnUnverifiedManagedInstall(t *testing.T) {
	codeLLDBTestAsset(t)
	toolsRoot := t.TempDir()
	fakeCodeLLDBInstall(t, toolsRoot, nil)

	binary, source, warning := LocateCodeLLDB(toolsRoot)
	if source == "adOmnia tools" {
		t.Fatalf("the unverified managed install must not be used (%s)", binary)
	}
	if warning == nil || !strings.Contains(warning.Error(), "reinstall it from the editor notice") {
		t.Fatalf("the reason must be reported, got %v", warning)
	}
}

func TestCodeLLDBInstallPlanWritesTheVerificationReport(t *testing.T) {
	asset := codeLLDBTestAsset(t)
	plan, err := CodeLLDBInstallPlan(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	report, err := codeLLDBReport(asset)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.Command, toolmanifest.ReportFile) {
		t.Fatalf("the install command must write %s: %s", toolmanifest.ReportFile, plan.Command)
	}
	if !strings.Contains(plan.Command, string(report)) {
		t.Fatalf("the install command must write the artifact report for the pinned release: %s", plan.Command)
	}
	if !strings.Contains(plan.Command, asset.sha256) {
		t.Fatalf("the install command must verify the pinned SHA-256: %s", plan.Command)
	}
}
