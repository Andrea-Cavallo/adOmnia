package securityintel

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setupPlan prepara un workspace con un manifest e un piano di aggiornamento pronto.
func setupPlan(t *testing.T, steps []VerifyStep) (*PlanStore, *Engine, UpgradePlan, string) {
	t.Helper()
	root := t.TempDir()
	manifest := filepath.Join(root, "lib.manifest")
	if err := os.WriteFile(manifest, []byte("name example.com/lib\nversion 1.2.3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	adapter := &fakeAdapter{ecosystem: EcosystemGo, name: "example.com/lib", editable: true, steps: steps}
	source := &fakeSource{byKey: map[string][]Advisory{}}
	engine := New([]EcosystemAdapter{adapter}, []Source{source}, nil, nil)
	store := NewPlanStore()

	component := Component{Ecosystem: EcosystemGo, Name: "example.com/lib", Version: "1.2.3", Manifest: manifest, Direct: true}
	report := ScanReport{Findings: []Finding{{
		ID:        "one",
		Advisory:  testAdvisory("GO-2024-0001", "first", "1.2.4", 9),
		Component: component,
	}}}
	plan, err := store.Plan(context.Background(), engine, UpgradeRequest{
		Component:     component,
		TargetVersion: "1.2.4",
		Report:        report,
	})
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	return store, engine, plan, manifest
}

func TestUpgradePlanWritesWithBackupAndRestoresOnDiscard(t *testing.T) {
	store, engine, plan, manifest := setupPlan(t, nil)
	if !strings.Contains(plan.Diff, "-version 1.2.3") || !strings.Contains(plan.Diff, "+version 1.2.4") {
		t.Fatalf("diff does not show the change:\n%s", plan.Diff)
	}
	if plan.State != PlanProposed {
		t.Fatalf("state = %q, want %q", plan.State, PlanProposed)
	}

	updated, err := store.RunStep(context.Background(), engine, plan.ID, StepWrite, ResolveOptions{})
	if err != nil {
		t.Fatalf("RunStep write: %v", err)
	}
	if updated.State != PlanApplied {
		t.Fatalf("state = %q, want %q", updated.State, PlanApplied)
	}
	content, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "version 1.2.3") {
		t.Fatalf("the manifest is still the old one:\n%s", content)
	}
	if updated.Backup == "" {
		t.Fatal("a backup must be recorded before overwriting the manifest")
	}
	backup, err := os.ReadFile(updated.Backup)
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if !strings.Contains(string(backup), "version 1.2.3") {
		t.Fatalf("the backup does not keep the previous content:\n%s", backup)
	}

	finished, err := store.Finish(plan.ID, false)
	if err != nil {
		t.Fatalf("Finish discard: %v", err)
	}
	if finished.State != PlanReverted {
		t.Fatalf("state = %q, want %q", finished.State, PlanReverted)
	}
	restored, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(restored), "version 1.2.3") {
		t.Fatalf("the manifest is not restored:\n%s", restored)
	}
	if _, err := os.Stat(updated.Backup); !os.IsNotExist(err) {
		t.Fatalf("the backup should be removed after a restore: %v", err)
	}
}

func TestUpgradePlanCommitsOnlyAfterChecks(t *testing.T) {
	store, engine, plan, manifest := setupPlan(t, nil)
	if _, err := store.Finish(plan.ID, true); err == nil {
		t.Fatal("committing before any check must be refused")
	}
	if _, err := store.RunStep(context.Background(), engine, plan.ID, StepWrite, ResolveOptions{}); err != nil {
		t.Fatalf("RunStep write: %v", err)
	}
	resolved, err := store.RunStep(context.Background(), engine, plan.ID, StepResolve, ResolveOptions{})
	if err != nil {
		t.Fatalf("RunStep resolve: %v", err)
	}
	if statusOf(resolved, StepResolve) != StepOK {
		t.Fatalf("resolve status = %q, output %q", statusOf(resolved, StepResolve), outputOf(resolved, StepResolve))
	}
	finished, err := store.Finish(plan.ID, true)
	if err != nil {
		t.Fatalf("Finish apply: %v", err)
	}
	if finished.State != PlanCommitted {
		t.Fatalf("state = %q, want %q", finished.State, PlanCommitted)
	}
	if finished.Backup == "" {
		t.Fatal("the previous content must be kept after the commit")
	}
	content, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "version 1.2.4") {
		t.Fatalf("the committed manifest does not carry the new version:\n%s", content)
	}
}

func TestUpgradePlanRefusesCommitWhenACheckFailed(t *testing.T) {
	store, engine, plan, _ := setupPlan(t, []VerifyStep{{
		ID:              "test",
		Label:           "Run tests",
		Command:         "fake test",
		Program:         "",
		RequiresProcess: true,
	}})
	if _, err := store.RunStep(context.Background(), engine, plan.ID, StepWrite, ResolveOptions{AllowProcesses: true}); err != nil {
		t.Fatalf("RunStep write: %v", err)
	}
	if _, err := store.RunStep(context.Background(), engine, plan.ID, StepResolve, ResolveOptions{AllowProcesses: true}); err != nil {
		t.Fatalf("RunStep resolve: %v", err)
	}
	failed, err := store.RunStep(context.Background(), engine, plan.ID, "test", ResolveOptions{AllowProcesses: true})
	if err != nil {
		t.Fatalf("RunStep test: %v", err)
	}
	if statusOf(failed, "test") != StepFailed {
		t.Fatalf("test status = %q, want %q (missing tool)", statusOf(failed, "test"), StepFailed)
	}
	if _, err := store.Finish(plan.ID, true); err == nil {
		t.Fatal("committing with a failed check must be refused")
	}
}

