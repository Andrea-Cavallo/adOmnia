package securityintel

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeSource è una fonte di advisory per i test: risponde per coordinate, come OSV.
type fakeSource struct {
	byKey  map[string][]Advisory
	status SourceStatus
	err    error
}

func (f *fakeSource) Name() string { return "fake" }

func (f *fakeSource) Query(_ context.Context, components []Component) (map[string][]Advisory, error) {
	if f.err != nil {
		return nil, f.err
	}
	result := map[string][]Advisory{}
	for _, component := range components {
		if advisories, found := f.byKey[component.Key()]; found {
			result[component.Key()] = advisories
		}
	}
	return result, nil
}

func (f *fakeSource) Status() SourceStatus {
	status := f.status
	status.Name = f.Name()
	return status
}

// fakeAdapter è un adapter minimale: un manifest con "version X" dentro e nient'altro.
type fakeAdapter struct {
	ecosystem Ecosystem
	name      string
	editable  bool
	steps     []VerifyStep
}

func (f *fakeAdapter) Ecosystem() Ecosystem { return f.ecosystem }

func (f *fakeAdapter) Discover(_ context.Context, root string) ([]Target, error) {
	return []Target{{
		Ecosystem: f.ecosystem,
		Root:      root,
		Manifest:  filepath.Join(root, "lib.manifest"),
		Name:      f.name,
	}}, nil
}

func (f *fakeAdapter) Resolve(_ context.Context, target Target, _ ResolveOptions) (Resolution, error) {
	data, err := os.ReadFile(target.Manifest)
	if err != nil {
		return Resolution{}, err
	}
	_, version, _ := strings.Cut(string(data), "version ")
	version = strings.TrimSpace(version)
	return Resolution{Components: []Component{{
		Ecosystem:      f.ecosystem,
		Name:           f.name,
		Version:        version,
		Origin:         OriginDeclared,
		Exposure:       ExposureRuntime,
		Manifest:       target.Manifest,
		Direct:         true,
		DependencyPath: []string{"app", f.name},
	}}}, nil
}

// UpgradeManifest implementa UpgradeEditor: sostituisce la riga della versione.
func (f *fakeAdapter) UpgradeManifest(manifestText string, component Component, targetVersion string) (string, error) {
	if !f.editable {
		return "", fmt.Errorf("the version is managed by an external BOM")
	}
	updated := strings.Replace(manifestText, "version "+component.Version, "version "+targetVersion, 1)
	if updated == manifestText {
		return "", fmt.Errorf("version %s is not declared in this manifest", component.Version)
	}
	return updated, nil
}

func (f *fakeAdapter) VerifySteps(_ Target, _ Component, _ string, _ ResolveOptions) []VerifyStep {
	return f.steps
}

// testAdvisory costruisce un advisory affetto fino alla versione corretta indicata.
func testAdvisory(id, summary, fixed string, score float64) Advisory {
	advisory := Advisory{
		ID:       id,
		Summary:  summary,
		Severity: Severity{CVSS31Score: score, BaseSeverity: SeverityClassOf(score)},
		Sources:  []string{"fake"},
	}
	if fixed != "" {
		advisory.FixedVersions = []string{fixed}
		advisory.Ranges = []VersionRange{{Introduced: "0", Fixed: fixed}}
	}
	return advisory
}

// testAdvisoryFrom costruisce un advisory affetto dalla versione indicata in poi.
func testAdvisoryFrom(id, summary, introduced string, score float64) Advisory {
	return Advisory{
		ID:       id,
		Summary:  summary,
		Severity: Severity{CVSS31Score: score, BaseSeverity: SeverityClassOf(score)},
		Sources:  []string{"fake"},
		Ranges:   []VersionRange{{Introduced: introduced}},
	}
}

