package securityintel

import "sort"

// Finding è una vulnerabilità che colpisce un componente effettivamente risolto nel
// grafo. È l'unità di lavoro del motore: una stessa Advisory che colpisce tre
// dipendenze diverse produce tre Finding, perché tre sono le correzioni da valutare.
type Finding struct {
	// ID è stabile fra le scansioni: permette di confrontare lo storico, di ignorare
	// un finding con motivazione e di riconoscerlo dopo un aggiornamento.
	ID        string    `json:"id"`
	Advisory  Advisory  `json:"advisory"`
	Component Component `json:"component"`
	// Reachability è il livello di evidenza raggiunto dall'analisi.
	Reachability Reachability `json:"reachability"`
	// Evidence spiega come è stata stabilita la raggiungibilità.
	Evidence Evidence `json:"evidence"`
	Risk     Risk     `json:"risk"`
	// Remediation descrive la correzione più sicura disponibile.
	Remediation Remediation `json:"remediation"`
	// Ignored valorizzato se l'utente ha soppresso il finding con motivazione e
	// scadenza. Un finding ignorato resta nel report: non sparisce, cambia stato.
	Ignored *Suppression `json:"ignored,omitempty"`
}

// Remediation è la correzione proposta, con ciò che risolve e ciò che introduce.
type Remediation struct {
	// Strategy è la natura dell'intervento: "upgrade", "replace", "mitigate", "none".
	Strategy string `json:"strategy"`
	// CurrentVersion e FixedVersion delimitano il passo.
	CurrentVersion string `json:"currentVersion"`
	FixedVersion   string `json:"fixedVersion,omitempty"`
	// Direct indica se il fix si applica al manifest dell'unità o a un ascendente.
	Direct bool `json:"direct"`
	// IndirectVia è il componente che trascina la dipendenza vulnerabile.
	IndirectVia string `json:"indirectVia,omitempty"`
	// Compatibility avverte del rischio di regressione dell'aggiornamento.
	Compatibility string `json:"compatibility,omitempty"`
	// Commands sono i comandi che applicano la correzione, già pronti da rivedere.
	Commands []string `json:"commands,omitempty"`
	// Note è il consiglio operativo in linguaggio umano.
	Note string `json:"note,omitempty"`
	// Resolves elenca gli altri advisory che la stessa correzione chiude.
	Resolves []string `json:"resolves,omitempty"`
	// Introduces elenca gli advisory che la correzione porta dentro il progetto.
	// È il cuore di "Security Impact Before Update".
	Introduces []string `json:"introduces,omitempty"`
	// Blocked dice che la correzione non è applicabile automaticamente.
	Blocked bool `json:"blocked,omitempty"`
	// BlockedReason spiega perché (es. nessuna versione compatibile, BOM vincolante).
	BlockedReason string `json:"blockedReason,omitempty"`
}

// CompatibilityClass classifica il rischio di rottura di un aggiornamento.
const (
	CompatibilityPatch   = "patch"   // stesso minor: quasi mai rompe
	CompatibilityMinor   = "minor"   // stessa major: di solito compatibile
	CompatibilityMajor   = "major"   // major diversa: può rompere
	CompatibilityUnknown = "unknown" // version scheme non interpretabile
)

// Suppression è un'ignoranza consapevole: senza motivazione e scadenza non è
// accettabile. Un progetto può decidere di non correggere, ma deve saperlo e deve
// rivedere la decisione quando la scadenza arriva.
type Suppression struct {
	// Reason è obbligatoria: un'ignoranza senza motivo decade.
	Reason string `json:"reason"`
	// Author chi ha preso la decisione.
	Author string `json:"author,omitempty"`
	// CreatedAt e ExpiresAt delimitano la validità. Scaduta, il finding torna attivo.
	CreatedAt string `json:"createdAt,omitempty"`
	ExpiresAt string `json:"expiresAt,omitempty"`
	// AdvisoryIDs identifica quali vulnerabilità sono state accettate: ID o alias,
	// così funziona sia con il CVE sia con l'ID della fonte.
	AdvisoryIDs []string `json:"advisoryIds,omitempty"`
	// Component limita la soppressione a un componente specifico.
	Component string `json:"component,omitempty"`
}

// Expired dice se la soppressione non è più valida alla data indicata (RFC 3339).
func (s Suppression) Expired(now string) bool {
	if s.ExpiresAt == "" {
		return false
	}
	return s.ExpiresAt <= now
}

// FindingID costruisce l'identificatore stabile di un finding.
func FindingID(ecosystem Ecosystem, component, version, advisoryID string) string {
	return string(ecosystem) + "|" + component + "@" + version + "|" + advisoryID
}