func TestUpgradeStepsSkipProcessesWithoutAuthorization(t *testing.T) {
	store, engine, plan, _ := setupPlan(t, []VerifyStep{{
		ID:              "build",
		Label:           "Compile",
		Command:         "fake build",
		Program:         "fake-tool",
		Args:            []string{"build"},
		RequiresProcess: true,
	}})
	if _, err := store.RunStep(context.Background(), engine, plan.ID, StepWrite, ResolveOptions{}); err != nil {
		t.Fatalf("RunStep write: %v", err)
	}
	updated, err := store.RunStep(context.Background(), engine, plan.ID, "build", ResolveOptions{AllowProcesses: false})
	if err != nil {
		t.Fatalf("RunStep build: %v", err)
	}
	if statusOf(updated, "build") != StepSkipped {
		t.Fatalf("build status = %q, want %q", statusOf(updated, "build"), StepSkipped)
	}
	if !strings.Contains(outputOf(updated, "build"), "not authorized") {
		t.Fatalf("output = %q, must say the step was skipped for lack of authorization", outputOf(updated, "build"))
	}
}

func TestRescanContradictsPreviewWhenAdvisoryRemains(t *testing.T) {
	// Il preview promette che CVE-2024-0001 sparisce: se la riscansione la trova
	// ancora, il passo fallisce invece di dare l'aggiornamento per buono.
	root := t.TempDir()
	manifest := filepath.Join(root, "lib.manifest")
	if err := os.WriteFile(manifest, []byte("name example.com/lib\nversion 1.2.3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	adapter := &fakeAdapter{ecosystem: EcosystemGo, name: "example.com/lib", editable: true}
	advisory := testAdvisory("GO-2024-0001", "first", "1.2.4", 9)
	source := &fakeSource{byKey: map[string][]Advisory{
		"Go:example.com/lib@1.2.3": {advisory},
	}}
	engine := New([]EcosystemAdapter{adapter}, []Source{source}, nil, nil)
	store := NewPlanStore()

	component := Component{Ecosystem: EcosystemGo, Name: "example.com/lib", Version: "1.2.3", Manifest: manifest, Direct: true}
	report := ScanReport{Findings: []Finding{{
		ID:        "one",
		Advisory:  advisory,
		Component: component,
	}}}
	plan, err := store.Plan(context.Background(), engine, UpgradeRequest{
		Component:     component,
		TargetVersion: "1.2.4",
		Report:        report,
	})
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	if _, err := store.RunStep(context.Background(), engine, plan.ID, StepWrite, ResolveOptions{}); err != nil {
		t.Fatalf("RunStep write: %v", err)
	}
	// La fonte cambia risposta: alla versione target l'advisory risulta ancora
	// presente, contraddicendo ciò che il preview aveva promesso.
	source.byKey = map[string][]Advisory{
		"Go:example.com/lib@1.2.4": {testAdvisoryFrom("GO-2024-0001", "first", "1.0.0", 9)},
	}
	rescanned, err := store.RunStep(context.Background(), engine, plan.ID, StepRescan, ResolveOptions{})
	if err != nil {
		t.Fatalf("RunStep rescan: %v", err)
	}
	if statusOf(rescanned, StepRescan) != StepFailed {
		t.Fatalf("rescan status = %q, want %q (output %q)", statusOf(rescanned, StepRescan), StepFailed, outputOf(rescanned, StepRescan))
	}
	if !strings.Contains(outputOf(rescanned, StepRescan), "still reported") {
		t.Fatalf("output = %q, must report the contradiction", outputOf(rescanned, StepRescan))
	}
}

func TestPlanStoreRefusesOverlappingPlansOnTheSameManifest(t *testing.T) {
	store, engine, plan, _ := setupPlan(t, nil)
	component := plan.Component
	if _, err := store.Plan(context.Background(), engine, UpgradeRequest{
		Component:     component,
		TargetVersion: "1.2.5",
		Report:        ScanReport{},
	}); err == nil {
		t.Fatal("a second plan on the same manifest must be refused while the first is open")
	}
	if _, err := store.Finish(plan.ID, false); err != nil {
		t.Fatalf("Finish discard: %v", err)
	}
	if _, err := store.Plan(context.Background(), engine, UpgradeRequest{
		Component:     component,
		TargetVersion: "1.2.5",
		Report:        ScanReport{},
	}); err != nil {
		t.Fatalf("a new plan must be possible after the previous one is closed: %v", err)
	}
}

func TestUnifiedDiffShowsOnlyTheChangedLines(t *testing.T) {
	before := "a\nb\nc\nd\ne\n"
	after := "a\nb\nC\nd\ne\n"
	diff := unifiedDiff("lib.manifest", before, after)
	if !strings.Contains(diff, "-c") || !strings.Contains(diff, "+C") {
		t.Fatalf("diff does not show the change:\n%s", diff)
	}
	if strings.Contains(diff, "-a") || strings.Contains(diff, "+e") {
		t.Fatalf("diff must not touch unchanged lines:\n%s", diff)
	}
	if unifiedDiff("lib.manifest", before, before) != "" {
		t.Fatal("an unchanged file must produce an empty diff")
	}
}

func statusOf(plan UpgradePlan, stepID string) string {
	for _, step := range plan.Steps {
		if step.ID == stepID {
			return step.Status
		}
	}
	return ""
}

func outputOf(plan UpgradePlan, stepID string) string {
	for _, step := range plan.Steps {
		if step.ID == stepID {
			return step.Output
		}
	}
	return ""
}
