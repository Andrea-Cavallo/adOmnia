package codestudio

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"adomnia/internal/languages/rust"
)

// isolateRustPath removes cargo, rustup, codelldb and the VS Code extension from the environment
// of the test, so the Rust services see no toolchain to execute.
func isolateRustPath(t *testing.T) {
	t.Helper()
	empty := t.TempDir()
	t.Setenv("PATH", empty)
	t.Setenv("HOME", empty)
	t.Setenv("USERPROFILE", empty)
}

func writeFakeCargo(t *testing.T, root string) string {
	t.Helper()
	name := "cargo"
	if runtime.GOOS == "windows" {
		name = "cargo.exe"
	}
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, []byte("fake cargo"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func openRustProject(t *testing.T, service *Service, root string) Session {
	t.Helper()
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func TestRustToolchainsReportsChannelWithoutCargo(t *testing.T) {
	isolateRustPath(t)
	root := t.TempDir()
	writeFixtureFile(t, root, "rust-toolchain.toml", "[toolchain]\nchannel = \"1.85.0\"\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	report, err := service.RustToolchains(string(session.ID))
	if err != nil {
		t.Fatalf("RustToolchains: %v", err)
	}
	if report.Channel != "1.85.0" {
		t.Errorf("channel: %q", report.Channel)
	}
	if report.Selected != "" {
		t.Errorf("selected without a saved choice: %q", report.Selected)
	}
	if report.Probed {
		t.Error("an untrusted project must not be probed")
	}
	if len(report.Installed) != 1 {
		t.Fatalf("installed: %+v", report.Installed)
	}
	candidate := report.Installed[0]
	if candidate.Source != "project" || candidate.Channel != "1.85.0" || candidate.Problem == "" {
		t.Fatalf("candidate: %+v", candidate)
	}
}

func TestRustToolchainsProbesOnlyAuthorizedProjects(t *testing.T) {
	isolateRustPath(t)
	root := t.TempDir()
	writeFixtureFile(t, root, "rust-toolchain", "nightly\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}

	report, err := service.RustToolchains(string(session.ID))
	if err != nil {
		t.Fatalf("RustToolchains: %v", err)
	}
	if !report.Probed {
		t.Fatal("a trusted project must be probed")
	}
	if report.Channel != "nightly" {
		t.Fatalf("channel: %q", report.Channel)
	}
	if len(report.Installed) != 1 || report.Installed[0].Problem != "no cargo executable to probe" {
		t.Fatalf("probe result: %+v", report.Installed)
	}
}

func TestRustToolchainsPutsSavedChoiceFirst(t *testing.T) {
	isolateRustPath(t)
	root := t.TempDir()
	saved := writeFakeCargo(t, t.TempDir())
	writeFixtureFile(t, root, ".adomnia/rust.local.json", `{"cargo": `+strconv.Quote(saved)+`}`)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	report, err := service.RustToolchains(string(session.ID))
	if err != nil {
		t.Fatalf("RustToolchains: %v", err)
	}
	if report.Selected != saved {
		t.Errorf("selected: %q", report.Selected)
	}
	if len(report.Installed) != 1 || report.Installed[0].Cargo != saved || report.Installed[0].Source != "saved" {
		t.Fatalf("saved candidate: %+v", report.Installed)
	}
}

func TestRustToolchainsRejectsUnknownSession(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	if _, err := service.RustToolchains("missing"); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("RustToolchains(unknown) = %v", err)
	}
}

func TestSetRustToolchainPersistsAndClearsChoice(t *testing.T) {
	root := t.TempDir()
	cargo := writeFakeCargo(t, t.TempDir())
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	if err := service.SetRustToolchain(string(session.ID), cargo); err != nil {
		t.Fatalf("SetRustToolchain: %v", err)
	}
	if got := rust.ProjectToolchain(session.Project.RealPath, ""); got != cargo {
		t.Fatalf("saved cargo: %q", got)
	}
	if err := service.SetRustToolchain(string(session.ID), ""); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if got := rust.ProjectToolchain(session.Project.RealPath, ""); got != "" {
		t.Fatalf("reset left %q", got)
	}
}

func TestSetRustToolchainValidationErrors(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	if err := service.SetRustToolchain(string(session.ID), "cargo-relative"); err == nil {
		t.Fatal("a relative path was accepted")
	}
	if err := service.SetRustToolchain(string(session.ID), filepath.Join(root, "missing-cargo")); err == nil {
		t.Fatal("a missing cargo was accepted")
	}
	if err := service.SetRustToolchain("missing", ""); err == nil {
		t.Fatal("an unknown session was accepted")
	}
}

func TestSetRustLowResourcesPersistsAndRejectsCorruptFile(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	if err := service.SetRustLowResources(string(session.ID), true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !rust.ProjectLowResources(session.Project.RealPath) {
		t.Fatal("low resources not persisted")
	}
	if err := service.SetRustLowResources(string(session.ID), false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if rust.ProjectLowResources(session.Project.RealPath) {
		t.Fatal("low resources still enabled")
	}
	if err := service.SetRustLowResources("missing", true); err == nil {
		t.Fatal("an unknown session was accepted")
	}

	writeFixtureFile(t, root, ".adomnia/rust.local.json", "{not json")
	if err := service.SetRustLowResources(string(session.ID), true); err == nil || !strings.Contains(err.Error(), "not valid JSON") {
		t.Fatalf("corrupt settings: %v", err)
	}
}

func TestRustDependencyTreeReadsCargoLock(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "Cargo.lock", `version = 3

[[package]]
name = "app"
version = "0.1.0"
dependencies = ["serde 1.0.0"]

[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "serde"
version = "0.9.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
`)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	nodes, err := service.RustDependencyTree(string(session.ID))
	if err != nil {
		t.Fatalf("RustDependencyTree: %v", err)
	}
	if len(nodes) == 0 || nodes[0].Name != "app" {
		t.Fatalf("tree: %+v", nodes)
	}
	var duplicates int
	for _, node := range nodes {
		if node.Name == "serde" && node.Status == "duplicate" {
			duplicates++
		}
	}
	if duplicates == 0 {
		t.Fatalf("duplicated serde not flagged: %+v", nodes)
	}
	if _, err := service.RustDependencyTree("missing"); err == nil {
		t.Fatal("an unknown session was accepted")
	}
}

func TestRustDependencyTreeWithoutLockFileFails(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)
	if _, err := service.RustDependencyTree(string(session.ID)); err == nil {
		t.Fatal("a project without Cargo.lock returned a tree")
	}
}

func TestRustToolchainsDropsDuplicateSavedCandidate(t *testing.T) {
	isolateRustPath(t)
	root := t.TempDir()
	cargo := writeFakeCargo(t, t.TempDir())
	writeFixtureFile(t, root, ".adomnia/rust.local.json", `{"cargo": `+strconv.Quote(cargo)+`}`)
	t.Setenv("PATH", filepath.Dir(cargo))
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	report, err := service.RustToolchains(string(session.ID))
	if err != nil {
		t.Fatalf("RustToolchains: %v", err)
	}
	if len(report.Installed) != 1 {
		t.Fatalf("cargo listed twice: %+v", report.Installed)
	}
	if report.Installed[0].Source != "saved" || report.Installed[0].Cargo != cargo {
		t.Fatalf("candidate: %+v", report.Installed[0])
	}
}

func TestRustInstallPreviewsValidateInputs(t *testing.T) {
	isolateRustPath(t)
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	if _, err := service.PreviewRustComponentInstall(string(session.ID), "../escape"); err == nil || !strings.Contains(err.Error(), "component") {
		t.Fatalf("component preview: %v", err)
	}
	if _, err := service.PreviewRustToolchainInstall(string(session.ID), "1.85.0; rm -rf /"); err == nil || !strings.Contains(err.Error(), "toolchain") {
		t.Fatalf("toolchain preview: %v", err)
	}
	if _, err := service.PreviewRustComponentInstall("missing", "rust-src"); err == nil {
		t.Fatal("an unknown session was accepted")
	}
	if _, err := service.PreviewRustToolchainInstall("missing", "stable"); err == nil {
		t.Fatal("an unknown session was accepted")
	}
}

func TestPreviewRustDebuggerInstallDescribesCodeLLDB(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, t.TempDir())

	plan, err := service.PreviewRustDebuggerInstall(string(session.ID))
	if err != nil {
		t.Fatalf("PreviewRustDebuggerInstall: %v", err)
	}
	if plan.Executable == "" || plan.Title == "" || plan.Command == "" {
		t.Fatalf("plan: %+v", plan)
	}
	if _, err := service.PreviewRustDebuggerInstall("missing"); err == nil {
		t.Fatal("an unknown session was accepted")
	}
}

func TestRustInstallersRequireConfirmationAndTrust(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	if _, err := service.InstallRustComponent(string(session.ID), "rust-src", false); err == nil {
		t.Fatal("unconfirmed component install started")
	}
	if _, err := service.InstallRustToolchain(string(session.ID), "stable", false); err == nil {
		t.Fatal("unconfirmed toolchain install started")
	}
	if _, err := service.InstallRustDebugger(string(session.ID), false); err == nil {
		t.Fatal("unconfirmed debugger install started")
	}
	if _, err := service.InstallRustComponent("missing", "rust-src", true); err == nil {
		t.Fatal("an unknown session was accepted")
	}
	if _, err := service.InstallRustToolchain("missing", "stable", true); err == nil {
		t.Fatal("an unknown session was accepted")
	}
	if _, err := service.InstallRustDebugger("missing", true); err == nil {
		t.Fatal("an unknown session was accepted")
	}

	for name, install := range map[string]func() error{
		"component": func() error { _, err := service.InstallRustComponent(string(session.ID), "rust-src", true); return err },
		"toolchain": func() error { _, err := service.InstallRustToolchain(string(session.ID), "stable", true); return err },
		"debugger":  func() error { _, err := service.InstallRustDebugger(string(session.ID), true); return err },
	} {
		if err := install(); err == nil || !strings.Contains(err.Error(), "trust the project") {
			t.Errorf("%s install on an untrusted project: %v", name, err)
		}
	}
}

func TestRustInstallersRejectInvalidNames(t *testing.T) {
	isolateRustPath(t)
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}

	if _, err := service.InstallRustComponent(string(session.ID), "bad name", true); err == nil || !strings.Contains(err.Error(), "component") {
		t.Fatalf("component install: %v", err)
	}
	if _, err := service.InstallRustToolchain(string(session.ID), "../1.85.0", true); err == nil || !strings.Contains(err.Error(), "toolchain") {
		t.Fatalf("toolchain install: %v", err)
	}
}

func TestStartRustDebugRequiresTrustAndValidWorkspace(t *testing.T) {
	isolateRustPath(t)
	root := t.TempDir()
	cargo := writeFakeCargo(t, t.TempDir())
	t.Setenv("PATH", filepath.Dir(cargo)+string(os.PathListSeparator)+os.Getenv("PATH"))
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)

	if _, err := service.StartRustDebug(RustDebugRequest{SessionID: session.ID, Bin: "app"}); err == nil || !strings.Contains(err.Error(), "authorize") {
		t.Fatalf("untrusted debug: %v", err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}

	outside := t.TempDir()
	if _, err := service.StartRustDebug(RustDebugRequest{SessionID: session.ID, Bin: "app", WorkingDirectory: outside}); err == nil {
		t.Fatal("a working directory outside the project was accepted")
	}
	if _, err := service.StartRustDebug(RustDebugRequest{SessionID: session.ID, Bin: "app", WorkingDirectory: "missing"}); err == nil || !strings.Contains(err.Error(), "resolve the folder") {
		t.Fatalf("missing working directory: %v", err)
	}
	if _, err := service.StartRustDebug(RustDebugRequest{SessionID: "missing", Bin: "app"}); err == nil {
		t.Fatal("an unknown session was accepted")
	}

	_, err := service.StartRustDebug(RustDebugRequest{SessionID: session.ID, Bin: "app"})
	if err == nil || !strings.Contains(err.Error(), "CodeLLDB is not installed") {
		t.Fatalf("debug without CodeLLDB: %v", err)
	}
}

func TestStartRustDebugRequiresTargetWhenTestIsEmpty(t *testing.T) {
	isolateRustPath(t)
	root := t.TempDir()
	cargo := writeFakeCargo(t, t.TempDir())
	t.Setenv("PATH", filepath.Dir(cargo)+string(os.PathListSeparator)+os.Getenv("PATH"))
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session := openRustProject(t, service, root)
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartRustDebug(RustDebugRequest{SessionID: session.ID}); err == nil || !strings.Contains(err.Error(), "binary or example") {
		t.Fatalf("missing target: %v", err)
	}
}
