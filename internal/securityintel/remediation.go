package securityintel

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
)

// AdvisoryImpact è la riga d'impatto di un advisory in un UpgradePreview: ciò che
// l'utente deve sapere prima di decidere, senza il testo completo dell'advisory.
type AdvisoryImpact struct {
	// ID è l'identificativo mostrato (il CVE quando c'è, altrimenti quello della fonte).
	ID      string   `json:"id"`
	Aliases []string `json:"aliases,omitempty"`
	Summary string   `json:"summary,omitempty"`
	// Severity è la classe normalizzata: CRITICAL, HIGH, MEDIUM, LOW, NONE.
	Severity string `json:"severity"`
	// CVSS è il punteggio più autorevole disponibile (4.0 della fonte, altrimenti 3.1).
	CVSS float64 `json:"cvss,omitempty"`
	// EPSS è la probabilità di sfruttamento entro 30 giorni. Non è una gravità.
	EPSS float64 `json:"epss,omitempty"`
	// KEV dice che l'advisory è nel catalogo CISA delle vulnerabilità sfruttate.
	KEV bool `json:"kev,omitempty"`
	// FixedVersion è la versione che chiude l'advisory, se pubblicata.
	FixedVersion string `json:"fixedVersion,omitempty"`
}

// UpgradePreview è l'impatto di sicurezza di un aggiornamento, prima di farlo.
//
// Risponde alle tre domande che un utente si pone prima di toccare un manifest:
// quali vulnerabilità spariscono, quali restano e quali nuove porta dentro la
// versione target. Gli intervalli di versione sono per componente: la stessa CVE ha
// correzioni diverse su dipendenze diverse, e qui si confrontano solo advisory dello
// stesso componente.
type UpgradePreview struct {
	// Component è il componente aggiornato, con la versione corrente.
	Component Component `json:"component"`
	// CurrentVersion e TargetVersion delimitano il passo simulato.
	CurrentVersion string `json:"currentVersion"`
	TargetVersion  string `json:"targetVersion"`
	// Compatibility è la classe di rottura (patch, minor, major, unknown).
	Compatibility string `json:"compatibility"`
	// Resolves sono gli advisory che l'aggiornamento elimina.
	Resolves []AdvisoryImpact `json:"resolves,omitempty"`
	// Remaining sono gli advisory che restano dopo l'aggiornamento.
	Remaining []AdvisoryImpact `json:"remaining,omitempty"`
	// Introduces sono gli advisory che la versione target porta dentro il progetto.
	Introduces []AdvisoryImpact `json:"introduces,omitempty"`
	// Advice è il consiglio operativo in linguaggio umano.
	Advice string `json:"advice"`
	// Sources elenca le fonti consultate per il preview e il loro stato.
	Sources []SourceStatus `json:"sources,omitempty"`
}

// PreviewUpgrade simula l'aggiornamento di un componente a una versione target.
//
// Non modifica nulla: interroga le stesse Source per il componente alla versione
// target e confronta i due set per identità advisory (advisoryIdentity). Il set
// corrente viene dal report di scansione già disponibile, così il confronto non
// ripete la consultazione delle fonti.
func PreviewUpgrade(ctx context.Context, sources []Source, report ScanReport, component Component, targetVersion string) (UpgradePreview, error) {
	if component.Name == "" {
		return UpgradePreview{}, fmt.Errorf("no component to preview")
	}
	targetVersion = strings.TrimSpace(targetVersion)
	if targetVersion == "" {
		return UpgradePreview{}, fmt.Errorf("no target version to preview")
	}
	if CompareVersions(targetVersion, component.Version) == 0 {
		return UpgradePreview{}, fmt.Errorf("%s is already at version %s", component.Name, targetVersion)
	}

	preview := UpgradePreview{
		Component:      component,
		CurrentVersion: component.Version,
		TargetVersion:  targetVersion,
		Compatibility:  CompatibilityClassOf(component.Version, targetVersion),
	}

	current := reportAdvisoriesFor(report, component)
	if current == nil {
		return UpgradePreview{}, fmt.Errorf("%s@%s is not in the scan report: scan the workspace first", component.Name, component.Version)
	}

	to := component
	to.Version = targetVersion
	target := advisoriesAffecting(querySources(ctx, sources, []Component{to})[to.Key()], to)

	resolved, remaining, introduced := upgradeImpact(current, target, to)
	preview.Resolves = impactsOf(resolved)
	preview.Remaining = impactsOf(remaining)
	preview.Introduces = impactsOf(introduced)
	for _, source := range sources {
		preview.Sources = append(preview.Sources, source.Status())
	}
	consulted, failed := sourcesConsulted(sources)
	preview.Advice = upgradeAdvice(preview, consulted, failed)
	return preview, nil
}

// PreviewUpgrade è il preview con le fonti del motore.
func (e *Engine) PreviewUpgrade(ctx context.Context, report ScanReport, component Component, targetVersion string) (UpgradePreview, error) {
	return PreviewUpgrade(ctx, e.sources, report, component, targetVersion)
}

