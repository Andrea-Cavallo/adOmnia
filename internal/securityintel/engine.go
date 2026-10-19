package securityintel

import (
	"context"
	"fmt"
	"sort"
	"time"
)

// Engine è adOmnia Security Intelligence.
//
// Un solo motore, adapter per ogni ecosistema: la logica CVE, la normalizzazione degli
// advisory, il risk model e la remediation sono qui una volta sola. Maven e Go sono due
// adapter; package.json, Cargo.toml e Gradle saranno gli stessi, senza riscrivere nulla.
type Engine struct {
	adapters  []EcosystemAdapter
	sources   []Source
	enrichers []Enricher
	cache     *AdvisoryCache
}

// New crea un motore con gli adapter e le fonti indicati.
func New(adapters []EcosystemAdapter, sources []Source, enrichers []Enricher, cache *AdvisoryCache) *Engine {
	return &Engine{adapters: adapters, sources: sources, enrichers: enrichers, cache: cache}
}

// Ecosystems elenca gli ecosistemi coperti dagli adapter del motore.
func (e *Engine) Ecosystems() []Ecosystem {
	result := make([]Ecosystem, 0, len(e.adapters))
	for _, adapter := range e.adapters {
		result = append(result, adapter.Ecosystem())
	}
	return result
}

// Progress racconta l'avanzamento di una scansione: una scansione silenziosa di
// qualche secondo sembra bloccata, e l'utente la interrompe.
type Progress struct {
	// Phase è la fase corrente ("discover", "resolve", "advisories", "reachability").
	Phase string `json:"phase"`
	// Target è il manifest su cui si lavora, se la fase lo riguarda.
	Target string `json:"target,omitempty"`
	// Done e Total contano gli elementi portati a termine.
	Done  int `json:"done"`
	Total int `json:"total"`
	// Message è il messaggio mostrato all'utente.
	Message string `json:"message"`
}

// ScanRequest descrive cosa analizzare.
type ScanRequest struct {
	// Root è la cartella del workspace da scansionare.
	Root string
	// Options guida la risoluzione delle dipendenze.
	Options ResolveOptions
	// Ecosystems filtra gli ecosistemi da analizzare. Vuoto: tutti quelli supportati.
	Ecosystems []Ecosystem
	// Suppressions sono le ignoranze attive, con motivazione e scadenza.
	Suppressions []Suppression
	// Progress riceve gli aggiornamenti di avanzamento. Può essere nil.
	Progress func(Progress)
}

