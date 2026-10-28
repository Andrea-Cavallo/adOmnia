package securityintel

import (
	"maps"
	"math"
	"strings"
)

// Punteggio base CVSS 4.0 con l'algoritmo delle macrovector del documento FIRST
// "CVSS v4.0 Specification Document" §3 "Aggregate severity":
//
//  1. sei equazioni (EQ1..EQ6, tabelle 24-30) classificano il vettore in un
//     macrovector, un insieme di vettori di gravità comparabile;
//  2. il punteggio del macrovector si legge dalla tabella di lookup;
//  3. il vettore è dentro il macrovector a una certa distanza di gravità dal suo
//     vettore peggiore: il punteggio scende della media delle distanze normalizzate
//     verso i macrovector inferiori (interpolazione).
//
// Nessun valore di questa tabella è inventato. Fonti:
//
//   - equazioni, definizioni di distanza e algoritmo di interpolazione: documento
//     di specifica FIRST, §3;
//   - punteggi dei macrovector: cvss_lookup.js del calcolatore di riferimento FIRST
//     (github.com/FIRSTdotorg/cvss-v4-calculator), che la specifica §8.3 indica
//     come fonte normativa di quei punteggi;
//   - vettori di gravità massima per equazione e profondità dei macrovector:
//     max_composed.js e max_severity.js dello stesso riferimento.
//
// L'implementazione è verificata contro il validation reference set che FIRST
// pubblica per chi implementa calcolatori (github.com/FIRSTdotorg/cvss-resources,
// vectorFiles/base-threat-vectors e base-threat-scores): i valori di
// cvss4_test.go vengono da lì e dagli esempi ufficiali
// https://www.first.org/cvss/examples.
//
// Il punteggio calcolato serve solo quando la fonte dell'advisory non pubblica il
// proprio: un punteggio di NVD o GHSA resta autorevole e NormalizeSeverity non lo
// sovrascrive. Un punteggio sbagliato è peggio che non averlo: se il vettore non è
// un CVSS 4.0 valido la funzione ritorna false e il motore lascia il campo vuoto.
//
// Come da specifica, il punteggio Base combina le sole metriche Base assumendo il
// caso peggiore per Threat ed Environmental: E vale come E:A, CR/IR/AR come H, e le
// metriche modificate (M*) e supplementari presenti nel vettore non cambiano il
// punteggio base.

// cvss40MetricLevels ordina i valori di ogni metrica per gravità decrescente:
// più il livello è basso, più grave è il valore (cvss_score.js del riferimento
// ufficiale). Servono a misurare la distanza di gravità fra due vettori.
var cvss40MetricLevels = map[string]map[string]float64{
	"AV": {"N": 0, "A": 0.1, "L": 0.2, "P": 0.3},
	"PR": {"N": 0, "L": 0.1, "H": 0.2},
	"UI": {"N": 0, "P": 0.1, "A": 0.2},
	"AC": {"L": 0, "H": 0.1},
	"AT": {"N": 0, "P": 0.1},
	"VC": {"H": 0, "L": 0.1, "N": 0.2},
	"VI": {"H": 0, "L": 0.1, "N": 0.2},
	"VA": {"H": 0, "L": 0.1, "N": 0.2},
	"SC": {"H": 0.1, "L": 0.2, "N": 0.3},
	"SI": {"S": 0, "H": 0.1, "L": 0.2, "N": 0.3},
	"SA": {"S": 0, "H": 0.1, "L": 0.2, "N": 0.3},
	"CR": {"H": 0, "M": 0.1, "L": 0.2},
	"IR": {"H": 0, "M": 0.1, "L": 0.2},
	"AR": {"H": 0, "M": 0.1, "L": 0.2},
}

// cvss40BaseMetrics sono le metriche Base obbligatorie di un vettore CVSS 4.0.
var cvss40BaseMetrics = []string{"AV", "AC", "AT", "PR", "UI", "VC", "VI", "VA", "SC", "SI", "SA"}