func TestPreviewUpgradeSeparatesResolvedRemainingAndIntroduced(t *testing.T) {
	component := Component{Ecosystem: EcosystemGo, Name: "example.com/lib", Version: "1.2.3", Direct: true}
	resolvedAdvisory := testAdvisory("GO-2024-0001", "first", "1.2.4", 9)
	resolvedAdvisory.Aliases = []string{"CVE-2024-0001"}
	remainingAdvisory := testAdvisory("GO-2024-0002", "second", "2.0.0", 7)
	remainingAdvisory.Aliases = []string{"CVE-2024-0002"}
	introducedAdvisory := testAdvisoryFrom("GO-2024-0003", "third", "1.2.4", 5)
	introducedAdvisory.Aliases = []string{"CVE-2024-0003"}

	report := ScanReport{Findings: []Finding{
		{ID: "one", Advisory: resolvedAdvisory, Component: component},
		{ID: "two", Advisory: remainingAdvisory, Component: component},
	}}
	source := &fakeSource{byKey: map[string][]Advisory{
		"Go:example.com/lib@1.2.4": {remainingAdvisory, introducedAdvisory},
	}}

	preview, err := PreviewUpgrade(context.Background(), []Source{source}, report, component, "1.2.4")
	if err != nil {
		t.Fatalf("PreviewUpgrade: %v", err)
	}
	if preview.Compatibility != CompatibilityPatch {
		t.Fatalf("compatibility = %q, want %q", preview.Compatibility, CompatibilityPatch)
	}
	if ids := impactListIDs(preview.Resolves); strings.Join(ids, ",") != "CVE-2024-0001" {
		t.Fatalf("resolves = %v, want [CVE-2024-0001]", ids)
	}
	if ids := impactListIDs(preview.Remaining); strings.Join(ids, ",") != "CVE-2024-0002" {
		t.Fatalf("remaining = %v, want [CVE-2024-0002]", ids)
	}
	if ids := impactListIDs(preview.Introduces); strings.Join(ids, ",") != "CVE-2024-0003" {
		t.Fatalf("introduces = %v, want [CVE-2024-0003]", ids)
	}
	if !strings.Contains(preview.Advice, "closes 1 advisory") || !strings.Contains(preview.Advice, "brings in 1 new advisory") {
		t.Fatalf("advice %q does not summarize the impact", preview.Advice)
	}
}

func TestPreviewUpgradeRejectsUnusableRequests(t *testing.T) {
	component := Component{Ecosystem: EcosystemGo, Name: "example.com/lib", Version: "1.2.3"}
	source := &fakeSource{byKey: map[string][]Advisory{}}
	report := ScanReport{Findings: []Finding{{ID: "one", Advisory: testAdvisory("GO-1", "s", "1.2.4", 5), Component: component}}}

	if _, err := PreviewUpgrade(context.Background(), []Source{source}, report, component, "1.2.3"); err == nil {
		t.Fatal("same version must be rejected")
	}
	if _, err := PreviewUpgrade(context.Background(), []Source{source}, report, component, ""); err == nil {
		t.Fatal("missing target version must be rejected")
	}
	if _, err := PreviewUpgrade(context.Background(), []Source{source}, ScanReport{}, component, "1.2.4"); err == nil {
		t.Fatal("a component outside the report must be rejected")
	}
}

func TestUpgradeImpactKeepsAdvisoryIdentityPerComponent(t *testing.T) {
	// La stessa CVE può avere correzioni diverse su dipendenze diverse: qui si
	// confrontano solo advisory dello stesso componente, per identità. Un advisory
	// presente sia prima sia dopo non è mai "introdotto".
	to := Component{Ecosystem: EcosystemMaven, Name: "org.example:lib", Version: "1.2.4"}
	stillOpen := testAdvisory("GHSA-aaaa", "same cve", "2.0.0", 7)
	stillOpen.Aliases = []string{"CVE-2024-0009"}
	resolved := testAdvisory("GHSA-bbbb", "fixed now", "1.2.4", 5)

	gotResolved, remaining, introduced := upgradeImpact([]Advisory{stillOpen}, []Advisory{stillOpen}, to)
	if len(gotResolved) != 0 || len(introduced) != 0 || len(remaining) != 1 {
		t.Fatalf("resolved=%d remaining=%d introduced=%d, want the advisory to remain, never to be introduced twice",
			len(gotResolved), len(remaining), len(introduced))
	}
	gotResolved, remaining, introduced = upgradeImpact([]Advisory{resolved}, nil, to)
	if len(gotResolved) != 1 || len(remaining) != 0 || len(introduced) != 0 {
		t.Fatalf("resolved=%d remaining=%d introduced=%d, want the advisory resolved", len(gotResolved), len(remaining), len(introduced))
	}
}