// Scan esegue la scansione completa del workspace.
//
// La sequenza è volutamente piatta e leggibile: scoperta, risoluzione, advisory,
// arricchimento, raggiungibilità, remediation, rischio. Ogni passo degrada invece di
// fallire: un ecosistema che non si riesce ad analizzare non nasconde gli altri.
func (e *Engine) Scan(ctx context.Context, request ScanRequest) (ScanReport, error) {
	if request.Root == "" {
		return ScanReport{}, fmt.Errorf("no workspace to scan")
	}
	report := ScanReport{Workspace: request.Root, ScannedAt: time.Now().UTC().Format(time.RFC3339), Tool: "adOmnia Security Intelligence"}
	progress := request.Progress
	if progress == nil {
		progress = func(Progress) {}
	}

	options := request.Options
	if options.MaxComponents == 0 {
		options.MaxComponents = DefaultResolveOptions().MaxComponents
	}

	// 1. Scoperta dei manifest, per ecosistema.
	progress(Progress{Phase: "discover", Message: "Looking for dependency manifests…"})
	type resolvedTarget struct {
		target     Target
		adapter    EcosystemAdapter
		resolution Resolution
	}
	targets := []resolvedTarget{}
	for _, adapter := range e.adapters {
		if !e.ecosystemSelected(adapter.Ecosystem(), request.Ecosystems) {
			continue
		}
		found, err := adapter.Discover(ctx, request.Root)
		if err != nil {
			report.Units = append(report.Units, UnitReport{Ecosystem: adapter.Ecosystem(), Errors: []string{err.Error()}})
			continue
		}
		for _, target := range found {
			targets = append(targets, resolvedTarget{target: target, adapter: adapter})
		}
	}

	// 2. Risoluzione delle dipendenze effettive di ogni manifest.
	for index := range targets {
		item := &targets[index]
		progress(Progress{Phase: "resolve", Target: item.target.Manifest, Done: index, Total: len(targets), Message: "Resolving dependencies…"})
		resolution, err := item.adapter.Resolve(ctx, item.target, options)
		if err != nil {
			report.Units = append(report.Units, UnitReport{
				Ecosystem: item.target.Ecosystem,
				Manifest:  item.target.Manifest,
				Name:      item.target.Name,
				Errors:    []string{err.Error()},
			})
			continue
		}
		if len(resolution.Components) > options.MaxComponents {
			resolution.Warnings = append(resolution.Warnings, fmt.Sprintf("dependency graph truncated at %d components", options.MaxComponents))
			resolution.Components = resolution.Components[:options.MaxComponents]
		}
		item.resolution = resolution
	}

	// 3. Consulto le fonti una volta sola per tutti i componenti: il costo di rete
	//    non deve crescere con il numero di manifest o di ecosistemi.
	progress(Progress{Phase: "advisories", Message: "Querying vulnerability databases…"})
	allComponents := []Component{}
	seen := map[string]bool{}
	for _, item := range targets {
		for _, component := range item.resolution.Components {
			if !seen[component.Key()] {
				seen[component.Key()] = true
				allComponents = append(allComponents, component)
			}
		}
	}
	advisories := e.queryAdvisories(ctx, allComponents)

	// 4. Arricchimento: EPSS e CISA KEV aggiungono segnali che nessuna fonte advisory
	//    possiede. Falliscono senza invalidare la scansione.
	flat := make([]Advisory, 0, len(advisories))
	for _, group := range advisories {
		flat = append(flat, group...)
	}
	flat = mergeAdvisories(flat)
	e.enrich(ctx, flat)
	byIdentity := map[string]Advisory{}
	for _, advisory := range flat {
		byIdentity[advisoryIdentity(advisory)] = advisory
	}

	// 5. Costruzione dei finding, con raggiungibilità e remediation per adapter.
	progress(Progress{Phase: "reachability", Message: "Checking whether the vulnerable code is reachable…"})
	findings := []Finding{}
	for index := range targets {
		item := &targets[index]
		if item.target.Manifest == "" {
			continue
		}
		unit := UnitReport{
			Ecosystem:  item.target.Ecosystem,
			Manifest:   item.target.Manifest,
			Name:       item.target.Name,
			Components: item.resolution.Components,
			Analyzed:   true,
			Errors:     item.resolution.Warnings,
		}
		unitFindings := e.buildFindings(item.target, item.adapter, item.resolution.Components, advisories, byIdentity, options)
		analysisFailed := false
		analyzer, hasAnalyzer := item.adapter.(ReachabilityAnalyzer)
		if hasAnalyzer {
			evidence, err := analyzer.AnalyzeReachability(ctx, item.target, unitFindings, options)
			if err == nil && len(evidence) == len(unitFindings) {
				for findingIndex := range unitFindings {
					unitFindings[findingIndex].Evidence = evidence[findingIndex]
					unitFindings[findingIndex].Reachability = normalizeReachability(unitFindings[findingIndex], evidence[findingIndex])
				}
			} else if err != nil {
				// Un'analisi fallita non è "non raggiungibile": i finding restano "non analizzati" e l'utente sa perché.
				unit.Errors = append(unit.Errors, "Reachability analysis failed: "+err.Error())
				analysisFailed = true
			}
		}
		explainUnanalyzed(unitFindings, hasAnalyzer, analysisFailed, options.AllowProcesses)
		if planner, ok := item.adapter.(RemediationPlanner); ok {
			remediations, err := planner.PlanRemediation(ctx, item.target, unitFindings, options)
			if err == nil && len(remediations) == len(unitFindings) {
				for findingIndex := range unitFindings {
					unitFindings[findingIndex].Remediation = remediations[findingIndex]
				}
			}
		}
		// Security Impact Before Update: ogni correzione proposta sa cosa risolve, cosa
		// introduce e se è applicabile in automatico. Va dopo il planner, così non si
		// perdono le proposte specifiche dell'adapter.
		e.fillRemediationImpact(ctx, item.adapter, unitFindings, advisories)
		unit.Findings = unitFindings
		report.Units = append(report.Units, unit)
		findings = append(findings, unitFindings...)
	}

	// 6. Rischio e ordinamento: la dashboard deve mostrare prima ciò che va fatto prima.
	for index := range findings {
		findings[index].Risk = AssessRisk(
			findings[index].Advisory.Severity,
			findings[index].Reachability,
			findings[index].Component.Exposure,
			findings[index].Component.Direct,
			findings[index].Remediation.Strategy != "" && findings[index].Remediation.Strategy != "none",
		)
		findings[index].Ignored = suppressionFor(request.Suppressions, findings[index], report.ScannedAt)
	}
	SortFindings(findings)
	report.Findings = findings
	report.Summary = Summarize(findings)
	report.Sources = e.sourceStatuses()
	return report, nil
}