// cvss40DistanceMetrics sono le metriche che concorrono alla distanza di gravità,
// raggruppate per equazione come nel riferimento ufficiale. CR, IR ed AR compaiono
// solo con il valore di default H nel punteggio base.
var cvss40DistanceMetrics = map[string][]string{
	"eq1":    {"AV", "PR", "UI"},
	"eq2":    {"AC", "AT"},
	"eq3eq6": {"VC", "VI", "VA", "CR", "IR", "AR"},
	"eq4":    {"SC", "SI", "SA"},
	"eq5":    {},
}

// cvss40MaxComposed elenca i vettori di gravità massima di ogni livello delle
// equazioni (max_composed.js del riferimento ufficiale, tabelle 24-30 dello spec).
// Sono i punti da cui si misura la distanza di gravità del vettore da puntegiare.
var cvss40MaxComposedEQ1 = map[byte][]string{
	0: {"AV:N/PR:N/UI:N/"},
	1: {"AV:A/PR:N/UI:N/", "AV:N/PR:L/UI:N/", "AV:N/PR:N/UI:P/"},
	2: {"AV:P/PR:N/UI:N/", "AV:A/PR:L/UI:P/"},
}

var cvss40MaxComposedEQ2 = map[byte][]string{
	0: {"AC:L/AT:N/"},
	1: {"AC:H/AT:N/", "AC:L/AT:P/"},
}

// cvss40MaxComposedEQ3EQ6 è indicizzato prima dal livello di EQ3 poi da quello di
// EQ6: le due equazioni non sono indipendenti (spec, tabella 30).
var cvss40MaxComposedEQ3EQ6 = map[byte]map[byte][]string{
	0: {
		0: {"VC:H/VI:H/VA:H/CR:H/IR:H/AR:H/"},
		1: {"VC:H/VI:H/VA:L/CR:M/IR:M/AR:H/", "VC:H/VI:H/VA:H/CR:M/IR:M/AR:M/"},
	},
	1: {
		0: {"VC:L/VI:H/VA:H/CR:H/IR:H/AR:H/", "VC:H/VI:L/VA:H/CR:H/IR:H/AR:H/"},
		1: {"VC:L/VI:H/VA:L/CR:H/IR:M/AR:H/", "VC:L/VI:H/VA:H/CR:H/IR:M/AR:M/", "VC:H/VI:L/VA:H/CR:M/IR:H/AR:M/", "VC:H/VI:L/VA:L/CR:M/IR:H/AR:H/", "VC:L/VI:L/VA:H/CR:H/IR:H/AR:M/"},
	},
	2: {
		1: {"VC:L/VI:L/VA:L/CR:H/IR:H/AR:H/"},
	},
}

var cvss40MaxComposedEQ4 = map[byte][]string{
	0: {"SC:H/SI:S/SA:S/"},
	1: {"SC:H/SI:H/SA:H/"},
	2: {"SC:L/SI:L/SA:L/"},
}

var cvss40MaxComposedEQ5 = map[byte][]string{
	0: {"E:A/"},
	1: {"E:P/"},
	2: {"E:U/"},
}

// cvss40MaxSeverity è la profondità di ogni macrovector per equazione, più uno
// (max_severity.js del riferimento ufficiale): è il divisore che normalizza la
// distanza di gravità in una proporzione fra 0 e 1.
var cvss40MaxSeverityEQ1 = map[byte]int{0: 1, 1: 4, 2: 5}
var cvss40MaxSeverityEQ2 = map[byte]int{0: 1, 1: 2}
var cvss40MaxSeverityEQ3EQ6 = map[byte]map[byte]int{
	0: {0: 7, 1: 6},
	1: {0: 8, 1: 8},
	2: {1: 10},
}
var cvss40MaxSeverityEQ4 = map[byte]int{0: 6, 1: 5, 2: 4}

