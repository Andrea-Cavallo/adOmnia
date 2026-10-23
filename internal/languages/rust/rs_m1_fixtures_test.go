package rust

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

// Pre-check del collaudo RS-M1 (MANUAL-CHECK.md): le fixture reali in testdata/rs-m1 sono progetti
// Cargo veri (compilano con cargo), qui se ne verifica la parte che non chiede occhi — unità,
// esclusione di target/, canale rust non installato con azione esplicita. La prova visiva
// (Explorer, icone, stati UI) resta nell'app e si registra nel Registro di MANUAL-CHECK.md.

// RS-M1.1: un crate singolo è una sola unità cargo-package, con manifest e nome del crate.
func TestRSM1FixtureSingleCrateIsOneUnit(t *testing.T) {
	root := filepath.Join("testdata", "rs-m1", "single-crate")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 {
		t.Fatalf("units = %+v", units)
	}
	unit := units[0]
	if unit.Kind != UnitCargoPackage || unit.Name != "rs-m1-single" {
		t.Fatalf("unit = %+v", unit)
	}
	if unit.Language != ID {
		t.Fatalf("language = %q", unit.Language)
	}
	if filepath.Base(unit.Manifest) != "Cargo.toml" {
		t.Fatalf("manifest = %q", unit.Manifest)
	}
}

// RS-M1.2: il workspace (lib + bin + examples) dà la radice cargo-workspace e i due package;
// il decoy dentro target/package/ NON compare: target/ è escluso dalla scansione (RS-1.4).
func TestRSM1FixtureWorkspaceUnitsAndTargetExcluded(t *testing.T) {
	root := filepath.Join("testdata", "rs-m1", "workspace")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	names := map[string]string{}
	for _, unit := range units {
		kinds[unit.Kind]++
		names[unit.Name] = unit.Kind
		if strings.Contains(filepath.ToSlash(unit.Root), "/target/") {
			t.Fatalf("unit inside target/ was detected: %+v", unit)
		}
	}
	if len(units) != 3 {
		t.Fatalf("units = %+v", units)
	}
	if kinds[UnitCargoWorkspace] != 1 || kinds[UnitCargoPackage] != 2 {
		t.Fatalf("kinds = %v", kinds)
	}
	if names["rs-m1-core"] != UnitCargoPackage || names["rs-m1-svc"] != UnitCargoPackage {
		t.Fatalf("names = %v", names)
	}
	if _, decoy := names["rs-m1-decoy"]; decoy {
		t.Fatal("the decoy crate inside target/ must not be a unit")
	}
}

// RS-M1.3: rust-toolchain.toml dichiara 1.75.0 (canale non installato su questa macchina).
// L'apertura è statica: la toolchain risolta espone il canale e la sua origine, e l'unica azione
// ammessa è quella esplicita `rustup toolchain install 1.75.0` (nessun download implicito).
func TestRSM1FixtureToolchainChannelMissingHasExplicitAction(t *testing.T) {
	root := filepath.Join("testdata", "rs-m1", "toolchain-missing")
	units, err := New().DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 || units[0].Name != "rs-m1-toolchain" {
		t.Fatalf("units = %+v", units)
	}
	toolchain, err := ResolveToolchain(root, root, "")
	if err != nil {
		t.Fatal(err)
	}
	if toolchain.Channel != "1.75.0" {
		t.Fatalf("channel = %q, want 1.75.0 from rust-toolchain.toml", toolchain.Channel)
	}
	plan, err := New().ToolchainInstallPlan("1.75.0")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.Command, "toolchain install 1.75.0") {
		t.Fatalf("install plan = %+v", plan)
	}
}