// reportAdvisoriesFor estrae dal report gli advisory che colpiscono il componente,
// già fusi per identità. Ritorna nil se il componente non è nel report.
func reportAdvisoriesFor(report ScanReport, component Component) []Advisory {
	found := []Advisory{}
	matched := false
	for _, finding := range report.Findings {
		if finding.Component.Ecosystem != component.Ecosystem ||
			finding.Component.Name != component.Name ||
			finding.Component.Version != component.Version {
			continue
		}
		matched = true
		found = append(found, finding.Advisory)
	}
	if !matched {
		return nil
	}
	return advisoriesAffecting(mergeAdvisories(found), component)
}

// advisoriesAffecting filtra gli advisory che colpiscono davvero il componente,
// scartando quelli ritirati. Gli intervalli si valutano per componente: la stessa
// CVE può avere correzioni diverse su dipendenze diverse.
func advisoriesAffecting(advisories []Advisory, component Component) []Advisory {
	result := make([]Advisory, 0, len(advisories))
	for _, advisory := range advisories {
		if advisory.Withdrawn != "" {
			continue
		}
		if affectsComponent(advisory, component) {
			result = append(result, advisory)
		}
	}
	return result
}

// upgradeImpact confronta gli advisory che affliggono il componente oggi con quelli
// che lo affliggerebbero alla versione target, per identità advisory.
//
// "risolti" sono quelli che la versione target non tocca più, "restano" quelli che la
// toccano ancora, "introdotti" quelli presenti solo alla versione target. Un advisory
// senza informazioni di versione viene trattato come ancora presente: meglio avvisare
// che rassicurare a torto.
func upgradeImpact(current, target []Advisory, to Component) (resolved, remaining, introduced []Advisory) {
	identities := map[string]bool{}
	for _, advisory := range current {
		identities[advisoryIdentity(advisory)] = true
		if affectsComponent(advisory, to) {
			remaining = append(remaining, advisory)
		} else {
			resolved = append(resolved, advisory)
		}
	}
	for _, advisory := range target {
		if !affectsComponent(advisory, to) {
			continue
		}
		if !identities[advisoryIdentity(advisory)] {
			introduced = append(introduced, advisory)
		}
	}
	return resolved, remaining, introduced
}

// impactsOf traduce gli advisory in righe d'impatto, ordinate per gravità.
func impactsOf(advisories []Advisory) []AdvisoryImpact {
	impacts := make([]AdvisoryImpact, 0, len(advisories))
	for _, advisory := range advisories {
		impacts = append(impacts, advisoryImpactOf(advisory))
	}
	sort.SliceStable(impacts, func(left, right int) bool {
		a, b := impacts[left], impacts[right]
		if severityRank(a.Severity) != severityRank(b.Severity) {
			return severityRank(a.Severity) > severityRank(b.Severity)
		}
		if a.KEV != b.KEV {
			return a.KEV
		}
		return a.ID < b.ID
	})
	return impacts
}

// advisoryImpactOf estrae da un advisory le sole informazioni che servono a decidere.
func advisoryImpactOf(advisory Advisory) AdvisoryImpact {
	return AdvisoryImpact{
		ID:           CanonicalAdvisoryID(advisory),
		Aliases:      advisory.Aliases,
		Summary:      advisory.Summary,
		Severity:     advisory.Severity.Class(),
		CVSS:         advisory.Severity.Score(),
		EPSS:         advisory.Severity.EPSS,
		KEV:          advisory.Severity.KEV,
		FixedVersion: firstFixedVersion(advisory),
	}
}

// impactIDs ritorna gli identificativi delle righe d'impatto, senza quella di un
// advisory escluso (il finding stesso, quando si elencano gli "altri" che si chiudono).
func impactIDs(advisories []Advisory, excludeIdentity string) []string {
	ids := []string{}
	for _, advisory := range advisories {
		identity := advisoryIdentity(advisory)
		if identity == excludeIdentity || CanonicalAdvisoryID(advisory) == excludeIdentity {
			continue
		}
		ids = append(ids, CanonicalAdvisoryID(advisory))
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		return nil
	}
	return ids
}

// sourcesConsulted riassume se le fonti hanno risposto: un preview consultato senza
// esito non può promettere che "non ci sono nuove vulnerabilità".
func sourcesConsulted(sources []Source) (consulted int, failed int) {
	for _, source := range sources {
		status := source.Status()
		if status.Error != "" {
			failed++
			continue
		}
		consulted++
	}
	return consulted, failed
}