// cvss40Lookup è la tabella dei punteggi dei macrovector: chiavi a sei cifre
// (livelli di EQ1..EQ6), valori fra 0 e 10 (cvss_lookup.js del calcolatore di
// riferimento FIRST). La specifica §8.3 rinvia a quel file come fonte normativa.
var cvss40Lookup = map[string]float64{
	"000000": 10, "000001": 9.9, "000010": 9.8, "000011": 9.5, "000020": 9.5, "000021": 9.2,
	"000100": 10, "000101": 9.6, "000110": 9.3, "000111": 8.7, "000120": 9.1, "000121": 8.1,
	"000200": 9.3, "000201": 9, "000210": 8.9, "000211": 8, "000220": 8.1, "000221": 6.8,
	"001000": 9.8, "001001": 9.5, "001010": 9.5, "001011": 9.2, "001020": 9, "001021": 8.4,
	"001100": 9.3, "001101": 9.2, "001110": 8.9, "001111": 8.1, "001120": 8.1, "001121": 6.5,
	"001200": 8.8, "001201": 8, "001210": 7.8, "001211": 7, "001220": 6.9, "001221": 4.8,
	"002001": 9.2, "002011": 8.2, "002021": 7.2, "002101": 7.9, "002111": 6.9, "002121": 5,
	"002201": 6.9, "002211": 5.5, "002221": 2.7,
	"010000": 9.9, "010001": 9.7, "010010": 9.5, "010011": 9.2, "010020": 9.2, "010021": 8.5,
	"010100": 9.5, "010101": 9.1, "010110": 9, "010111": 8.3, "010120": 8.4, "010121": 7.1,
	"010200": 9.2, "010201": 8.1, "010210": 8.2, "010211": 7.1, "010220": 7.2, "010221": 5.3,
	"011000": 9.5, "011001": 9.3, "011010": 9.2, "011011": 8.5, "011020": 8.5, "011021": 7.3,
	"011100": 9.2, "011101": 8.2, "011110": 8, "011111": 7.2, "011120": 7, "011121": 5.9,
	"011200": 8.4, "011201": 7, "011210": 7.1, "011211": 5.2, "011220": 5, "011221": 3,
	"012001": 8.6, "012011": 7.5, "012021": 5.2, "012101": 7.1, "012111": 5.2, "012121": 2.9,
	"012201": 6.3, "012211": 2.9, "012221": 1.7,
	"100000": 9.8, "100001": 9.5, "100010": 9.4, "100011": 8.7, "100020": 9.1, "100021": 8.1,
	"100100": 9.4, "100101": 8.9, "100110": 8.6, "100111": 7.4, "100120": 7.7, "100121": 6.4,
	"100200": 8.7, "100201": 7.5, "100210": 7.4, "100211": 6.3, "100220": 6.3, "100221": 4.9,
	"101000": 9.4, "101001": 8.9, "101010": 8.8, "101011": 7.7, "101020": 7.6, "101021": 6.7,
	"101100": 8.6, "101101": 7.6, "101110": 7.4, "101111": 5.8, "101120": 5.9, "101121": 5,
	"101200": 7.2, "101201": 5.7, "101210": 5.7, "101211": 5.2, "101220": 5.2, "101221": 2.5,
	"102001": 8.3, "102011": 7, "102021": 5.4, "102101": 6.5, "102111": 5.8, "102121": 2.6,
	"102201": 5.3, "102211": 2.1, "102221": 1.3,
	"110000": 9.5, "110001": 9, "110010": 8.8, "110011": 7.6, "110020": 7.6, "110021": 7,
	"110100": 9, "110101": 7.7, "110110": 7.5, "110111": 6.2, "110120": 6.1, "110121": 5.3,
	"110200": 7.7, "110201": 6.6, "110210": 6.8, "110211": 5.9, "110220": 5.2, "110221": 3,
	"111000": 8.9, "111001": 7.8, "111010": 7.6, "111011": 6.7, "111020": 6.2, "111021": 5.8,
	"111100": 7.4, "111101": 5.9, "111110": 5.7, "111111": 5.7, "111120": 4.7, "111121": 2.3,
	"111200": 6.1, "111201": 5.2, "111210": 5.7, "111211": 2.9, "111220": 2.4, "111221": 1.6,
	"112001": 7.1, "112011": 5.9, "112021": 3, "112101": 5.8, "112111": 2.6, "112121": 1.5,
	"112201": 2.3, "112211": 1.3, "112221": 0.6,
	"200000": 9.3, "200001": 8.7, "200010": 8.6, "200011": 7.2, "200020": 7.5, "200021": 5.8,
	"200100": 8.6, "200101": 7.4, "200110": 7.4, "200111": 6.1, "200120": 5.6, "200121": 3.4,
	"200200": 7, "200201": 5.4, "200210": 5.2, "200211": 4, "200220": 4, "200221": 2.2,
	"201000": 8.5, "201001": 7.5, "201010": 7.4, "201011": 5.5, "201020": 6.2, "201021": 5.1,
	"201100": 7.2, "201101": 5.7, "201110": 5.5, "201111": 4.1, "201120": 4.6, "201121": 1.9,
	"201200": 5.3, "201201": 3.6, "201210": 3.4, "201211": 1.9, "201220": 1.9, "201221": 0.8,
	"202001": 6.4, "202011": 5.1, "202021": 2, "202101": 4.7, "202111": 2.1, "202121": 1.1,
	"202201": 2.4, "202211": 0.9, "202221": 0.4,
	"210000": 8.8, "210001": 7.5, "210010": 7.3, "210011": 5.3, "210020": 6, "210021": 5,
	"210100": 7.3, "210101": 5.5, "210110": 5.9, "210111": 4, "210120": 4.1, "210121": 2,
	"210200": 5.4, "210201": 4.3, "210210": 4.5, "210211": 2.2, "210220": 2, "210221": 1.1,
	"211000": 7.5, "211001": 5.5, "211010": 5.8, "211011": 4.5, "211020": 4, "211021": 2.1,
	"211100": 6.1, "211101": 5.1, "211110": 4.8, "211111": 1.8, "211120": 2, "211121": 0.9,
	"211200": 4.6, "211201": 1.8, "211210": 1.7, "211211": 0.7, "211220": 0.8, "211221": 0.2,
	"212001": 5.3, "212011": 2.4, "212021": 1.4, "212101": 2.4, "212111": 1.2, "212121": 0.5,
	"212201": 1, "212211": 0.3, "212221": 0.1,
}