// Summary raccoglie i conteggi della dashboard. I totali sono per finding, non per
// advisory: la stessa CVE su tre dipendenze è tre interventi.
type Summary struct {
	Findings          int `json:"findings"`
	Critical          int `json:"critical"`
	High              int `json:"high"`
	Medium            int `json:"medium"`
	Low               int `json:"low"`
	Other             int `json:"other"`
	ActivelyExploited int `json:"activelyExploited"`
	FixAvailable      int `json:"fixAvailable"`
	Reachable         int `json:"reachable"`
	Ignored           int `json:"ignored"`
}

// Summarize calcola i conteggi di un insieme di finding.
func Summarize(findings []Finding) Summary {
	summary := Summary{}
	for _, finding := range findings {
		if finding.Ignored != nil {
			summary.Ignored++
			continue
		}
		summary.Findings++
		switch finding.Risk.Band {
		case BandCritical:
			summary.Critical++
		case BandHigh:
			summary.High++
		case BandMedium:
			summary.Medium++
		case BandLow:
			summary.Low++
		default:
			summary.Other++
		}
		if finding.Risk.Signals.KEV {
			summary.ActivelyExploited++
		}
		if finding.Risk.Signals.FixAvailable {
			summary.FixAvailable++
		}
		if reachabilityRank(finding.Reachability) >= reachabilityRank(ReachabilityPotentiallyReachable) {
			summary.Reachable++
		}
	}
	return summary
}

// SourceStatus racconta lo stato di una fonte di advisory: una dashboard di sicurezza
// che non dice quali database ha consultato non è attendibile.
type SourceStatus struct {
	Name string `json:"name"`
	// Endpoint è l'URL o il percorso del database locale consultato.
	Endpoint string `json:"endpoint,omitempty"`
	// LastUpdated è la data dell'ultimo aggiornamento della fonte, se nota.
	LastUpdated string `json:"lastUpdated,omitempty"`
	// Offline indica che i dati sono arrivati dal database locale.
	Offline bool `json:"offline"`
	// Error riporta un problema di consultazione, senza bloccare la scansione.
	Error string `json:"error,omitempty"`
}

// UnitReport è l'esito della scansione di un singolo manifest.
type UnitReport struct {
	// Ecosystem e Manifest identificano l'unità analizzata.
	Ecosystem Ecosystem `json:"ecosystem"`
	// Manifest è il file assoluto del manifest (pom.xml, go.mod, go.work).
	Manifest string `json:"manifest"`
	// Name è il nome logico dell'unità (artifactId, module path).
	Name string `json:"name"`
	// Components sono le dipendenze effettivamente risolte.
	Components []Component `json:"components"`
	// Findings sono i finding dell'unità.
	Findings []Finding `json:"findings"`
	// Errors riporta i problemi di risoluzione (Maven offline, BOM irraggiungibile…).
	Errors []string `json:"errors,omitempty"`
	// Analyzed dice che la risoluzione delle dipendenze è andata a buon fine.
	Analyzed bool `json:"analyzed"`
}

// ScanReport è il risultato completo di una scansione del workspace.
type ScanReport struct {
	// Workspace è la cartella analizzata.
	Workspace string `json:"workspace"`
	ScannedAt string `json:"scannedAt"`
	// Sources elenca le fonti consultate e il loro stato.
	Sources []SourceStatus `json:"sources,omitempty"`
	// Units sono gli esiti per manifest.
	Units []UnitReport `json:"units"`
	// Findings è la vista piatta, già ordinata per priorità.
	Findings []Finding `json:"findings"`
	Summary  Summary   `json:"summary"`
	// GeneratedAt del report HTML/JSON/SARIF esportato.
	Tool string `json:"tool,omitempty"`
}

// SortFindings ordina per priorità di rischio, poi per gravità, ecosistema e
// componente: l'utente deve trovare in cima ciò che va fatto prima.
//
// L'ordinamento rispetta prima la banda e solo poi il punteggio: un P0 non può mai
// seguire un P1, anche se un costruttore esterno ha imposto punteggi arbitrari.
func SortFindings(findings []Finding) {
	sort.SliceStable(findings, func(left, right int) bool {
		a, b := findings[left], findings[right]
		if bandFloor(a.Risk.Band) != bandFloor(b.Risk.Band) {
			return bandFloor(a.Risk.Band) > bandFloor(b.Risk.Band)
		}
		if a.Risk.Score != b.Risk.Score {
			return a.Risk.Score > b.Risk.Score
		}
		if a.Component.Ecosystem != b.Component.Ecosystem {
			return a.Component.Ecosystem < b.Component.Ecosystem
		}
		if a.Component.Name != b.Component.Name {
			return a.Component.Name < b.Component.Name
		}
		return a.Advisory.ID < b.Advisory.ID
	})
}
