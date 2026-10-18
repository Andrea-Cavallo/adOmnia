package securityintel

import "testing"

// I valori attesi non sono generati da questa implementazione: provengono dal
// validation reference set che FIRST pubblica per i calcolatori CVSS 4.0
// (github.com/FIRSTdotorg/cvss-resources, vectorFiles/base-threat-vectors e
// base-threat-scores) e dagli esempi ufficiali https://www.first.org/cvss/examples.
// Un punteggio di gravità sbagliato manda l'utente a correggere la vulnerabilità
// sbagliata: ogni riga di questa tabella è stata confrontata con quelle fonti.
func TestCVSS40BaseScore(t *testing.T) {
	cases := []struct {
		vector string
		score  float64
	}{
		// Estremi: il vettore peggiore vale 10, nessun impatto vale 0
		// (validation reference set, e la scorciatoia del §3.2).
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H", 10.0},
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N", 0.0},

		// Vettori di riferimento del task: i due centrali NON valgono come
		// ipotizzato. La differenza di gravità dentro un macrovector si recupera
		// solo interpolando verso macrovector inferiori esistenti.
		// UI:P non è il caso peggiore di EQ1, ma è uno dei vettori peggiori del
		// proprio macrovector: il punteggio è quello del macrovector, 9.4.
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H", 9.4},
		// AC:H/AT:P è più grave dei vettori peggiori di EQ2=1, ma EQ2=1 è già
		// l'ultimo livello: senza macrovector inferiore la distanza non pesa e il
		// punteggio resta quello del macrovector, 9.2. Il valore 8.2 appartiene
		// alla stessa serie con la metrica Threat E:P (validation reference set:
		// "...VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:P" = 8.2), non al punteggio base.
		{"CVSS:4.0/AV:N/AC:H/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N", 9.2},
		{"CVSS:4.0/AV:N/AC:H/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:P", 9.2},
		// Esempi ufficiali di CVE, tabella "Base" di
		// https://www.first.org/cvss/examples (CVE-2023-22394).
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:L", 8.7},

		// Altri esempi ufficiali, tutti confermati sul validation reference set.
		{"CVSS:4.0/AV:L/AC:L/AT:P/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N", 7.3}, // CVE-2022-41741
		{"CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N", 7.7}, // CVE-2020-3549
		{"CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:L/VA:L/SC:N/SI:N/SA:N", 8.3}, // CVE-2023-3089
		{"CVSS:4.0/AV:L/AC:L/AT:N/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N", 4.6}, // CVE-2021-44714
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N", 5.1}, // CVE-2022-21830
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:L/SI:N/SA:N", 6.9}, // CVE-2022-22186
		{"CVSS:4.0/AV:L/AC:L/AT:N/PR:H/UI:N/VC:N/VI:N/VA:N/SC:H/SI:N/SA:N", 5.9}, // CVE-2023-21989
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:H/VA:N/SC:H/SI:H/SA:H", 9.3}, // CVE-2023-48228
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N", 7.1}, // CVE-2023-30545
		{"CVSS:4.0/AV:L/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H", 9.4}, // CVE-2020-3947
		{"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:H", 9.2}, // interpolazione dentro EQ3=1
	}
	for _, testCase := range cases {
		score, ok := CVSS40BaseScore(testCase.vector)
		if !ok {
			t.Fatalf("CVSS40BaseScore(%q) did not parse", testCase.vector)
		}
		if score != testCase.score {
			t.Errorf("CVSS40BaseScore(%q) = %v, want %v", testCase.vector, score, testCase.score)
		}
	}
}

func TestCVSS40BaseScoreRejectsInvalidVectors(t *testing.T) {
	for _, vector := range []string{
		"",
		"AV:N/AC:L",
		"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
		// Metrica Base mancante (SA).
		"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H",
		// Valore metrico inesistente.
		"CVSS:4.0/AV:Z/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H",
		"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:Z",
	} {
		if score, ok := CVSS40BaseScore(vector); ok {
			t.Errorf("CVSS40BaseScore(%q) = %v, want no score", vector, score)
		}
	}
}

// Il punteggio calcolato riempie solo il campo vuoto: un punteggio di fonte (NVD,
// GHSA) resta autorevole e non va mai sovrascritto.
func TestNormalizeSeverityFillsMissingCVSS40Score(t *testing.T) {
	severity := Severity{CVSS40Vector: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H"}
	severity.NormalizeSeverity()
	if severity.CVSS40Score != 10.0 {
		t.Errorf("CVSS40Score = %v, want 10.0 computed from the vector", severity.CVSS40Score)
	}
	if severity.ScoreSource != "computed" {
		t.Errorf("ScoreSource = %q, want %q", severity.ScoreSource, "computed")
	}
	if severity.BaseSeverity != "CRITICAL" {
		t.Errorf("BaseSeverity = %q, want CRITICAL", severity.BaseSeverity)
	}
}

func TestNormalizeSeverityKeepsSourceCVSS40Score(t *testing.T) {
	severity := Severity{
		CVSS40Vector: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H",
		CVSS40Score:  8.1,
		ScoreSource:  "nvd",
	}
	severity.NormalizeSeverity()
	if severity.CVSS40Score != 8.1 {
		t.Errorf("CVSS40Score = %v, want the source score 8.1 kept as authoritative", severity.CVSS40Score)
	}
	if severity.ScoreSource != "nvd" {
		t.Errorf("ScoreSource = %q, want %q kept", severity.ScoreSource, "nvd")
	}
}