// CVSS40BaseScore calcola il punteggio base di un vettore CVSS 4.0 con l'algoritmo
// delle macrovector del documento FIRST "CVSS v4.0 Specification Document" §3.
//
// Ritorna false se il vettore non è un CVSS 4.0 valido o manca una metrica Base
// obbligatoria: senza un vettore completo non esiste un punteggio onesto. Le metriche
// Threat, Environmental e Supplementali eventualmente presenti sono ignorate: il
// punteggio base assume il caso peggiore per quelle (E:A, CR/IR/AR:H).
func CVSS40BaseScore(vector string) (float64, bool) {
	metrics, ok := parseCVSSVector(vector, "4.0")
	if !ok {
		return 0, false
	}
	selected := map[string]string{}
	for _, name := range cvss40BaseMetrics {
		value := strings.ToUpper(metrics[name])
		if _, valid := cvss40MetricLevels[name][value]; !valid {
			return 0, false
		}
		selected[name] = value
	}
	return cvss40Score(selected)
}

// cvss40Score applica l'interpolazione del §3.2: il punteggio del macrovector meno
// la media delle distanze normalizzate verso i macrovector inferiori.
func cvss40Score(selected map[string]string) (float64, bool) {
	// Scorciatoia ufficiale: nessun impatto su nessun sistema, nessun punteggio.
	impacts := []string{"VC", "VI", "VA", "SC", "SI", "SA"}
	if allMetricsNone(selected, impacts) {
		return 0, true
	}

	macroVector := cvss40MacroVector(selected)
	value, ok := cvss40Lookup[macroVector]
	if !ok {
		return 0, false
	}

	// 1.a Differenza massima disponibile: punteggio del macrovector meno quello del
	// macrovector immediatamente meno grave. Se non esiste, l'equazione non
	// contribuisce (NaN ignorato nel riferimento ufficiale).
	lowerScores := cvss40LowerScores(macroVector)

	// 1.b Distanza di gravità del vettore dal vettore peggiore del proprio
	// macrovector, per equazione.
	distances, ok := cvss40SeverityDistances(selected, macroVector)
	if !ok {
		return 0, false
	}

	// 1.c-1.d e 2: la distanza diventa proporzione della profondità del macrovector
	// e pesa sulla differenza massima; si fa la media sulle equazioni ammesse.
	sum, existing := 0.0, 0
	for _, equation := range []string{"eq1", "eq2", "eq3eq6", "eq4", "eq5"} {
		lowerScore, found := lowerScores[equation]
		if !found {
			continue
		}
		existing++
		if equation == "eq5" {
			// EQ5 non ha metriche proprie da confrontare: la sua distanza è zero.
			continue
		}
		depth := float64(cvss40EquationDepth(equation, macroVector)) * 0.1
		if depth <= 0 {
			return 0, false
		}
		sum += (value - lowerScore) * (distances[equation] / depth)
	}
	mean := 0.0
	if existing > 0 {
		mean = sum / float64(existing)
	}

	// 3. Punteggio del macrovector meno la media, una cifra decimale.
	score := value - mean
	if score < 0 {
		score = 0
	}
	if score > 10 {
		score = 10
	}
	return math.Round(score*10) / 10, true
}

