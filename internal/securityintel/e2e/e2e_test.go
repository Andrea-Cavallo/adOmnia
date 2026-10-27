package e2e

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel/gomod"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel/maven"
)

// Prova end-to-end del flusso di remediation su un manifest **reale**. Vive in un package
// separato perché il core di `securityintel` non può importare gli adapter (architecture_test.go).
//
//	SECURITY_SAMPLE_DIR=<progetto con go.mod o pom.xml> go test ./internal/securityintel/e2e/ -v
//
// Il manifest viene copiato in una cartella temporanea: il progetto originale non si tocca mai.
// Copre ciò che MANUAL-CHECK.md chiede in SEC-1.1—SEC-1.5 a livello di logica: impatto
// dell'aggiornamento, diff senza scrittura, scrittura provvisoria con backup, passi che non
// partono senza autorizzazione, ripristino e conferma.
func TestSafeRemediationOnARealManifest(t *testing.T) {
	sample := os.Getenv("SECURITY_SAMPLE_DIR")
	if sample == "" {
		t.Skip("set SECURITY_SAMPLE_DIR to a project with go.mod or pom.xml")
	}
	isolated := copyManifest(t, sample)

	adapter, manifest := adapterFor(t, isolated)
	resolution, err := adapter.Resolve(context.Background(), securityintel.Target{
		Ecosystem: adapter.Ecosystem(), Root: isolated, Manifest: manifest,
	}, securityintel.DefaultResolveOptions())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(resolution.Components) == 0 {
		t.Fatalf("no component in %s", manifest)
	}
	component := pickEditable(t, adapter, resolution.Components)
	target := "9.9.9-e2e-test"
	t.Logf("component %s %s (%s, direct=%v)", component.Name, component.Version, filepath.Base(manifest), component.Direct)

	// Advisory noto per la versione reale del componente: la fonte è finta, il manifest no.
	fake := &sampleSource{byKey: map[string][]securityintel.Advisory{
		component.Key(): {sampleAdvisory("TEST-E2E-0001", "e2e sample advisory", target, 9.1)},
	}}
	engine := securityintel.New([]securityintel.EcosystemAdapter{adapter}, []securityintel.Source{fake}, nil, nil)
	report, err := engine.Scan(context.Background(), securityintel.ScanRequest{Root: isolated, Options: securityintel.DefaultResolveOptions()})
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(report.Findings) == 0 {
		t.Fatalf("the injected advisory did not surface: %+v", report)
	}
	finding := report.Findings[0]
	t.Logf("finding %s reachability=%s priority=%s", finding.Advisory.ID, finding.Reachability, finding.Risk.Priority)

	// SEC-1.1 — impatto dell'aggiornamento: cosa chiude, cosa resta, cosa introduce.
	preview, err := engine.PreviewUpgrade(context.Background(), report, component, target)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if len(preview.Resolves) != 1 || preview.Resolves[0].ID != "TEST-E2E-0001" {
		t.Fatalf("resolves: %+v", preview.Resolves)
	}
	if len(preview.Introduces) != 0 {
		t.Fatalf("introduces: %+v", preview.Introduces)
	}
	t.Logf("preview: %s upgrade — %s", preview.Compatibility, preview.Advice)

	// SEC-1.2 — il piano mostra il diff e non scrive nulla.
	store := securityintel.NewPlanStore()
	plan, err := store.Plan(context.Background(), engine, securityintel.UpgradeRequest{
		Component: component, TargetVersion: target, Report: report, Options: securityintel.DefaultResolveOptions(),
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if plan.State != securityintel.PlanProposed {
		t.Fatalf("state = %q", plan.State)
	}
	if !strings.Contains(plan.Diff, component.Version) || !strings.Contains(plan.Diff, target) {
		t.Fatalf("diff does not show the version change:\n%s", plan.Diff)
	}
	before, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(before), target) {
		t.Fatal("planning must not write the manifest")
	}
	t.Logf("plan: %d step(s) proposed, nothing written", len(plan.Steps))

	// SEC-1.3 — la scrittura è provvisoria e crea il backup.
	written, err := store.RunStep(context.Background(), engine, plan.ID, securityintel.StepWrite, securityintel.ResolveOptions{})
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if written.State != securityintel.PlanApplied {
		t.Fatalf("state after the write step = %q, want %q", written.State, securityintel.PlanApplied)
	}
	after, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(after), target) {
		t.Fatal("the write step did not change the manifest")
	}
	backup := manifest + ".adomnia-restore"
	if saved, err := os.ReadFile(backup); err != nil || string(saved) != string(before) {
		t.Fatalf("backup %s does not hold the previous content: %v", backup, err)
	}
	t.Logf("write: provisional change with backup %s", filepath.Base(backup))

	// SEC-1.4 — senza autorizzazione nessun passo avvia processi. La risoluzione può essere
	// possibile senza strumenti esterni (Maven legge il pom): allora il passo è davvero "ok".
	// Quello che non deve succedere è "failed" per mancanza di autorizzazione.
	skipped, err := store.RunStep(context.Background(), engine, plan.ID, securityintel.StepResolve, securityintel.ResolveOptions{AllowProcesses: false})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	status := statusOf(skipped, securityintel.StepResolve)
	if status != securityintel.StepSkipped && status != securityintel.StepOK {
		t.Fatalf("resolve without authorization = %q, want %q or %q", status, securityintel.StepSkipped, securityintel.StepOK)
	}
	t.Logf("resolve: %q — %s", status, outputOf(skipped, securityintel.StepResolve))

	// SEC-1.5 — "Discard change" ripristina il manifest e rimuove il backup.
	reverted, err := store.Finish(plan.ID, false)
	if err != nil {
		t.Fatalf("discard: %v", err)
	}
	if reverted.State != securityintel.PlanReverted {
		t.Fatalf("state after discard = %q, want %q", reverted.State, securityintel.PlanReverted)
	}
	restored, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if string(restored) != string(before) {
		t.Fatal("discard did not restore the manifest")
	}
	if _, err := os.Stat(backup); !os.IsNotExist(err) {
		t.Fatal("discard left the backup behind")
	}
	t.Log("discard: manifest restored, backup removed")

	// SEC-1.5 — con tutti i passi ok/skipped la conferma rende la modifica definitiva.
	final, err := store.Plan(context.Background(), engine, securityintel.UpgradeRequest{
		Component: component, TargetVersion: target, Report: report, Options: securityintel.DefaultResolveOptions(),
	})
	if err != nil {
		t.Fatalf("plan again: %v", err)
	}
	if _, err := store.RunStep(context.Background(), engine, final.ID, securityintel.StepWrite, securityintel.ResolveOptions{}); err != nil {
		t.Fatalf("write again: %v", err)
	}
	if _, err := store.RunStep(context.Background(), engine, final.ID, securityintel.StepResolve, securityintel.ResolveOptions{AllowProcesses: false}); err != nil {
		t.Fatalf("resolve again: %v", err)
	}
	committed, err := store.Finish(final.ID, true)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if committed.State != securityintel.PlanCommitted {
		t.Fatalf("state after apply = %q, want %q", committed.State, securityintel.PlanCommitted)
	}
	applied, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(applied), target) {
		t.Fatal("apply did not keep the change")
	}
	t.Log("apply: change kept")
}

