package securityintel

import "testing"

// I valori attesi sono quelli dei calcolatori ufficiali CVSS v3.1 di FIRST e NVD: un
// punteggio di gravità sbagliato manda l'utente a correggere la vulnerabilità sbagliata.
func TestCVSS31BaseScore(t *testing.T) {
	cases := []struct {
		vector string
		score  float64
	}{
		{"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8},
		{"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", 7.5},
		{"CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 7.8},
		{"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", 0.0},
		{"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", 10.0},
	}
	for _, testCase := range cases {
		score, ok := CVSS31BaseScore(testCase.vector)
		if !ok {
			t.Fatalf("CVSS31BaseScore(%q) did not parse", testCase.vector)
		}
		if score != testCase.score {
			t.Errorf("CVSS31BaseScore(%q) = %v, want %v", testCase.vector, score, testCase.score)
		}
	}
}

func TestCVSS31BaseScoreRejectsInvalidVectors(t *testing.T) {
	for _, vector := range []string{"", "AV:N/AC:L", "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H", "CVSS:3.1/AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"} {
		if score, ok := CVSS31BaseScore(vector); ok {
			t.Errorf("CVSS31BaseScore(%q) = %v, want no score", vector, score)
		}
	}
}

func TestCVSS31ScopeChangedUsesHigherPrivilegesWeight(t *testing.T) {
	// Con Scope:Changed un Privileges Required:Low pesa 0.68, non 0.62.
	changed, ok := CVSS31BaseScore("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H")
	if !ok {
		t.Fatal("changed scope vector did not parse")
	}
	unchanged, ok := CVSS31BaseScore("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H")
	if !ok {
		t.Fatal("unchanged scope vector did not parse")
	}
	if changed <= unchanged {
		t.Errorf("changed scope score %v must exceed unchanged %v", changed, unchanged)
	}
}

func TestSeverityClassOf(t *testing.T) {
	cases := map[float64]string{0: "NONE", 0.1: "LOW", 3.9: "LOW", 4.0: "MEDIUM", 6.9: "MEDIUM", 7.0: "HIGH", 8.9: "HIGH", 9.0: "CRITICAL", 10: "CRITICAL"}
	for score, want := range cases {
		if got := SeverityClassOf(score); got != want {
			t.Errorf("SeverityClassOf(%v) = %s, want %s", score, got, want)
		}
	}
}

func TestNormalizeSeverityComputesScoreFromVector(t *testing.T) {
	severity := Severity{CVSS31Vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}
	severity.NormalizeSeverity()
	if severity.CVSS31Score != 9.8 {
		t.Errorf("computed score = %v, want 9.8", severity.CVSS31Score)
	}
	if severity.BaseSeverity != "CRITICAL" {
		t.Errorf("class = %s, want CRITICAL", severity.BaseSeverity)
	}
	if severity.ScoreSource != "computed" {
		t.Errorf("source = %q, want computed", severity.ScoreSource)
	}
}

// La severità tiene i segnali separati: l'EPSS non deve mai diventare una gravità.
func TestSeverityKeepsEPSSAndKEVSeparateFromCVSS(t *testing.T) {
	severity := Severity{CVSS31Score: 4.2, EPSS: 0.93, KEV: true, KEVDueDate: "2027-01-01"}
	severity.NormalizeSeverity()
	if severity.Score() != 4.2 {
		t.Errorf("Score() = %v, want the CVSS score 4.2", severity.Score())
	}
	if severity.EPSS != 0.93 || !severity.KEV {
		t.Errorf("EPSS/KEV lost: %+v", severity)
	}
	if severity.Class() != "MEDIUM" {
		t.Errorf("class = %s, want MEDIUM from the CVSS score alone", severity.Class())
	}
}

func TestMaxSeverityPrefersStrongerSignals(t *testing.T) {
	left := Severity{CVSS31Score: 5.0, BaseSeverity: "MEDIUM"}
	right := Severity{CVSS31Score: 9.0, BaseSeverity: "CRITICAL", EPSS: 0.4, KEV: true, KEVDueDate: "2027-02-01"}
	merged := MaxSeverity(left, right)
	if merged.Score() != 9.0 || merged.BaseSeverity != "CRITICAL" {
		t.Errorf("merged = %+v, want the critical severity", merged)
	}
	if merged.EPSS != 0.4 || !merged.KEV || merged.KEVDueDate != "2027-02-01" {
		t.Errorf("merged lost exploitation signals: %+v", merged)
	}
}

func TestParseSeverityString(t *testing.T) {
	cases := map[string]string{"CRITICAL": "CRITICAL", "high": "HIGH", "Moderate": "MEDIUM", "important": "HIGH", "minOR": "LOW", "nonsense": ""}
	for input, want := range cases {
		if got := ParseSeverityString(input); got != want {
			t.Errorf("ParseSeverityString(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCVSSVersionAndMetric(t *testing.T) {
	vector := "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"
	if version := CVSSVersion(vector); version != "4.0" {
		t.Errorf("CVSSVersion = %q, want 4.0", version)
	}
	if value := CVSSVectorMetric(vector, "av"); value != "N" {
		t.Errorf("AV metric = %q, want N", value)
	}
	if value := CVSSVectorMetric(vector, "at"); value != "N" {
		t.Errorf("AT metric = %q, want N", value)
	}
}