// cvss40MacroVector classifica il vettore nelle sei equazioni EQ1..EQ6 del
// documento di specifica (tabelle 24-30) e ne ritorna le chiavi a sei cifre.
//
// Il punteggio base usa i valori di default di Threat ed Environmental: E non
// definito vale come E:A (EQ5 = 0), CR/IR/AR non definiti come H, e le metriche
// modificate non esistono (quindi EQ4 non può mai essere 0, che richiede MSI:S o
// MSA:S).
func cvss40MacroVector(selected map[string]string) string {
	effective := func(name string) string {
		switch name {
		case "E":
			return "A"
		case "CR", "IR", "AR":
			return "H"
		}
		return selected[name]
	}

	var levels [6]byte

	// EQ1 → AV/PR/UI (tabella 24).
	switch {
	case effective("AV") == "N" && effective("PR") == "N" && effective("UI") == "N":
		levels[0] = 0
	case (effective("AV") == "N" || effective("PR") == "N" || effective("UI") == "N") &&
		effective("AV") != "P":
		levels[0] = 1
	default:
		levels[0] = 2
	}

	// EQ2 → AC/AT (tabella 25).
	if effective("AC") == "L" && effective("AT") == "N" {
		levels[1] = 0
	} else {
		levels[1] = 1
	}

	// EQ3 → VC/VI/VA (tabella 26).
	switch {
	case effective("VC") == "H" && effective("VI") == "H":
		levels[2] = 0
	case effective("VC") == "H" || effective("VI") == "H" || effective("VA") == "H":
		levels[2] = 1
	default:
		levels[2] = 2
	}

	// EQ4 → SC/SI/SA (tabella 27). Nel punteggio base non esistono MSI:S o MSA:S,
	// quindi il livello 0 non è raggiungibile.
	if effective("SC") == "H" || effective("SI") == "H" || effective("SA") == "H" {
		levels[3] = 1
	} else {
		levels[3] = 2
	}

	// EQ5 → E (tabella 28): nel punteggio base E vale sempre come E:A.
	levels[4] = 0

	// EQ6 → VC/VI/VA + CR/IR/AR (tabella 29).
	if (effective("CR") == "H" && effective("VC") == "H") ||
		(effective("IR") == "H" && effective("VI") == "H") ||
		(effective("AR") == "H" && effective("VA") == "H") {
		levels[5] = 0
	} else {
		levels[5] = 1
	}

	var key strings.Builder
	for _, level := range levels {
		key.WriteByte('0' + level)
	}
	return key.String()
}