func TestScanFillsRemediationImpactAndBlocked(t *testing.T) {
	root := t.TempDir()
	manifest := filepath.Join(root, "lib.manifest")
	if err := os.WriteFile(manifest, []byte("version 1.2.3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	adapter := &fakeAdapter{ecosystem: EcosystemGo, name: "example.com/lib", editable: true}
	first := testAdvisory("GO-2024-0001", "first", "1.2.4", 9)
	first.Aliases = []string{"CVE-2024-0001"}
	second := testAdvisory("GO-2024-0010", "same fix", "1.2.4", 6)
	second.Aliases = []string{"CVE-2024-0010"}
	introduced := testAdvisoryFrom("GO-2024-0003", "third", "1.2.4", 5)
	introduced.Aliases = []string{"CVE-2024-0003"}
	noFix := testAdvisory("GO-2024-0004", "no fix", "", 8)
	noFix.Aliases = []string{"CVE-2024-0004"}

	source := &fakeSource{byKey: map[string][]Advisory{
		"Go:example.com/lib@1.2.3": {first, second, noFix},
		"Go:example.com/lib@1.2.4": {second, introduced},
	}}
	engine := New([]EcosystemAdapter{adapter}, []Source{source}, nil, nil)

	report, err := engine.Scan(context.Background(), ScanRequest{Root: root})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(report.Findings) != 3 {
		t.Fatalf("findings = %d, want 3", len(report.Findings))
	}
	byID := map[string]Finding{}
	for _, finding := range report.Findings {
		byID[finding.Advisory.ID] = finding
	}

	firstFinding := byID["GO-2024-0001"]
	if strings.Join(firstFinding.Remediation.Resolves, ",") != "CVE-2024-0010" {
		t.Fatalf("resolves = %v, want [CVE-2024-0010]", firstFinding.Remediation.Resolves)
	}
	if strings.Join(firstFinding.Remediation.Introduces, ",") != "CVE-2024-0003" {
		t.Fatalf("introduces = %v, want [CVE-2024-0003]", firstFinding.Remediation.Introduces)
	}
	if firstFinding.Remediation.Compatibility != CompatibilityPatch {
		t.Fatalf("compatibility = %q, want %q", firstFinding.Remediation.Compatibility, CompatibilityPatch)
	}
	if firstFinding.Remediation.Blocked {
		t.Fatalf("blocked reason: %s", firstFinding.Remediation.BlockedReason)
	}

	noFixFinding := byID["GO-2024-0004"]
	if !noFixFinding.Remediation.Blocked {
		t.Fatal("a finding without a fixed version must be blocked, not proposed as a command")
	}
	if !strings.Contains(noFixFinding.Remediation.BlockedReason, "no fixed version") {
		t.Fatalf("blocked reason = %q", noFixFinding.Remediation.BlockedReason)
	}

	// La stessa correzione proposta per due finding elenca l'altro advisory che chiude.
	secondFinding := byID["GO-2024-0010"]
	if strings.Join(secondFinding.Remediation.Resolves, ",") != "CVE-2024-0001" {
		t.Fatalf("resolves = %v, want [CVE-2024-0001]", secondFinding.Remediation.Resolves)
	}
}

func TestScanMarksNotApplicableFixesAsBlocked(t *testing.T) {
	root := t.TempDir()
	manifest := filepath.Join(root, "lib.manifest")
	if err := os.WriteFile(manifest, []byte("version 1.2.3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// L'adapter non sa modificare il manifest: la correzione non è applicabile.
	adapter := &fakeAdapter{ecosystem: EcosystemGo, name: "example.com/lib", editable: false}
	advisory := testAdvisory("GO-2024-0001", "first", "1.2.4", 9)
	source := &fakeSource{byKey: map[string][]Advisory{"Go:example.com/lib@1.2.3": {advisory}}}
	engine := New([]EcosystemAdapter{adapter}, []Source{source}, nil, nil)

	report, err := engine.Scan(context.Background(), ScanRequest{Root: root})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(report.Findings) != 1 {
		t.Fatalf("findings = %d, want 1", len(report.Findings))
	}
	remediation := report.Findings[0].Remediation
	if !remediation.Blocked {
		t.Fatal("a fix that cannot be edited must be blocked")
	}
	if remediation.BlockedReason == "" {
		t.Fatal("a blocked fix must say why")
	}
}

func impactListIDs(impacts []AdvisoryImpact) []string {
	ids := make([]string, 0, len(impacts))
	for _, impact := range impacts {
		ids = append(ids, impact.ID)
	}
	return ids
}