// copyManifest porta il manifest reale in una cartella temporanea: il progetto utente non si tocca.
func copyManifest(t *testing.T, source string) string {
	t.Helper()
	isolated := t.TempDir()
	for _, name := range []string{"go.mod", "pom.xml"} {
		data, err := os.ReadFile(filepath.Join(source, name))
		if err != nil {
			continue
		}
		if err := os.WriteFile(filepath.Join(isolated, name), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir(isolated)
	if err != nil || len(entries) == 0 {
		t.Fatalf("no go.mod or pom.xml in %s", source)
	}
	return isolated
}

// adapterFor è l'adapter del manifest copiato.
func adapterFor(t *testing.T, root string) (securityintel.EcosystemAdapter, string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err == nil {
		return gomod.New(), filepath.Join(root, "go.mod")
	}
	if _, err := os.Stat(filepath.Join(root, "pom.xml")); err == nil {
		return maven.New(), filepath.Join(root, "pom.xml")
	}
	t.Fatalf("no manifest in %s", root)
	return nil, ""
}

// pickEditable è un componente la cui versione è dichiarata nel manifest: è l'unico su cui la
// modifica automatica ha senso. Se il manifest le gestisce tutte da parent/BOM il test lo dice.
func pickEditable(t *testing.T, adapter securityintel.EcosystemAdapter, components []securityintel.Component) securityintel.Component {
	t.Helper()
	engine := securityintel.New([]securityintel.EcosystemAdapter{adapter}, nil, nil, nil)
	for _, component := range components {
		if component.Version == "" {
			continue
		}
		report := securityintel.ScanReport{Findings: []securityintel.Finding{{
			ID: "probe", Advisory: sampleAdvisory("TEST-PROBE", "probe", component.Version+"-probe", 9), Component: component,
		}}}
		plan, err := securityintel.NewPlanStore().Plan(context.Background(), engine, securityintel.UpgradeRequest{
			Component: component, TargetVersion: component.Version + "-probe", Report: report,
		})
		if err == nil && plan.State == securityintel.PlanProposed {
			return component
		}
	}
	t.Skip("every version is managed outside the manifest (parent/BOM): nothing to rewrite automatically")
	return securityintel.Component{}
}

// sampleSource è una fonte di advisory per i test: risponde per coordinate, come OSV.
type sampleSource struct {
	byKey map[string][]securityintel.Advisory
}

func (s *sampleSource) Name() string { return "sample" }

func (s *sampleSource) Query(_ context.Context, components []securityintel.Component) (map[string][]securityintel.Advisory, error) {
	result := map[string][]securityintel.Advisory{}
	for _, component := range components {
		if advisories, found := s.byKey[component.Key()]; found {
			result[component.Key()] = advisories
		}
	}
	return result, nil
}

func (s *sampleSource) Status() securityintel.SourceStatus {
	return securityintel.SourceStatus{Name: s.Name(), Endpoint: "sample://e2e"}
}

// sampleAdvisory è un advisory affetto fino alla versione corretta indicata.
func sampleAdvisory(id, summary, fixed string, score float64) securityintel.Advisory {
	return securityintel.Advisory{
		ID:            id,
		Summary:       summary,
		Severity:      securityintel.Severity{CVSS31Score: score, BaseSeverity: securityintel.SeverityClassOf(score)},
		Sources:       []string{"sample"},
		FixedVersions: []string{fixed},
		Ranges:        []securityintel.VersionRange{{Introduced: "0", Fixed: fixed}},
	}
}

func statusOf(plan securityintel.UpgradePlan, stepID string) string {
	for _, step := range plan.Steps {
		if step.ID == stepID {
			return step.Status
		}
	}
	return ""
}

func outputOf(plan securityintel.UpgradePlan, stepID string) string {
	for _, step := range plan.Steps {
		if step.ID == stepID {
			return step.Output
		}
	}
	return ""
}
