package securityintel

import (
	"strconv"
	"strings"
)

// Severity porta i segnali di gravità ed exploitability di un advisory tenendoli
// separati. Il CVSS è una gravità tecnica, l'EPSS è una probabilità di sfruttamento
// nei prossimi 30 giorni, il CISA KEV è evidenza di sfruttamento già avvenuto: sono
// tre cose diverse e il motore non le fonde in un unico numero prima del risk model.
type Severity struct {
	// CVSS31Vector è il vettore CVSS 3.1 completo, se presente.
	CVSS31Vector string `json:"cvss31Vector,omitempty"`
	// CVSS31Score è il punteggio base 3.1. Calcolato dal vettore se la fonte non lo dà.
	CVSS31Score float64 `json:"cvss31Score,omitzero"`
	// CVSS40Vector è il vettore CVSS 4.0 completo, se presente.
	CVSS40Vector string `json:"cvss40Vector,omitempty"`
	// CVSS40Score è il punteggio base 4.0. La fonte autorevole (NVD, GHSA) prevale;
	// quando non lo pubblica il motore lo calcola dal vettore con l'algoritmo delle
	// macrovector del documento FIRST (cvss4.go, verificato sui reference vector
	// ufficiali) e lo dichiara con ScoreSource "computed".
	CVSS40Score float64 `json:"cvss40Score,omitzero"`
	// ScoreSource dice chi ha fornito il punteggio ("nvd", "ghsa", "osv", "computed").
	ScoreSource string `json:"scoreSource,omitempty"`
	// BaseSeverity è la classe normalizzata: CRITICAL, HIGH, MEDIUM, LOW, NONE.
	BaseSeverity string `json:"baseSeverity,omitempty"`
	// EPSS è la probabilità stimata di sfruttamento entro 30 giorni, in [0,1].
	// Non è una gravità: una EPSS alta su una gravità bassa è comunque un rischio.
	EPSS float64 `json:"epss,omitzero"`
	// EPSSPercentile è la posizione della EPSS rispetto a tutte le CVE note, in [0,1].
	EPSSPercentile float64 `json:"epssPercentile,omitzero"`
	// KEV indica che la vulnerabilità è nel catalogo CISA Known Exploited Vulnerabilities.
	KEV bool `json:"kev"`
	// KEVDueDate è la data entro cui CISA impone la correzione ai soggetti federali.
	KEVDueDate string `json:"kevDueDate,omitempty"`
	// KEVRansomwareCampaign indica che CISA la associa a campagne ransomware in corso.
	KEVRansomwareCampaign bool `json:"kevRansomwareCampaign,omitzero"`
}

// SeverityClass enumera le classi di gravità normalizzate, dal più grave.
var SeverityClass = []string{"CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"}

// severityRank ordina le classi: più alto è il numero, più grave è la classe.
func severityRank(class string) int {
	switch strings.ToUpper(class) {
	case "CRITICAL":
		return 5
	case "HIGH":
		return 4
	case "MEDIUM":
		return 3
	case "LOW":
		return 2
	case "NONE":
		return 1
	default:
		return 0
	}
}

// SeverityClassOf traduce un punteggio CVSS nella classe di gravità.
// Le soglie sono quelle del CVSS 3.1 e 4.0 (identiche).
func SeverityClassOf(score float64) string {
	switch {
	case score >= 9.0:
		return "CRITICAL"
	case score >= 7.0:
		return "HIGH"
	case score >= 4.0:
		return "MEDIUM"
	case score > 0.0:
		return "LOW"
	default:
		return "NONE"
	}
}

// Score ritorna il punteggio CVSS più autorevole disponibile: 4.0 se la fonte lo dà,
// altrimenti 3.1.
func (s Severity) Score() float64 {
	if s.CVSS40Score > 0 {
		return s.CVSS40Score
	}
	return s.CVSS31Score
}

// Class ritorna la classe di gravità normalizzata, calcolandola dal punteggio quando
// la fonte non la dichiara.
func (s Severity) Class() string {
	if s.BaseSeverity != "" {
		return strings.ToUpper(s.BaseSeverity)
	}
	return SeverityClassOf(s.Score())
}