// buildFindings accoppia ogni componente con gli advisory che lo colpiscono.
func (e *Engine) buildFindings(target Target, adapter EcosystemAdapter, components []Component, advisories map[string][]Advisory, byIdentity map[string]Advisory, options ResolveOptions) []Finding {
	findings := []Finding{}
	for _, component := range components {
		group := advisories[component.Key()]
		for _, advisory := range group {
			// L'advisory arricchito porta EPSS, KEV e testo completo; gli intervalli di
			// versione restano quelli del componente, perché la stessa CVE ha correzioni
			// diverse su dipendenze diverse.
			if enriched, ok := byIdentity[advisoryIdentity(advisory)]; ok {
				advisory = enrichAdvisory(advisory, enriched)
			}
			if !affectsComponent(advisory, component) {
				continue
			}
			finding := Finding{
				ID:           FindingID(component.Ecosystem, component.Name, component.Version, CanonicalAdvisoryID(advisory)),
				Advisory:     advisory,
				Component:    component,
				Reachability: ReachabilityUnknown,
				Evidence:     Evidence{Note: ReachabilityNote(ReachabilityUnknown)},
				Remediation: Remediation{
					Strategy:       remediationStrategy(advisory, component),
					CurrentVersion: component.Version,
					FixedVersion:   firstFixedVersion(advisory),
					Direct:         component.Direct,
				},
			}
			if component.Direct {
				finding.Remediation.IndirectVia = ""
			} else if len(component.DependencyPath) > 1 {
				finding.Remediation.IndirectVia = component.DependencyPath[len(component.DependencyPath)-2]
			}
			findings = append(findings, finding)
		}
	}
	return findings
}

// queryAdvisories interroga tutte le fonti e fonde i risultati sugli alias.
func (e *Engine) queryAdvisories(ctx context.Context, components []Component) map[string][]Advisory {
	return querySources(ctx, e.sources, components)
}

// querySources interroga le fonti indicate e fonde i risultati sugli alias. Una fonte
// non raggiungibile non invalida le altre: una consultazione degradata è meglio di
// nessuna. Ogni voce è già fusa per componente; si fonde di nuovo per identità così
// due fonti che descrivono la stessa CVE non generano due finding.
func querySources(ctx context.Context, sources []Source, components []Component) map[string][]Advisory {
	merged := map[string][]Advisory{}
	for _, source := range sources {
		group, err := source.Query(ctx, components)
		if err != nil || group == nil {
			continue // una fonte non raggiungibile non invalida le altre
		}
		for key, advisories := range group {
			merged[key] = mergeAdvisories(merged[key], advisories)
		}
	}
	for key, group := range merged {
		merged[key] = mergeAdvisories(group)
	}
	return merged
}

// enrich applica gli arricchitori, uno alla volta: un arricchitore non disponibile
// non deve impedire agli altri di lavorare.
func (e *Engine) enrich(ctx context.Context, advisories []Advisory) {
	for _, enricher := range e.enrichers {
		_ = enricher.Enrich(ctx, advisories)
	}
}

// sourceStatuses riporta lo stato di ogni fonte consultata.
func (e *Engine) sourceStatuses() []SourceStatus {
	statuses := []SourceStatus{}
	for _, source := range e.sources {
		statuses = append(statuses, source.Status())
	}
	for _, enricher := range e.enrichers {
		statuses = append(statuses, enricher.Status())
	}
	if e.cache != nil && e.cache.Count() > 0 {
		statuses = append(statuses, SourceStatus{
			Name:        "Local advisory database",
			Endpoint:    e.cache.Dir,
			LastUpdated: e.cache.LastUpdated(),
			Offline:     true,
		})
	}
	sort.SliceStable(statuses, func(left, right int) bool { return statuses[left].Name < statuses[right].Name })
	return statuses
}

// ecosystemSelected dice se un ecosistema è fra quelli richiesti.
func (e *Engine) ecosystemSelected(ecosystem Ecosystem, selected []Ecosystem) bool {
	if len(selected) == 0 {
		return true
	}
	for _, candidate := range selected {
		if candidate == ecosystem {
			return true
		}
	}
	return false
}

// adapterFor ritrova l'adapter che ha prodotto un componente.
func (e *Engine) adapterFor(ecosystem Ecosystem) EcosystemAdapter {
	for _, adapter := range e.adapters {
		if adapter.Ecosystem() == ecosystem {
			return adapter
		}
	}
	return nil
}

// affectsComponent dice se l'advisory riguarda davvero il componente risolto.
// Si valuta per intervalli di versione, non per confronto con una singola versione
// corretta: la stessa vulnerabilità può colpire la 1.x e la 2.x.
func affectsComponent(advisory Advisory, component Component) bool {
	if len(advisory.Ranges) == 0 && len(advisory.FixedVersions) == 0 {
		return true // nessuna informazione di versione: meglio un falso positivo che un falso negativo
	}
	if len(advisory.Ranges) > 0 {
		for _, rng := range advisory.Ranges {
			if rng.Includes(component.Version) {
				return true
			}
		}
		return false
	}
	// Solo versioni corrette note: la versione è affetta se è precedente a tutte.
	for _, fixed := range advisory.FixedVersions {
		if compareVersions(component.Version, fixed) >= 0 {
			return false
		}
	}
	return true
}

