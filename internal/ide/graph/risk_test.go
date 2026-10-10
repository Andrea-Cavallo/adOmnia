package graph

import "testing"

func TestContractsAndRiskMap(t *testing.T) {
	b := NewBuilder()
	fn := func(id, pkg, module string) {
		b.Node(Node{ID: id, Kind: KindFunction, Label: id, Package: pkg, Attrs: map[string]string{"module": module}})
	}
	fn("lib.Parse", "example.com/lib", "example.com/lib")
	fn("lib.helper", "example.com/lib", "example.com/lib")
	fn("app.Run", "example.com/app", "example.com/app")
	b.Node(Node{ID: "test", Kind: KindTest, Label: "lib.TestHelper", Package: "example.com/lib", Attrs: map[string]string{"module": "example.com/lib"}})
	b.Edge("app.Run", "lib.Parse", EdgeCalls, "")
	b.Edge("lib.Parse", "lib.helper", EdgeCalls, "")
	b.Edge("test", "lib.helper", EdgeCalls, "")
	g := b.Graph()
	index := NewIndex(&g)
	impact, _ := index.Impact("lib.Parse")
	if len(impact.Contracts) != 1 || impact.Contracts[0].Node.ID != "app.Run" || impact.Risk != "high" {
		t.Fatalf("contracts %+v risk %s %v", impact.Contracts, impact.Risk, impact.RiskReasons)
	}
	packages, truncated := index.RiskMap()
	if truncated || len(packages) != 2 || packages[0].Package != "example.com/lib" || packages[0].High != 1 || packages[0].Riskiest[0].ID != "lib.Parse" {
		t.Fatalf("risk map: %+v", packages)
	}
}