// upgradeAdvice scrive il consiglio operativo del preview: cosa conviene fare e perché.
func upgradeAdvice(preview UpgradePreview, consulted, failed int) string {
	parts := []string{}
	switch preview.Compatibility {
	case CompatibilityMajor:
		parts = append(parts, "Major upgrade: expect breaking changes and run the test suite before merging.")
	case CompatibilityMinor:
		parts = append(parts, "Minor upgrade: usually compatible, still verify the build.")
	case CompatibilityPatch:
		parts = append(parts, "Patch upgrade: low regression risk.")
	default:
		parts = append(parts, "The version scheme is not interpretable: verify compatibility manually.")
	}
	switch {
	case len(preview.Resolves) == 0:
		parts = append(parts, "The upgrade does not close any known advisory on this component.")
	case len(preview.Resolves) == 1:
		parts = append(parts, "The upgrade closes 1 advisory.")
	default:
		parts = append(parts, fmt.Sprintf("The upgrade closes %d advisories.", len(preview.Resolves)))
	}
	switch {
	case len(preview.Remaining) == 1:
		parts = append(parts, "1 advisory remains after the upgrade: plan a further step.")
	case len(preview.Remaining) > 1:
		parts = append(parts, fmt.Sprintf("%d advisories remain after the upgrade: plan a further step.", len(preview.Remaining)))
	}
	switch {
	case len(preview.Introduces) == 1:
		parts = append(parts, "The upgrade brings in 1 new advisory: review it before applying.")
	case len(preview.Introduces) > 1:
		parts = append(parts, fmt.Sprintf("The upgrade brings in %d new advisories: review them before applying.", len(preview.Introduces)))
	}
	if failed > 0 && consulted == 0 {
		parts = append(parts, "The advisory databases could not be consulted: this preview may be incomplete.")
	}
	return strings.Join(parts, " ")
}

// fillRemediationImpact completa ogni Remediation con l'impatto dell'aggiornamento
// proposto: ciò che risolve, ciò che introduce e se la modifica è applicabile in
// automatico.
//
// Quando una correzione non è applicabile — nessuna versione corretta pubblicata,
// versione gestita da un parent/BOM, dipendenza transitive non dichiarata — il
// finding viene marcato Blocked con il motivo, invece di proporre un comando che
// fallirebbe.
func (e *Engine) fillRemediationImpact(ctx context.Context, adapter EcosystemAdapter, findings []Finding, advisories map[string][]Advisory) {
	if len(findings) == 0 {
		return
	}
	for index := range findings {
		remediation := &findings[index].Remediation
		if remediation.FixedVersion != "" {
			continue
		}
		remediation.Strategy = "mitigate"
		remediation.Blocked = true
		remediation.BlockedReason = "no fixed version is published for this advisory"
		if remediation.Note == "" {
			remediation.Note = "No automatic fix: mitigate the exposure or accept the risk with a written reason and an expiry."
		}
	}

	// Le versioni target si consultano una volta sola per componente: il costo di
	// rete non deve crescere con il numero di finding.
	targets := []Component{}
	seen := map[string]bool{}
	for index := range findings {
		remediation := findings[index].Remediation
		if remediation.Blocked || remediation.FixedVersion == "" {
			continue
		}
		to := findings[index].Component
		to.Version = remediation.FixedVersion
		if !seen[to.Key()] {
			seen[to.Key()] = true
			targets = append(targets, to)
		}
	}
	targetAdvisories := map[string][]Advisory{}
	if len(targets) > 0 {
		targetAdvisories = e.queryAdvisories(ctx, targets)
	}

	for index := range findings {
		finding := &findings[index]
		remediation := &finding.Remediation
		if remediation.Blocked || remediation.FixedVersion == "" {
			continue
		}
		component := finding.Component
		to := component
		to.Version = remediation.FixedVersion
		remediation.Compatibility = CompatibilityClassOf(component.Version, to.Version)
		if reason := manifestEditBlockReason(adapter, component, to.Version); reason != "" {
			remediation.Blocked = true
			remediation.BlockedReason = reason
			continue
		}
		current := advisoriesAffecting(advisories[component.Key()], component)
		resolved, _, introduced := upgradeImpact(current, advisoriesAffecting(targetAdvisories[to.Key()], to), to)
		remediation.Resolves = impactIDs(resolved, advisoryIdentity(finding.Advisory))
		remediation.Introduces = impactIDs(introduced, "")
	}
}

// manifestEditBlockReason prova la modifica del manifest su un testo in memoria e
// spiega perché non è applicabile. Ritorna vuoto quando la modifica è possibile.
func manifestEditBlockReason(adapter EcosystemAdapter, component Component, targetVersion string) string {
	editor, ok := adapter.(UpgradeEditor)
	if !ok {
		return "automatic remediation is not available for this ecosystem"
	}
	if component.Manifest == "" {
		return "the component is not declared by any manifest in this workspace"
	}
	text, err := os.ReadFile(component.Manifest)
	if err != nil {
		return fmt.Sprintf("the manifest could not be read: %v", err)
	}
	if _, err := editor.UpgradeManifest(string(text), component, targetVersion); err != nil {
		return err.Error()
	}
	return ""
}
