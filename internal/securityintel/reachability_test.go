package securityintel

import "testing"

// La distinzione onesta dell'evidenza non ammette promozioni: una conferma nasce
// solo da una chiamata provata, un'ipotesi non diventa mai "called" e l'assenza di
// risultati non diventa mai "notReachable".
func TestNormalizeReachabilityNeverPromotesAHypothesis(t *testing.T) {
	cases := []struct {
		name     string
		evidence Evidence
		want     Reachability
	}{
		{"chiamata confermata", Evidence{Method: EvidenceMethodBytecodeReference, Confirmed: true, Symbols: []string{"org.foo.Bar.baz"}}, ReachabilityCalled},
		{"riferimento senza chiamata", Evidence{Method: EvidenceMethodBytecodeReference, Symbols: []string{"org.foo.Bar.baz"}}, ReachabilityPotentiallyReachable},
		{"percorso di chiamata", Evidence{Method: "govulncheck-symbol", CallPaths: [][]CallFrame{{{Function: "main"}}}}, ReachabilityCalled},
		{"package importato", Evidence{Method: "govulncheck-imports", Packages: []string{"org/foo"}}, ReachabilityImported},
		{"analisi bytecode inconcludente", Evidence{Method: EvidenceMethodBytecodeReference, Note: "nothing found"}, ReachabilityUnknown},
		{"nessuna analisi", Evidence{Method: EvidenceMethodNone, Note: "not analyzed"}, ReachabilityUnknown},
		{"evidenza vuota", Evidence{}, ReachabilityUnknown},
		{"solo nel grafo di build", Evidence{Method: "govulncheck-required"}, ReachabilityRequired},
	}
	for _, testCase := range cases {
		finding := Finding{Reachability: ReachabilityUnknown}
		if got := normalizeReachability(finding, testCase.evidence); got != testCase.want {
			t.Errorf("%s: normalizeReachability = %q, want %q", testCase.name, got, testCase.want)
		}
	}
	// Un livello già più forte dell'evidenza non viene indebolito.
	stronger := Finding{Reachability: ReachabilityCalled}
	if got := normalizeReachability(stronger, Evidence{Method: EvidenceMethodNone}); got != ReachabilityCalled {
		t.Errorf("an established call must not be downgraded, got %q", got)
	}
}
