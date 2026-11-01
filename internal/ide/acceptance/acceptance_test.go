package acceptance

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScenarioRoundTripAndBrokenFilesAreReported(t *testing.T) {
	root := t.TempDir()
	saved, err := Save(root, Scenario{
		ID: "orders-404", Title: "Unknown order", Routes: []string{"get /orders/{id}"}, Files: []string{`internal\orders\handler.go`},
		Criteria: []Criterion{{Text: "Unknown ids return 404", Check: &Check{Kind: "request", Method: "GET", URL: "http://localhost:8080/orders/x", ExpectedStatus: 404}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Status != StatusDraft || saved.Routes[0] != "GET /orders/{id}" || saved.Files[0] != "internal/orders/handler.go" || saved.Criteria[0].ID != "c1" {
		t.Fatalf("not normalized: %+v", saved)
	}
	raw, _ := os.ReadFile(filepath.Join(root, ".adomnia", "acceptance", "orders-404.json"))
	if !strings.Contains(string(raw), "\n  \"format\": \"adomnia-acceptance\"") || strings.Contains(string(raw), "\"file\"") {
		t.Fatalf("file is not pretty, versioned JSON without runtime fields:\n%s", raw)
	}
	if err := os.WriteFile(filepath.Join(root, ".adomnia", "acceptance", "broken.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(root)
	if err != nil || len(loaded.Scenarios) != 1 || len(loaded.Problems) != 1 || loaded.Scenarios[0].File != ".adomnia/acceptance/orders-404.json" {
		t.Fatalf("load = %+v, %v", loaded, err)
	}
}

func TestScenarioValidation(t *testing.T) {
	for name, scenario := range map[string]Scenario{
		"bad id":       {ID: "../x", Title: "t"},
		"no title":     {ID: "a"},
		"bad route":    {ID: "a", Title: "t", Routes: []string{"orders"}},
		"outside file": {ID: "a", Title: "t", Files: []string{"../secret"}},
		"bad check":    {ID: "a", Title: "t", Criteria: []Criterion{{Text: "x", Check: &Check{Kind: "flow"}}}},
	} {
		if _, err := Normalize(scenario); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestTouchedScenariosFollowTheirLinkedFiles(t *testing.T) {
	scenarios := []Scenario{{ID: "a", Files: []string{"api/orders.go"}}, {ID: "b", Files: []string{"web/cart.ts"}}, {ID: "c"}}
	if got := Touched(scenarios, []string{"api/orders.go", "README.md"}); len(got) != 1 || got[0] != "a" {
		t.Fatalf("touched = %v", got)
	}
}
