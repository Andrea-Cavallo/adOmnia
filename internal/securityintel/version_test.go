package securityintel

import "testing"

// Il confronto versioni decide se una vulnerabilità è già corretta: se sbaglia, il
// finding sparisce quando non deve o resta quando non deve.
func TestCompareVersions(t *testing.T) {
	cases := []struct {
		left, right string
		want        int
	}{
		{"1.0.0", "1.0.0", 0},
		{"1.0", "1.0.0", 0},    // gli zeri finali non sono significativi
		{"v1.2.3", "1.2.3", 0}, // il prefisso "v" di Go non è parte della versione
		{"1.0.1", "1.0.0", 1},
		{"1.9.9", "2.0", -1},
		{"2.0", "2.0-rc1", 1}, // la release è più recente del candidato
		{"1.0-alpha", "1.0-beta", -1},
		{"1.0-beta", "1.0-rc1", -1},
		{"1.0-rc1", "1.0", -1},
		{"1.0.0.RELEASE", "1.0.0", 1}, // qualificatore noto dopo il vuoto
		{"0", "1", -1},
	}
	for _, testCase := range cases {
		if got := CompareVersions(testCase.left, testCase.right); got != testCase.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", testCase.left, testCase.right, got, testCase.want)
		}
	}
}

func TestVersionRangeIncludes(t *testing.T) {
	cases := []struct {
		range_  VersionRange
		version string
		want    bool
	}{
		{VersionRange{Introduced: "1.0", Fixed: "1.2"}, "1.1", true},
		{VersionRange{Introduced: "1.0", Fixed: "1.2"}, "1.2", false},
		{VersionRange{Introduced: "1.0", Fixed: "1.2"}, "0.9", false},
		{VersionRange{Introduced: "0"}, "99.0", true},
		{VersionRange{Introduced: "2.0", LastAffected: "2.5"}, "2.5", true},
		{VersionRange{Introduced: "2.0", LastAffected: "2.5"}, "2.6", false},
		{VersionRange{Fixed: "1.4"}, "1.3", true},
		{VersionRange{Fixed: "1.4"}, "1.4", false},
	}
	for _, testCase := range cases {
		if got := testCase.range_.Includes(testCase.version); got != testCase.want {
			t.Errorf("%s includes %s = %v, want %v", testCase.range_, testCase.version, got, testCase.want)
		}
	}
}

// Due rami di versione affetti dallo stesso advisory: la correzione è per ramo.
func TestVersionRangeSupportsMultipleBranches(t *testing.T) {
	ranges := []VersionRange{
		{Introduced: "1.0", Fixed: "1.2"},
		{Introduced: "2.0", Fixed: "2.1"},
	}
	matches := func(version string) bool {
		for _, rng := range ranges {
			if rng.Includes(version) {
				return true
			}
		}
		return false
	}
	for _, version := range []string{"1.0", "1.1", "2.0"} {
		if !matches(version) {
			t.Errorf("%s should be affected", version)
		}
	}
	for _, version := range []string{"1.2", "2.1", "3.0"} {
		if matches(version) {
			t.Errorf("%s should not be affected", version)
		}
	}
}

func TestVersionRangeMatchExpressions(t *testing.T) {
	cases := []struct {
		expression string
		version    string
		want       bool
	}{
		{"[1.0,2.0)", "1.5", true},
		{"[1.0,2.0)", "2.0", false},
		{"[1.0,2.0]", "2.0", true},
		{"[1.0]", "1.0", true},
		{"[1.0]", "1.1", false},
		{">= 1.2", "1.2", true},
		{">= 1.2", "1.1", false},
		{"< 2.0", "1.9", true},
		{"< 2.0", "2.0", false},
		{"1.5", "1.5", true},
		{"1.5", "1.6", true}, // senza operatore: questa versione o più recente
	}
	for _, testCase := range cases {
		if got := VersionRangeMatch(testCase.version, testCase.expression); got != testCase.want {
			t.Errorf("VersionRangeMatch(%q, %q) = %v, want %v", testCase.version, testCase.expression, got, testCase.want)
		}
	}
}

func TestCompatibilityClassOf(t *testing.T) {
	cases := []struct {
		current, fixed string
		want           string
	}{
		{"1.2.3", "1.2.4", CompatibilityPatch},
		{"1.2.3", "1.3.0", CompatibilityMinor},
		{"1.2.3", "2.0.0", CompatibilityMajor},
		{"1.2.3", "", CompatibilityUnknown},
	}
	for _, testCase := range cases {
		if got := CompatibilityClassOf(testCase.current, testCase.fixed); got != testCase.want {
			t.Errorf("CompatibilityClassOf(%q, %q) = %s, want %s", testCase.current, testCase.fixed, got, testCase.want)
		}
	}
}