// cvss40LowerScores ritorna il punteggio del macrovector immediatamente meno grave
// di ogni equazione. EQ3 ed EQ6 non sono indipendenti e scendono insieme (spec,
// tabella 30): da 00 si può scendere sia in 01 sia in 10 e si tiene il più alto dei
// due, gli altri passi sono unici. Un macrovector inesistente non contribuisce.
func cvss40LowerScores(macroVector string) map[string]float64 {
	levels := [6]byte{}
	for index := range levels {
		levels[index] = macroVector[index] - '0'
	}
	key := func(l [6]byte) string {
		var builder strings.Builder
		for _, level := range l {
			builder.WriteByte('0' + level)
		}
		return builder.String()
	}
	withLevel := func(position int, level byte) string {
		next := levels
		next[position] = level
		return key(next)
	}

	scores := map[string]float64{}
	if score, ok := cvss40Lookup[withLevel(0, levels[0]+1)]; ok {
		scores["eq1"] = score
	}
	if score, ok := cvss40Lookup[withLevel(1, levels[1]+1)]; ok {
		scores["eq2"] = score
	}

	// EQ3+EQ6 congiunte: 00→01 e 00→10 (si tiene il più alto), 01→11, 10→11,
	// 11→21, 21→32 (che non esiste e quindi non contribuisce).
	var eq3eq6Candidates []string
	switch {
	case levels[2] == 0 && levels[5] == 0:
		eq3eq6Candidates = []string{withLevel(5, levels[5]+1), withLevel(2, levels[2]+1)}
	case levels[2] == 0 && levels[5] == 1, levels[2] == 1 && levels[5] == 1:
		eq3eq6Candidates = []string{withLevel(2, levels[2]+1)}
	case levels[2] == 1 && levels[5] == 0:
		eq3eq6Candidates = []string{withLevel(5, levels[5]+1)}
	default:
		// 21 → 32: un passo su entrambe, e quel macrovector non esiste.
		next := levels
		next[2], next[5] = levels[2]+1, levels[5]+1
		eq3eq6Candidates = []string{key(next)}
	}
	for _, candidate := range eq3eq6Candidates {
		if score, ok := cvss40Lookup[candidate]; ok && score > scores["eq3eq6"] {
			scores["eq3eq6"] = score
		}
	}

	if score, ok := cvss40Lookup[withLevel(3, levels[3]+1)]; ok {
		scores["eq4"] = score
	}
	if score, ok := cvss40Lookup[withLevel(4, levels[4]+1)]; ok {
		scores["eq5"] = score
	}
	return scores
}