// remediationStrategy decide la natura dell'intervento.
func remediationStrategy(advisory Advisory, component Component) string {
	if len(advisory.FixedVersions) == 0 {
		return "mitigate"
	}
	return "upgrade"
}

// firstFixedVersion è la prima versione corretta pubblicata.
func firstFixedVersion(advisory Advisory) string {
	if len(advisory.FixedVersions) == 0 {
		return ""
	}
	best := advisory.FixedVersions[0]
	for _, candidate := range advisory.FixedVersions[1:] {
		if compareVersions(candidate, best) < 0 {
			best = candidate
		}
	}
	return best
}

// normalizeReachability combina ciò che l'adapter ha trovato con ciò che il finding
// già sapeva, senza mai promuovere un'ipotesi a conferma.
func normalizeReachability(finding Finding, evidence Evidence) Reachability {
	level := finding.Reachability
	if evidence.Confirmed {
		return ReachabilityCalled
	}
	if len(evidence.CallPaths) > 0 {
		return ReachabilityCalled
	}
	if reachabilityRank(evidenceNormalizeLevel(evidence)) > reachabilityRank(level) {
		level = evidenceNormalizeLevel(evidence)
	}
	return level
}

// evidenceNormalizeLevel deriva il livello dai soli dati dell'evidenza.
func evidenceNormalizeLevel(evidence Evidence) Reachability {
	switch {
	case len(evidence.CallPaths) > 0:
		return ReachabilityCalled
	case len(evidence.Symbols) > 0:
		return ReachabilityPotentiallyReachable
	case len(evidence.Packages) > 0:
		return ReachabilityImported
	// Una tecnica di analisi senza risultati non dice che il modulo sia "solo nel
	// grafo di build": un'analisi inconcludente resta "unknown", che reachability.go
	// definisce "non analizzata o inconcludente" e che non va mai letto come sicuro.
	case evidence.Method != "" && evidence.Method != EvidenceMethodNone && evidence.Method != EvidenceMethodBytecodeReference:
		return ReachabilityRequired
	default:
		return ReachabilityUnknown
	}
}

// suppressionFor trova la soppressione attiva per un finding.
func suppressionFor(suppressions []Suppression, finding Finding, now string) *Suppression {
	for index := range suppressions {
		candidate := &suppressions[index]
		if candidate.Reason == "" {
			continue // un'ignoranza senza motivazione non è valida
		}
		if candidate.Expired(now) {
			continue // scaduta, il finding torna attivo
		}
		if suppressionMatches(*candidate, finding) {
			return candidate
		}
	}
	return nil
}

// suppressionMatches dice se una soppressione riguarda il finding. Deve identificarlo
// in modo esplicito: per advisori (ID o alias) e, se serve, per componente. Una
// soppressione che non dice cosa copre non è un'ignoranza, è una rimozione silenziosa.
func suppressionMatches(suppression Suppression, finding Finding) bool {
	if suppression.Component != "" && suppression.Component != finding.Component.Name {
		return false
	}
	if len(suppression.AdvisoryIDs) == 0 {
		return suppression.Component != ""
	}
	for _, id := range suppression.AdvisoryIDs {
		if id == finding.Advisory.ID || id == CanonicalAdvisoryID(finding.Advisory) {
			return true
		}
		for _, alias := range finding.Advisory.Aliases {
			if id == alias {
				return true
			}
		}
	}
	return false
}

// explainUnanalyzed dice, per ogni finding rimasto "non analizzato", perché: l'utente non deve indovinarlo. Se
// l'adapter ha già dato un motivo (es. govulncheck ha girato ma non segnala l'advisory) lo si lascia.
func explainUnanalyzed(findings []Finding, hasAnalyzer, failed, allowProcesses bool) {
	for index := range findings {
		finding := &findings[index]
		if finding.Reachability != ReachabilityUnknown || finding.Evidence.Why != "" {
			continue
		}
		switch {
		case !hasAnalyzer:
			finding.Evidence.Why = "No reachability analysis for this ecosystem yet"
		case failed:
			finding.Evidence.Why = "The analysis failed: see the warning above"
		case !allowProcesses:
			finding.Evidence.Why = "Deep analysis is off"
		default:
			finding.Evidence.Why = "The analysis did not reach a conclusion"
		}
	}
}
