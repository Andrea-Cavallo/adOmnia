package python

import (
	"adomnia/internal/jsonutil"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeToolMetadata scrive accanto al server il dist-info con la versione installata e il report di
// pip con gli hash: è ciò che rende la cartella strumenti verificabile.
func writeToolMetadata(t *testing.T, directory, reportVersion, installedVersion string) {
	t.Helper()
	metadata := filepath.Join(directory, pyrightName+"-"+installedVersion+".dist-info", "METADATA")
	if err := os.MkdirAll(filepath.Dir(metadata), 0o755); err != nil {
		t.Fatal(err)
	}
	content := "Metadata-Version: 2.1\nName: " + pyrightName + "\nVersion: " + installedVersion + "\n"
	if err := os.WriteFile(metadata, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	report := pipReportFixture(t, reportVersion, strings.Repeat("a1", 32))
	if err := os.WriteFile(filepath.Join(directory, installReportFile), report, 0o644); err != nil {
		t.Fatal(err)
	}
}

// fakeToolsDirectory costruisce una cartella strumenti come la lascia un'installazione riuscita:
// il server, il dist-info con la versione e il report di pip con gli hash degli artefatti.
func fakeToolsDirectory(t *testing.T, reportVersion, installedVersion string) string {
	t.Helper()
	directory := t.TempDir()
	server := filepath.Join(directory, "basedpyright", "langserver.py")
	if err := os.MkdirAll(filepath.Dir(server), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(server, []byte("def main():\n    pass\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeToolMetadata(t, directory, reportVersion, installedVersion)
	return directory
}

func pipReportFixture(t *testing.T, serverVersion, serverHash string) []byte {
	t.Helper()
	report := map[string]any{"version": "1", "install": []map[string]any{
		{
			"metadata": map[string]any{"name": pyrightName, "version": serverVersion},
			"download_info": map[string]any{
				"url":          "https://files.pythonhosted.org/packages/basedpyright-" + serverVersion + "-py3-none-any.whl",
				"archive_info": map[string]any{"hashes": map[string]string{"sha256": serverHash}},
			},
		},
		{
			"metadata": map[string]any{"name": "nodejs-wheel-binaries", "version": "22.14.0"},
			"download_info": map[string]any{
				"url":          "https://files.pythonhosted.org/packages/nodejs_wheel-22.14.0-py3-none-win_amd64.whl",
				"archive_info": map[string]any{"hashes": map[string]string{"sha256": strings.Repeat("b2", 32)}},
			},
		},
	}}
	encoded, err := jsonutil.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestVerifiedToolIsAcceptedAndPinnedByManifest(t *testing.T) {
	directory := fakeToolsDirectory(t, pyrightVersion, pyrightVersion)
	if err := verifyManagedTool(directory); err != nil {
		t.Fatal(err)
	}
	// Il manifest viene scritto alla prima verifica e poi conferma la stessa cartella.
	if _, err := os.Stat(filepath.Join(directory, toolManifestFile)); err != nil {
		t.Fatalf("manifest not written: %v", err)
	}
	if err := verifyManagedTool(directory); err != nil {
		t.Fatalf("second verification failed: %v", err)
	}
	manifest, err := os.ReadFile(filepath.Join(directory, toolManifestFile))
	if err != nil {
		t.Fatal(err)
	}
	var parsed toolManifest
	if err := json.Unmarshal(manifest, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Tool != pyrightName || parsed.Version != pyrightVersion || len(parsed.Artifacts) != 2 {
		t.Fatalf("unexpected manifest: %+v", parsed)
	}
	if parsed.Artifacts[0].SHA256 != strings.Repeat("a1", 32) {
		t.Fatalf("artifact hash not preserved: %+v", parsed.Artifacts[0])
	}
	if parsed.ReportSHA256 == "" {
		t.Fatal("manifest does not bind the report it came from")
	}
}

// La cartella strumenti può essere usata solo se corrisponde al report che l'ha installata: un
// report sostituito, un artefatto diverso o una versione diversa chiedono una nuova installazione.
func TestManagedToolIsRejectedWhenItNoLongerMatchesItsReport(t *testing.T) {
	cases := map[string]func(t *testing.T, directory string){
		"no report": func(t *testing.T, directory string) {
			if err := os.Remove(filepath.Join(directory, installReportFile)); err != nil {
				t.Fatal(err)
			}
		},
		"artifact without hash": func(t *testing.T, directory string) {
			report := pipReportFixture(t, pyrightVersion, "")
			if err := os.WriteFile(filepath.Join(directory, installReportFile), report, 0o644); err != nil {
				t.Fatal(err)
			}
		},
		"report version differs from the pin": func(t *testing.T, directory string) {
			report := pipReportFixture(t, "1.39.0", strings.Repeat("a1", 32))
			if err := os.WriteFile(filepath.Join(directory, installReportFile), report, 0o644); err != nil {
				t.Fatal(err)
			}
		},
		"installed version differs from the report": func(t *testing.T, directory string) {
			fake := fakeToolsDirectory(t, pyrightVersion, "1.39.0")
			if err := os.Rename(filepath.Join(fake, pyrightName+"-1.39.0.dist-info"), filepath.Join(directory, pyrightName+"-1.39.0.dist-info")); err != nil {
				t.Fatal(err)
			}
			if err := os.RemoveAll(filepath.Join(directory, pyrightName+"-"+pyrightVersion+".dist-info")); err != nil {
				t.Fatal(err)
			}
		},
		"report replaced after the manifest": func(t *testing.T, directory string) {
			// Un secondo artefatto con un hash diverso: il manifest non lo riconosce più.
			report := pipReportFixture(t, pyrightVersion, strings.Repeat("c3", 32))
			if err := os.WriteFile(filepath.Join(directory, installReportFile), report, 0o644); err != nil {
				t.Fatal(err)
			}
		},
	}
	for name, tamper := range cases {
		t.Run(name, func(t *testing.T) {
			directory := fakeToolsDirectory(t, pyrightVersion, pyrightVersion)
			if err := verifyManagedTool(directory); err != nil {
				t.Fatalf("the fixture must start verified: %v", err)
			}
			tamper(t, directory)
			err := verifyManagedTool(directory)
			if err == nil {
				t.Fatal("a modified tools folder is still accepted")
			}
			if !strings.Contains(strings.ToLower(err.Error()), "reinstall") {
				t.Fatalf("the error does not say what to do: %v", err)
			}
		})
	}
}

// Il server gestito non parte se la verifica fallisce: la UI mostra il motivo e la reinstallazione.
func TestManagedServerIsNotUsedWhenUnverified(t *testing.T) {
	toolsRoot := t.TempDir()
	managed := managedDirectory(toolsRoot)
	if err := os.MkdirAll(filepath.Join(managed, "basedpyright"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managed, "basedpyright", "langserver.py"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", "")
	info := New().LocateServer(t.TempDir(), toolsRoot)
	if info.Available {
		t.Fatal("an unverified tools folder was accepted")
	}
	if !strings.Contains(info.Error, "reinstall") {
		t.Fatalf("the error does not say what to do: %v", info.Error)
	}
}

// L'installazione pinnata passa dal report di pip e non usa la cache: gli hash che adOmnia verifica
// sono quelli degli artefatti scaricati davvero in questa installazione.
func TestInstallPlanRecordsArtifactHashes(t *testing.T) {
	if _, err := bootstrapInterpreter(); err != nil {
		t.Skip("no Python interpreter on this machine:", err)
	}
	plan, err := New().InstallPlan(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	arguments := strings.Join(plan.Arguments, " ")
	for _, wanted := range []string{"install", "--no-cache-dir", "--report", installReportFile, pyrightName + "==" + pyrightVersion} {
		if !strings.Contains(arguments, wanted) {
			t.Fatalf("install arguments do not contain %q: %s", wanted, arguments)
		}
	}
	if !strings.Contains(plan.Command, installReportFile) || !strings.Contains(plan.Note, "SHA-256") {
		t.Fatalf("the visible command or the note does not mention the verified artifacts: %s / %s", plan.Command, plan.Note)
	}
}

// Il formato `hash: "sha256=<hex>"` dei report di pip precedenti a quelli con `hashes` resta valido.
func TestParsePipInstallReportAcceptsLegacyHash(t *testing.T) {
	report := []byte(`{"install":[{"metadata":{"name":"basedpyright","version":"` + pyrightVersion + `"},` +
		`"download_info":{"url":"https://example.invalid/basedpyright.whl","archive_info":{"hash":"sha256=` + strings.Repeat("d4", 32) + `"}}}]}`)
	artifacts, err := parsePipInstallReport(report)
	if err != nil {
		t.Fatal(err)
	}
	if len(artifacts) != 1 || artifacts[0].SHA256 != strings.Repeat("d4", 32) {
		t.Fatalf("legacy hash not read: %+v", artifacts)
	}
	if _, err := parsePipInstallReport([]byte(`{"install":[]}`)); err == nil {
		t.Fatal("an empty report was accepted")
	}
}
