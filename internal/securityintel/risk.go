package securityintel

import (
	"fmt"
	"strings"
)

// Risk è la priorità calcolata combinando segnali distinti con regole esplicite.
//
// Il motore non usa un unico punteggio magico: CVSS, EPSS, KEV, raggiungibilità,
// esposizione e disponibilità della correzione restano leggibili in Signals, e ogni
// riga di Reasons spiega quale regola ha portato a quella priorità. Un utente deve
// poter contestare una priorità leggendo perché è stata assegnata.
type Risk struct {
	// Priority è la classe operativa: P0 (agisci ora), P1, P2, P3.
	Priority string `json:"priority"`
	// Band è la fascia omogenea usata dai raggruppamenti della dashboard.
	Band string `json:"band"`
	// Score è solo l'ordinamento (0-100). Non è una misura di rischio e non va
	// presentato come tale: serve a mettere prima i finding più urgenti.
	Score float64 `json:"score"`
	// Reasons sono le regole applicate, nell'ordine in cui hanno pesato.
	Reasons []string `json:"reasons,omitempty"`
	// Signals tiene i segnali separati, come vanno letti.
	Signals RiskSignals `json:"signals"`
}

// RiskSignals espone ogni segnale grezzo, senza fonderlo in un solo numero.
type RiskSignals struct {
	CVSSScore    float64      `json:"cvssScore"`
	CVSSClass    string       `json:"cvssClass"`
	EPSS         float64      `json:"epss"`
	KEV          bool         `json:"kev"`
	Reachability Reachability `json:"reachability"`
	Exposure     Exposure     `json:"exposure"`
	// FixAvailable dice se esiste una correzione pubblicata per il componente.
	// Non abbassa la priorità: cambia l'azione, non il rischio.
	FixAvailable bool `json:"fixAvailable"`
	// Direct indica una dipendenza dichiarata: la correzione è locale al manifest.
	Direct bool `json:"direct"`
}

// Le bande di priorità, dalla più urgente.
const (
	BandCritical      = "critical"
	BandHigh          = "high"
	BandMedium        = "medium"
	BandLow           = "low"
	BandInformational = "informational"
)

// PriorityBandToPriority traduce la banda nella classe operativa P0-P3.
func PriorityOfBand(band string) string {
	switch band {
	case BandCritical:
		return "P0"
	case BandHigh:
		return "P1"
	case BandMedium:
		return "P2"
	case BandLow:
		return "P3"
	default:
		return "P3"
	}
}

// EPSS thresholds. Sono soglie operative, non standard: vanno rese configurabili
// quando un utente chiederà di adattarle alla propria tolleranza al rischio.
const (
	// epssActive è la probabilità sopra cui una vulnerabilità è "in via di
	// sfruttamento" e merita di salire di priorità anche senza KEV.
	epssActive = 0.10
	// epssElevated è la soglia di attenzione per vulnerabilità gravi.
	epssElevated = 0.01
)

