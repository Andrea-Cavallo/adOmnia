package graph

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func driftFixture() *Index {
	b := NewBuilder()
	pkg := func(path string) {
		b.Node(Node{ID: "pkg:example.com/shop/" + path, Kind: KindPackage, Label: "example.com/shop/" + path, Package: "example.com/shop/" + path, File: path + "/a.go", Line: 1, Attrs: map[string]string{"module": "example.com/shop"}})
	}
	for _, path := range []string{"internal/domain", "internal/store", "internal/http", "internal/billing", "internal/orders", "internal/shared"} {
		pkg(path)
	}
	b.Node(Node{ID: "std:net/http", Kind: KindStdlib, Label: "net/http"})
	edge := func(from, to string) {
		b.Edge("pkg:example.com/shop/"+from, "pkg:example.com/shop/"+to, EdgeImports, "")
	}
	edge("internal/domain", "internal/store")   // domain → repository: layer violation
	edge("internal/http", "internal/domain")    // allowed
	edge("internal/billing", "internal/orders") // domain boundary
	edge("internal/billing", "internal/shared") // shared: fine
	edge("internal/orders", "internal/billing") // cycle billing ↔ orders
	b.Edge("pkg:example.com/shop/internal/domain", "std:net/http", EdgeImports, "")
	fn := Node{ID: "fn:list", Kind: KindFunction, Label: "http.List", Package: "example.com/shop/internal/http", File: "internal/http/a.go", Line: 9, Attrs: map[string]string{"module": "example.com/shop"}}
	b.Node(fn)
	b.Node(Node{ID: "table:orders", Kind: KindTable, Label: "orders"})
	b.Edge("fn:list", "table:orders", EdgeQueries, "query")
	g := b.Graph()
	return NewIndex(&g)
}

func TestCheckDrift(t *testing.T) {
	rules := ArchitectureRules{
		Layers:         map[string][]string{"api": {"internal/http/..."}, "domain": {"internal/domain/..."}, "repository": {"internal/store/..."}},
		Allow:          map[string][]string{"api": {"domain"}, "domain": {}},
		Forbidden:      []ForbiddenImport{{From: "layer:domain", Import: "net/http", Reason: "no HTTP in the domain"}},
		Domains:        map[string][]string{"billing": {"internal/billing/..."}, "orders": {"internal/orders/..."}},
		Shared:         []string{"internal/shared/..."},
		DatabaseLayers: []string{"repository"},
		Services:       map[string][]string{"billing": {"example.com/shop/internal/billing/..."}, "orders": {"example.com/shop/internal/orders/..."}},
	}
	report := driftFixture().CheckDrift(rules, true)
	got := map[string]int{}
	for _, violation := range report.Violations {
		got[violation.Rule]++
	}
	want := map[string]int{"layer": 1, "forbidden-import": 1, "domain": 2, "service": 2, "database": 1, "cycle": 1}
	for rule, count := range want {
		if got[rule] != count {
			t.Fatalf("%s violations = %d, want %d; all %+v", rule, got[rule], count, report.Violations)
		}
	}
	if report.Layers["domain"] != 1 || len(report.Unassigned) != 3 {
		t.Fatalf("layers %v unassigned %v", report.Layers, report.Unassigned)
	}
	for _, violation := range report.Violations {
		if violation.Rule == "forbidden-import" && !strings.Contains(violation.Message, "no HTTP in the domain") {
			t.Fatalf("reason missing: %s", violation.Message)
		}
	}
}

func TestLoadRulesAndTemplate(t *testing.T) {
	root := t.TempDir()
	if _, found, err := LoadRules(root); found || err != nil {
		t.Fatalf("no rules file: found=%v err=%v", found, err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".adomnia"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".adomnia", "architecture.json"), []byte(RulesTemplate), 0o644); err != nil {
		t.Fatal(err)
	}
	rules, found, err := LoadRules(root)
	if err != nil || !found || len(rules.Layers) != 4 || rules.DatabaseLayers[0] != "repository" {
		t.Fatalf("template: %+v %v %v", rules, found, err)
	}
	for pattern, path := range map[string]string{"internal/domain/...": "internal/domain/order", "cmd/*": "cmd/api", "net/http": "net/http"} {
		if !matchPattern(pattern, path) {
			t.Fatalf("%s should match %s", pattern, path)
		}
	}
	if matchPattern("cmd/*", "cmd/api/x") || matchPattern("internal/dom/...", "internal/domain") {
		t.Fatal("pattern matched too much")
	}
}

func TestPackageMetrics(t *testing.T) {
	metrics, imports := driftFixture().PackageMetrics()
	byPackage := map[string]PackageMetric{}
	for _, metric := range metrics {
		byPackage[strings.TrimPrefix(metric.Package, "example.com/shop/")] = metric
	}
	// http → domain → store: store is reached by both.
	if m := byPackage["internal/store"]; m.FanIn != 1 || m.BlastRadius != 2 {
		t.Fatalf("store: %+v", m)
	}
	if m := byPackage["internal/http"]; m.FanOut != 1 || m.Functions != 1 || m.BlastRadius != 0 {
		t.Fatalf("http: %+v", m)
	}
	if len(imports) != 5 {
		t.Fatalf("imports: %v", imports)
	}
}
