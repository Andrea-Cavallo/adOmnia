package rust

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLocateServerFindsRustAnalyzerInPath(t *testing.T) {
	root := t.TempDir()
	binary := writeFile(t, root, "rust-analyzer", "")
	original := lookPath
	lookPath = func(name string) (string, error) { return binary, nil }
	defer func() { lookPath = original }()

	info := New().LocateServer(root, "")
	if !info.Available || info.Source != "PATH" || info.Binary != binary {
		t.Fatalf("info = %+v", info)
	}
}

func TestLocateServerReportsMissing(t *testing.T) {
	original := lookPath
	lookPath = func(string) (string, error) { return "", errNotFound }
	defer func() { lookPath = original }()

	info := New().LocateServer(t.TempDir(), "")
	if info.Available || !strings.Contains(info.Error, "rust-analyzer is not installed") {
		t.Fatalf("info = %+v", info)
	}
}

func TestServersPerUnit(t *testing.T) {
	if !New().ServersPerUnit() {
		t.Fatal("rust-analyzer must run per unit (Cargo workspace)")
	}
}

func TestUnitServerSpecBuildsStdioServer(t *testing.T) {
	root := t.TempDir()
	binary := writeFile(t, root, "rust-analyzer", "")
	original := lookPath
	lookPath = func(name string) (string, error) { return binary, nil }
	defer func() { lookPath = original }()

	spec, err := New().UnitServerSpec(root, root, "")
	if err != nil {
		t.Fatal(err)
	}
	if spec.Language != ID || spec.Name != "rust-analyzer" || spec.Binary != binary {
		t.Fatalf("spec = %+v", spec)
	}
	if spec.Configuration == nil || spec.WatchesFile == nil {
		t.Fatalf("spec missing config or watch: %+v", spec)
	}
	if spec.Configuration() == nil {
		t.Fatal("configuration must not be nil")
	}
}

func TestRustAnalyzerSettings(t *testing.T) {
	settings := rustAnalyzerSettings("/cache/adomnia/rust-analyzer-target/abc", false)
	ra, ok := settings.(map[string]any)["rust-analyzer"].(map[string]any)
	if !ok {
		t.Fatalf("settings = %#v", settings)
	}
	check, _ := ra["check"].(map[string]any)
	if check["command"] != "check" {
		t.Fatalf("check = %#v", ra["check"])
	}
	// RS-9.2: il targetDir dedicato arriva a cargo.targetDir.
	cargo, _ := ra["cargo"].(map[string]any)
	if cargo["targetDir"] != "/cache/adomnia/rust-analyzer-target/abc" {
		t.Fatalf("cargo.targetDir = %#v", cargo["targetDir"])
	}
	// Analisi pesante attiva di default (proc-macro e build script, RS-9.5).
	proc, _ := ra["procMacro"].(map[string]any)
	if proc["enable"] != true {
		t.Fatalf("procMacro = %#v", ra["procMacro"])
	}
	buildScripts, _ := cargo["buildScripts"].(map[string]any)
	if buildScripts["enable"] != true {
		t.Fatalf("buildScripts = %#v", cargo["buildScripts"])
	}
}

func TestRustAnalyzerSettingsLowResourcesDisablesHeavyAnalysis(t *testing.T) {
	// RS-9.5: opzione "Low resources" — proc-macro e build script spengono, il resto resta.
	settings := rustAnalyzerSettings("", true)
	ra, _ := settings.(map[string]any)["rust-analyzer"].(map[string]any)
	proc, _ := ra["procMacro"].(map[string]any)
	if proc["enable"] != false {
		t.Fatalf("procMacro = %#v", ra["procMacro"])
	}
	cargo, _ := ra["cargo"].(map[string]any)
	buildScripts, _ := cargo["buildScripts"].(map[string]any)
	if buildScripts["enable"] != false {
		t.Fatalf("buildScripts = %#v", cargo["buildScripts"])
	}
	if check, _ := ra["check"].(map[string]any); check["command"] != "check" {
		t.Fatalf("check must stay on: %#v", ra["check"])
	}
}

func TestRustAnalyzerSettingsWithoutTargetDir(t *testing.T) {
	settings := rustAnalyzerSettings("", false)
	ra, _ := settings.(map[string]any)["rust-analyzer"].(map[string]any)
	cargo, _ := ra["cargo"].(map[string]any)
	if _, present := cargo["targetDir"]; present {
		t.Fatalf("targetDir must be omitted when empty: %#v", cargo)
	}
}

func TestProjectLowResourcesPersistsAlongsideTheToolchain(t *testing.T) {
	root := t.TempDir()
	if ProjectLowResources(root) {
		t.Fatal("low resources must be off by default")
	}
	if err := SetProjectToolchain(root, "", filepath.Join(root, "cargo")); err != nil {
		// Il cargo deve essere un eseguibile reale: usiamo la persistenza della sola opzione.
		t.Log(err)
	}
	if err := SetProjectLowResources(root, true); err != nil {
		t.Fatal(err)
	}
	if !ProjectLowResources(root) {
		t.Fatal("the low resources option must be read back")
	}
	// Azzerare la toolchain non deve cancellare il file con l'opzione ancora attiva.
	if err := SetProjectToolchain(root, "", ""); err != nil {
		t.Fatal(err)
	}
	if !ProjectLowResources(root) {
		t.Fatal("the low resources option must survive a toolchain reset")
	}
	if err := SetProjectLowResources(root, false); err != nil {
		t.Fatal(err)
	}
	if ProjectLowResources(root) {
		t.Fatal("the option must turn off again")
	}
}

func TestWatchesRustFile(t *testing.T) {
	for _, path := range []string{"src/main.rs", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/config.toml"} {
		if !watchesRustFile(path) {
			t.Errorf("%s must be watched", path)
		}
	}
	for _, path := range []string{"target/debug/foo", "README.md", "go.mod"} {
		if watchesRustFile(path) {
			t.Errorf("%s must not be watched", path)
		}
	}
}

func TestInstallPlanUsesRustup(t *testing.T) {
	original := lookPath
	lookPath = func(string) (string, error) { return filepath.Join(t.TempDir(), "rustup"), nil }
	defer func() { lookPath = original }()

	plan, err := New().InstallPlan("")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(plan.Arguments, " ") != "component add rust-analyzer" {
		t.Fatalf("arguments = %#v", plan.Arguments)
	}
	if plan.Languages[0] != ID {
		t.Fatalf("languages = %#v", plan.Languages)
	}
}

var errNotFound = &notFoundError{}

type notFoundError struct{}

func (*notFoundError) Error() string { return "not found" }
