package devsession

import "testing"

func TestRustToolingIsNotTheService(t *testing.T) {
	for _, name := range []string{"cargo.exe", "rustc", "rust-analyzer", "CodeLLDB.exe"} {
		if !isInfraProcess(name) {
			t.Fatalf("%s must be treated as tooling", name)
		}
	}
	if isInfraProcess("my-axum-service.exe") {
		t.Fatal("a Rust service binary is the service")
	}
}

func TestCargoRunBecomesALiveSessionButBuildDoesNot(t *testing.T) {
	manager, _ := testManager(Hooks{})
	manager.RunStarted("go-1", "bin-1", "bin", "cargo run", 10)
	manager.RunStarted("go-1", "ex-1", "example", "cargo run --example demo", 11)
	manager.RunStarted("go-1", "build-1", "build", "cargo build", 12)
	manager.RunStarted("go-1", "check-1", "check", "cargo check", 13)
	ids := map[string]bool{}
	for _, session := range manager.Snapshot().Sessions {
		ids[session.ID] = true
	}
	if !ids["run:bin-1"] || !ids["run:ex-1"] || ids["run:build-1"] || ids["run:check-1"] {
		t.Fatalf("sessions = %v", ids)
	}
}