// NormalizeSeverity riempie punteggio e classe mancanti: il risk model lavora su
// valori presenti, non su campi vuoti sparsi.
//
// Un punteggio pubblicato dalla fonte (NVD, GHSA) resta autorevole: il calcolo
// interviene solo quando manca, e si dichiara con ScoreSource "computed".
func (s *Severity) NormalizeSeverity() {
	if s.CVSS31Score == 0 && s.CVSS31Vector != "" {
		if score, ok := CVSS31BaseScore(s.CVSS31Vector); ok {
			s.CVSS31Score = score
			if s.ScoreSource == "" {
				s.ScoreSource = "computed"
			}
		}
	}
	if s.CVSS40Score == 0 && s.CVSS40Vector != "" {
		if score, ok := CVSS40BaseScore(s.CVSS40Vector); ok {
			s.CVSS40Score = score
			if s.ScoreSource == "" {
				s.ScoreSource = "computed"
			}
		}
	}
	if s.CVSS31Score == 0 && s.CVSS40Score > 0 {
		s.CVSS31Score = s.CVSS40Score
	}
	if s.BaseSeverity == "" {
		s.BaseSeverity = SeverityClassOf(s.Score())
	} else {
		s.BaseSeverity = strings.ToUpper(s.BaseSeverity)
	}
}

// MaxSeverity riporta la severità più alta fra due: serve a fondere le descrizioni
// che due fonti diverse fanno della stessa vulnerabilità.
func MaxSeverity(left, right Severity) Severity {
	result := left
	if right.Score() > result.Score() {
		result.CVSS31Vector, result.CVSS40Vector = right.CVSS31Vector, right.CVSS40Vector
		result.CVSS31Score, result.CVSS40Score = right.CVSS31Score, right.CVSS40Score
		result.ScoreSource = right.ScoreSource
	}
	if severityRank(right.BaseSeverity) > severityRank(result.BaseSeverity) {
		result.BaseSeverity = right.BaseSeverity
	}
	if right.EPSS > result.EPSS {
		result.EPSS, result.EPSSPercentile = right.EPSS, right.EPSSPercentile
	}
	if right.KEV {
		result.KEV = true
		if result.KEVDueDate == "" {
			result.KEVDueDate = right.KEVDueDate
		}
		result.KEVRansomwareCampaign = result.KEVRansomwareCampaign || right.KEVRansomwareCampaign
	}
	return result
}