// cvss40SeverityDistances misura la distanza di gravità del vettore dai vettori
// peggiori del proprio macrovector, sommata per equazione (§3: "the severity
// distance between them is the number of consecutive stepwise changes in individual
// metrics needed to transform one vector into the other").
//
// Quando un macrovector ha più vettori peggiori si usa il primo che domina il
// vettore da puntegiare, come nel riferimento ufficiale. Se nessuno lo domina il
// vettore non è interpretabile e la funzione ritorna false.
func cvss40SeverityDistances(selected map[string]string, macroVector string) (map[string]float64, bool) {
	levels := [6]byte{}
	for index := range levels {
		levels[index] = macroVector[index] - '0'
	}

	// Nel punteggio base E vale come E:A e CR/IR/AR come H: distanza zero dai
	// vettori peggiori, che usano esattamente quei valori.
	selectedWithDefaults := map[string]string{"E": "A", "CR": "H", "IR": "H", "AR": "H"}
	maps.Copy(selectedWithDefaults, selected)

	eq3eq6Maxes, ok := cvss40MaxComposedEQ3EQ6[levels[2]][levels[5]]
	if !ok {
		return nil, false
	}
	for _, eq1Max := range cvss40MaxComposedEQ1[levels[0]] {
		for _, eq2Max := range cvss40MaxComposedEQ2[levels[1]] {
			for _, eq3eq6Max := range eq3eq6Maxes {
				for _, eq4Max := range cvss40MaxComposedEQ4[levels[3]] {
					for _, eq5Max := range cvss40MaxComposedEQ5[levels[4]] {
						maxVector := eq1Max + eq2Max + eq3eq6Max + eq4Max + eq5Max
						distances, dominated := cvss40VectorDistances(selectedWithDefaults, maxVector)
						if !dominated {
							continue
						}
						totals := map[string]float64{}
						for equation, metrics := range cvss40DistanceMetrics {
							for _, name := range metrics {
								totals[equation] += distances[name]
							}
						}
						return totals, true
					}
				}
			}
		}
	}
	return nil, false
}

// cvss40VectorDistances calcola la distanza di gravità metrica per metrica fra il
// vettore da puntegiare e un vettore candidato. Il candidato domina solo se ogni
// distanza è positiva o nulla: nessuna metrica del candidato può essere più grave.
func cvss40VectorDistances(selected map[string]string, maxVector string) (map[string]float64, bool) {
	distances := map[string]float64{}
	for _, name := range []string{"AV", "PR", "UI", "AC", "AT", "VC", "VI", "VA", "SC", "SI", "SA", "CR", "IR", "AR"} {
		maxValue := cvss40ExtractValue(maxVector, name)
		maxLevel, maxValid := cvss40MetricLevels[name][maxValue]
		valueLevel, valueValid := cvss40MetricLevels[name][selected[name]]
		if !maxValid || !valueValid {
			return nil, false
		}
		distance := valueLevel - maxLevel
		if distance < 0 {
			return nil, false
		}
		distances[name] = distance
	}
	return distances, true
}

// cvss40EquationDepth è la profondità del macrovector per equazione: la massima
// distanza di gravità fra i suoi vettori, più uno (max_severity.js del riferimento
// ufficiale).
func cvss40EquationDepth(equation, macroVector string) int {
	switch equation {
	case "eq1":
		return cvss40MaxSeverityEQ1[macroVector[0]-'0']
	case "eq2":
		return cvss40MaxSeverityEQ2[macroVector[1]-'0']
	case "eq3eq6":
		if byEQ6, ok := cvss40MaxSeverityEQ3EQ6[macroVector[2]-'0']; ok {
			return byEQ6[macroVector[5]-'0']
		}
		return 0
	case "eq4":
		return cvss40MaxSeverityEQ4[macroVector[3]-'0']
	}
	return 0
}

// cvss40ExtractValue legge il valore di una metrica da un vettore compatto
// ("AV:N/PR:N/UI:N/"), come fa il riferimento ufficiale.
func cvss40ExtractValue(vector, metric string) string {
	index := strings.Index(vector, metric+":")
	if index < 0 {
		return ""
	}
	rest := vector[index+len(metric)+1:]
	if before, _, ok := strings.Cut(rest, "/"); ok {
		return before
	}
	return rest
}

// allMetricsNone dice se ogni metrica elencata ha valore "N".
func allMetricsNone(metrics map[string]string, names []string) bool {
	for _, name := range names {
		if metrics[name] != "N" {
			return false
		}
	}
	return true
}
