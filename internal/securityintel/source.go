package securityintel

import (
	"context"
	"slices"
)

// Source è una fonte di advisory. Il motore ne consulta più di una e fonde i risultati
// sugli alias: NVD non è sufficiente, perché gli advisory open source vivono in OSV,
// in GitHub Advisory Database e nella Go Vulnerability Database, e una sola fonte copre
// male un ecosistema.
//
// Privacy by design: una Source riceve solo coordinate (nome pacchetto + versione),
// mai sorgenti, nomi di file o contenuti del progetto.
type Source interface {
	// Name è il nome mostrato nella dashboard ("OSV", "Go Vulnerability Database").
	Name() string
	// Query cerca gli advisory che colpiscono i componenti indicati. La chiave del
	// risultato è Component.Key().
	Query(ctx context.Context, components []Component) (map[string][]Advisory, error)
	// Status descrive lo stato dell'ultima consultazione.
	Status() SourceStatus
}

// Enricher completa gli advisory con segnali che nessuna singola fonte possiede:
// l'EPSS di FIRST e il catalogo CISA KEV sono indici separati dalle basi advisory.
type Enricher interface {
	Name() string
	// Enrich modifica gli advisory in place aggiungendo i propri segnali.
	Enrich(ctx context.Context, advisories []Advisory) error
	Status() SourceStatus
}

// mergeAdvisories fonde più descrizioni della stessa vulnerabilità, riconoscendola
// dagli alias. Una CVE può comparire come GHSA-…, come GO-… e come CVE-…: tre righe
// distinte per l'utente sarebbero rumore, e tre correzioni proposte sarebbero un errore.
func mergeAdvisories(groups ...[]Advisory) []Advisory {
	byIdentity := map[string]*Advisory{}
	order := []string{}
	for _, group := range groups {
		for index := range group {
			advisory := group[index]
			if advisory.Withdrawn != "" {
				continue // un advisory ritirato non è più valido
			}
			identity := advisoryIdentity(advisory)
			existing, found := byIdentity[identity]
			if !found {
				copied := advisory
				byIdentity[identity] = &copied
				order = append(order, identity)
				continue
			}
			*existing = mergeAdvisory(*existing, advisory)
		}
	}
	merged := make([]Advisory, 0, len(order))
	for _, identity := range order {
		merged = append(merged, *byIdentity[identity])
	}
	return merged
}

// advisoryIdentity è la firma di una vulnerabilità: il CVE se c'è, altrimenti il
// primo alias o l'ID della fonte.
func advisoryIdentity(advisory Advisory) string {
	if cve := advisory.CVE(); cve != "" {
		return cve
	}
	for _, alias := range advisory.Aliases {
		if alias != "" {
			return alias
		}
	}
	return advisory.ID
}

// mergeAdvisory unisce due descrizioni della stessa vulnerabilità tenendo il meglio:
// il testo più completo, la severità più alta, i riferimenti e le versioni senza
// duplicati.
func mergeAdvisory(left, right Advisory) Advisory {
	merged := left
	if len(right.Summary) > len(merged.Summary) {
		merged.Summary = right.Summary
	}
	if len(right.Details) > len(merged.Details) {
		merged.Details = right.Details
	}
	if merged.Published == "" {
		merged.Published = right.Published
	}
	if right.Modified > merged.Modified {
		merged.Modified = right.Modified
	}
	merged.Severity = MaxSeverity(merged.Severity, right.Severity)
	merged.Aliases = mergeStrings(merged.Aliases, right.Aliases, merged.ID)
	merged.References = mergeStrings(merged.References, right.References, "")
	merged.VulnerableRanges = mergeStrings(merged.VulnerableRanges, right.VulnerableRanges, "")
	merged.FixedVersions = mergeStrings(merged.FixedVersions, right.FixedVersions, "")
	merged.Sources = mergeStrings(merged.Sources, right.Sources, "")
	merged.Ranges = mergeRanges(merged.Ranges, right.Ranges)
	return merged
}

// mergeRanges unisce intervalli di versione senza duplicati: due fonti possono
// descrivere lo stesso intervallo con formulazioni diverse.
func mergeRanges(left, right []VersionRange) []VersionRange {
	result := append([]VersionRange(nil), left...)
	for _, candidate := range right {
		duplicate := slices.Contains(result, candidate)
		if !duplicate {
			result = append(result, candidate)
		}
	}
	return result
}

// enrichAdvisory porta su un advisory i segnali comuni raccolti altrove — testo,
// gravità, EPSS, KEV, riferimenti — senza importare gli intervalli di versione.
//
// Questo conta: la stessa CVE può colpire due dipendenze con correzioni diverse.
// Fondere gli intervalli porterebbe a proporre la versione corretta di un'altra
// libreria, che è esattamente il tipo di errore che fa perdere fiducia allo strumento.
func enrichAdvisory(target, enriched Advisory) Advisory {
	target.Aliases = mergeStrings(target.Aliases, enriched.Aliases, target.ID)
	if len(enriched.Summary) > len(target.Summary) {
		target.Summary = enriched.Summary
	}
	if len(enriched.Details) > len(target.Details) {
		target.Details = enriched.Details
	}
	if target.Published == "" {
		target.Published = enriched.Published
	}
	if enriched.Modified > target.Modified {
		target.Modified = enriched.Modified
	}
	target.Severity = MaxSeverity(target.Severity, enriched.Severity)
	target.References = mergeStrings(target.References, enriched.References, "")
	target.Sources = mergeStrings(target.Sources, enriched.Sources, "")
	return target
}

// mergeStrings unisce due liste senza duplicati, saltando un eventuale valore uguale
// al keep identificativo (per non ripetere l'ID fra i propri alias).
func mergeStrings(left, right []string, skip string) []string {
	result := append([]string(nil), left...)
	seen := map[string]bool{}
	for _, value := range result {
		seen[value] = true
	}
	for _, value := range right {
		if value == "" || value == skip || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

// CanonicalAdvisoryID preferisce il CVE come identificativo mostrato, poi la fonte
// più specifica dell'ecosistema, poi l'ID grezzo.
func CanonicalAdvisoryID(advisory Advisory) string {
	if cve := advisory.CVE(); cve != "" {
		return cve
	}
	return advisory.ID
}