// CVSS31 metriche base con i pesi del calcolatore ufficiale CVSS v3.1.
var (
	cvss31AttackVector = map[string]float64{"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2}
	cvss31Complexity   = map[string]float64{"L": 0.77, "H": 0.44}
	cvss31Interaction  = map[string]float64{"N": 0.85, "R": 0.62}
	cvss31Impact       = map[string]float64{"H": 0.56, "L": 0.22, "N": 0}
)

// CVSS31BaseScore calcola il punteggio base di un vettore CVSS 3.1.
// Ritorna false se il vettore non è un CVSS 3.1 valido o manca una metrica obbligatoria.
//
// Il vettore non deve essere calcolato alla leggera: è il segnale di gravità su cui
// l'utente decide. Qui la formula è quella del documento FIRST "CVSS v3.1
// Specification Document" §2 e §7.
func CVSS31BaseScore(vector string) (float64, bool) {
	metrics, ok := parseCVSSVector(vector, "3.1")
	if !ok {
		return 0, false
	}
	attackVector, ok := cvss31AttackVector[metrics["AV"]]
	if !ok {
		return 0, false
	}
	complexity, ok := cvss31Complexity[metrics["AC"]]
	if !ok {
		return 0, false
	}
	interaction, ok := cvss31Interaction[metrics["UI"]]
	if !ok {
		return 0, false
	}
	scopeChanged := metrics["S"] == "C"
	privileges, ok := cvss31Privileges(metrics["PR"], scopeChanged)
	if !ok {
		return 0, false
	}
	confidentiality, ok := cvss31Impact[metrics["C"]]
	if !ok {
		return 0, false
	}
	integrity, ok := cvss31Impact[metrics["I"]]
	if !ok {
		return 0, false
	}
	availability, ok := cvss31Impact[metrics["A"]]
	if !ok {
		return 0, false
	}

	// Exploitability = 8.22 × AV × AC × PR × UI
	exploitability := 8.22 * attackVector * complexity * privileges * interaction

	// ImpactSubScore = 1 − [(1 − C) × (1 − I) × (1 − A)]
	base := 1 - (1-confidentiality)*(1-integrity)*(1-availability)
	if base <= 0 {
		return 0, true
	}
	var impact float64
	if scopeChanged {
		impact = 7.52*(base-0.029) - 3.25*pow(base-0.02, 15)
	} else {
		impact = 6.42 * base
	}

	total := impact + exploitability
	if scopeChanged {
		total *= 1.08
	}
	if total > 10 {
		total = 10
	}
	return roundUpTenth(total), true
}

// cvss31Privileges ha pesi diversi a seconda dello Scope: un utente privilegiato
// vale meno quando la vulnerabilità non può uscire dal componente colpito.
func cvss31Privileges(value string, scopeChanged bool) (float64, bool) {
	switch value {
	case "N":
		return 0.85, true
	case "L":
		if scopeChanged {
			return 0.68, true
		}
		return 0.62, true
	case "H":
		if scopeChanged {
			return 0.5, true
		}
		return 0.27, true
	}
	return 0, false
}

// roundUpTenth è il "roundup" del CVSS: il più piccolo numero con una cifra decimale
// maggiore o uguale al valore.
func roundUpTenth(value float64) float64 {
	const epsilon = 0.000001
	scaled := value * 10
	integer := int64(scaled)
	if float64(integer) < scaled-epsilon {
		integer++
	}
	return float64(integer) / 10
}

// pow calcola base^exponent per esponenti interi piccoli senza importare math.
func pow(base float64, exponent int) float64 {
	result := 1.0
	for range exponent {
		result *= base
	}
	return result
}

// parseCVSSVector legge un vettore CVSS "CVSS:<versione>/<M>:<V>/…".
// Restituisce le metriche come mappa abbreviazione → valore.
func parseCVSSVector(vector, wantVersion string) (map[string]string, bool) {
	trimmed := strings.TrimSpace(vector)
	if trimmed == "" {
		return nil, false
	}
	prefix, rest, found := strings.Cut(trimmed, ":")
	if !found || !strings.EqualFold(prefix, "CVSS") {
		return nil, false
	}
	version, body, found := strings.Cut(rest, "/")
	if !found {
		return nil, false
	}
	if !strings.HasPrefix(version, wantVersion) {
		return nil, false
	}
	metrics := map[string]string{}
	for part := range strings.SplitSeq(body, "/") {
		name, value, found := strings.Cut(part, ":")
		if !found {
			continue
		}
		metrics[strings.ToUpper(strings.TrimSpace(name))] = strings.TrimSpace(value)
	}
	return metrics, len(metrics) > 0
}

// CVSSVersion ritorna la versione di un vettore CVSS ("3.1", "4.0", "2.0") o vuoto.
func CVSSVersion(vector string) string {
	trimmed := strings.TrimSpace(vector)
	if !strings.HasPrefix(strings.ToUpper(trimmed), "CVSS:") {
		return ""
	}
	rest := trimmed[len("CVSS:"):]
	version, _, _ := strings.Cut(rest, "/")
	return version
}

// CVSSVectorMetric legge una singola metrica da un vettore CVSS di qualsiasi versione.
func CVSSVectorMetric(vector, name string) string {
	version := CVSSVersion(vector)
	if version == "" {
		return ""
	}
	metrics, ok := parseCVSSVector(vector, version)
	if !ok {
		return ""
	}
	return metrics[strings.ToUpper(name)]
}

// SeverityFromScore costruisce una Severity a partire da un punteggio già noto e,
// se disponibile, dal vettore che lo descrive.
func SeverityFromScore(score float64, vector, source string) Severity {
	severity := Severity{ScoreSource: source}
	switch {
	case strings.HasPrefix(vector, "CVSS:4.0"):
		severity.CVSS40Vector = vector
		severity.CVSS40Score = score
	case strings.HasPrefix(vector, "CVSS:3"):
		severity.CVSS31Vector = vector
		severity.CVSS31Score = score
	default:
		severity.CVSS31Score = score
	}
	severity.NormalizeSeverity()
	return severity
}

// ParseSeverityString interpreta la severità testuale che molte fonti allegano
// ("CRITICAL", "HIGH", "MEDIUM", "LOW", "MODERATE", "NONE").
func ParseSeverityString(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "CRITICAL":
		return "CRITICAL"
	case "HIGH", "IMPORTANT":
		return "HIGH"
	case "MEDIUM", "MODERATE":
		return "MEDIUM"
	case "LOW", "MINOR":
		return "LOW"
	case "NONE", "NEGLIGIBLE", "INFO":
		return "NONE"
	default:
		return ""
	}
}

// FormatScore stampa un punteggio con una cifra decimale, come fanno i calcolatori
// ufficiali. Serve ai report e all'SBOM.
func FormatScore(score float64) string {
	return strconv.FormatFloat(score, 'f', 1, 64)
}