// AssessRisk calcola la priorità di un finding combinando i segnali con regole
// esplicite. Ogni regola applicata aggiunge una riga a Reasons.
//
// L'ordine delle regole importa: le prime che si applicano decidono la banda, le
// successive la affinano. Il KEV prevale su tutto perché è evidenza di sfruttamento
// reale, non una stima.
func AssessRisk(severity Severity, reachability Reachability, exposure Exposure, direct, fixAvailable bool) Risk {
	signals := RiskSignals{
		CVSSScore:    severity.Score(),
		CVSSClass:    severity.Class(),
		EPSS:         severity.EPSS,
		KEV:          severity.KEV,
		Reachability: reachability,
		Exposure:     exposure,
		FixAvailable: fixAvailable,
		Direct:       direct,
	}

	band := BandInformational
	reasons := []string{}

	reachable := reachabilityRank(reachability) >= reachabilityRank(ReachabilityPotentiallyReachable)
	confirmed := reachability == ReachabilityCalled

	// Regola 1 — Sfruttamento attivo in natura (CISA KEV).
	if severity.KEV {
		band = BandCritical
		reasons = append(reasons, "Listed in the CISA Known Exploited Vulnerabilities catalog: this vulnerability is exploited in the wild.")
		if severity.KEVRansomwareCampaign {
			reasons = append(reasons, "CISA associates it with ongoing ransomware campaigns.")
		}
	}

	// Regola 2 — Probabilità di sfruttamento elevata (EPSS).
	if severity.EPSS >= epssActive {
		if bandBelow(band, BandCritical) {
			band = BandCritical
		}
		reasons = append(reasons, fmt.Sprintf("EPSS %.1f%%: high estimated probability of exploitation within 30 days.", severity.EPSS*100))
	} else if severity.EPSS >= epssElevated && severityRank(severity.Class()) >= severityRank("HIGH") {
		if bandBelow(band, BandHigh) {
			band = BandHigh
		}
		reasons = append(reasons, fmt.Sprintf("EPSS %.1f%%: elevated exploitation probability combined with a %s severity.", severity.EPSS*100, strings.ToLower(severity.Class())))
	}

	// Regola 3 — Gravità critica con codice raggiungibile.
	if severityRank(severity.Class()) >= severityRank("CRITICAL") && confirmed {
		if bandBelow(band, BandCritical) {
			band = BandCritical
		}
		reasons = append(reasons, "Critical severity and the vulnerable code is confirmed reachable from the project.")
	}

	// Regola 4 — Gravità alta con codice raggiungibile.
	if severityRank(severity.Class()) >= severityRank("HIGH") && reachable {
		if bandBelow(band, BandHigh) {
			band = BandHigh
		}
		reasons = append(reasons, fmt.Sprintf("%s severity and the vulnerable code can be reached from the project.", severity.Class()))
	}

	// Regola 5 — Gravità critica senza evidenza di raggiungibilità.
	if severityRank(severity.Class()) >= severityRank("CRITICAL") && !reachable {
		if bandBelow(band, BandHigh) {
			band = BandHigh
		}
		reasons = append(reasons, "Critical severity, but no code path to the vulnerable code was found in the analysis.")
	}

	// Regola 6 — Gravità media con codice raggiungibile.
	if severityRank(severity.Class()) == severityRank("MEDIUM") && reachable {
		if bandBelow(band, BandMedium) {
			band = BandMedium
		}
		reasons = append(reasons, "Medium severity on a code path used by the project.")
	}

	// Regola 7 — Gravità senza segnali di sfruttamento e non raggiungibile.
	if band == BandInformational && severityRank(severity.Class()) >= severityRank("LOW") {
		band = BandLow
		reasons = append(reasons, "Severity is documented but no exploitation signal or reachability evidence raises it.")
	}

	// Regola 8 — Esposizione: una dipendenza di test o di build non espone un servizio.
	// Abbassa la banda di un gradino, ma non la azzera: la correzione resta utile.
	// Non si applica al KEV: una vulnerabilità sfruttata in natura resta tale anche in
	// una dipendenza di test, che gira sulle macchine degli sviluppatori e in CI —
	// che è esattamente la superficie di attacco della supply chain.
	switch exposure {
	case ExposureTest, ExposureBuild:
		if !severity.KEV && bandBelow(BandLow, band) {
			if exposure == ExposureTest {
				reasons = append(reasons, "Test-only dependency: it is not part of the deployed application.")
			} else {
				reasons = append(reasons, "Build-time only component: it runs while building, not in the deployed application.")
			}
			band = bandBelowOf(band, 1)
		}
	}

	// Regola 9 — Nessuna correzione disponibile.
	if !fixAvailable && band != BandInformational {
		reasons = append(reasons, "No fixed version is published yet: plan a mitigation or a replacement, not an upgrade.")
	}

	// Regola 10 — Dipendenza transitive.
	if !direct && band != BandInformational {
		reasons = append(reasons, "Transitive dependency: the fix may need a change in the component that pulls it in.")
	}

	if len(reasons) == 0 {
		reasons = append(reasons, "No severity, exploitation or reachability signal raised this finding.")
	}

	return Risk{
		Priority: PriorityOfBand(band),
		Band:     band,
		Score:    riskScore(signals, band),
		Reasons:  reasons,
		Signals:  signals,
	}
}

// riskScore produce solo un ordinamento stabile. Non è un rischio quantificato e non
// va mostrato come percentuale: la banda e le regole sono la parte che conta.
func riskScore(signals RiskSignals, band string) float64 {
	score := signals.CVSSScore * 6 // 0..60: la gravità tecnica resta il segnale principale
	switch signals.Reachability {
	case ReachabilityCalled:
		score += 20
	case ReachabilityPotentiallyReachable:
		score += 13
	case ReachabilityImported:
		score += 8
	case ReachabilityRequired:
		score += 3
	case ReachabilityUnknown:
		score += 5
	}
	if signals.KEV {
		score += 15
	}
	if signals.EPSS > 0 {
		epss := signals.EPSS * 10
		if epss > 12 {
			epss = 12
		}
		score += epss
	}
	switch signals.Exposure {
	case ExposureRuntime:
		score += 4
	case ExposureUnknown:
		score += 2
	case ExposureBuild:
		score += 1
	}
	if score > 100 {
		score = 100
	}
	// La banda vince su qualsiasi slittamento del punteggio: un P0 non può finire
	// dopo un P1 solo perché l'altro ha accumulato punti sparsi.
	score += float64(bandFloor(band))
	return score
}

// bandFloor è il pavimento del punteggio per banda, così l'ordinamento rispetta le
// regole esplicite invece di contraddirle.
func bandFloor(band string) int {
	switch band {
	case BandCritical:
		return 200
	case BandHigh:
		return 150
	case BandMedium:
		return 100
	case BandLow:
		return 50
	default:
		return 0
	}
}

// bandBelow dice se la banda left è meno grave di right.
func bandBelow(left, right string) bool {
	return severityRank(bandClass(left)) < severityRank(bandClass(right))
}

// bandBelowOf abbassa una banda di n gradini.
func bandBelowOf(band string, steps int) string {
	bands := []string{BandCritical, BandHigh, BandMedium, BandLow, BandInformational}
	for index, candidate := range bands {
		if candidate == band {
			next := index + steps
			if next >= len(bands) {
				next = len(bands) - 1
			}
			return bands[next]
		}
	}
	return band
}

// bandClass mappa una banda sulla scala delle classi di gravità per riutilizzarne
// l'ordinamento.
func bandClass(band string) string {
	switch band {
	case BandCritical:
		return "CRITICAL"
	case BandHigh:
		return "HIGH"
	case BandMedium:
		return "MEDIUM"
	case BandLow:
		return "LOW"
	default:
		return "NONE"
	}
}
