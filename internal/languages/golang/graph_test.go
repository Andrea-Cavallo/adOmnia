package golang

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/graph"
)

func graphFixture() map[string]string {
	files := map[string]string{}
	for name, content := range architectureFixture {
		files[name] = content
	}
	files["store/orders.go"] = `package store

func (r *OrderRepository) Open(id string) error {
	_, err := r.db.Query("SELECT id FROM orders WHERE id = ?", id)
	return err
}
`
	files["service/service_test.go"] = `package service

import "testing"

func TestLookup(t *testing.T) {
	s := &Service{}
	_ = s
}

func TestLookupCalls(t *testing.T) {
	var s Service
	defer func() { _ = recover() }()
	s.Lookup("a")
}
`
	return files
}

func buildFixtureGraph(t *testing.T) *graph.Index {
	t.Helper()
	report, root := loadFixture(t, graphFixture())
	report.Resolve(func(path string, offset int) (string, int, int) {
		data, err := os.ReadFile(path)
		if err != nil {
			return "", 0, 0
		}
		rel, _ := filepath.Rel(root, path)
		return filepath.ToSlash(rel), bytes.Count(data[:offset], []byte("\n")) + 1, 1
	})
	g := GraphFromArchitecture(report).Graph()
	return graph.NewIndex(&g)
}

func refLabels(refs []graph.Ref) string {
	labels := make([]string, 0, len(refs))
	for _, ref := range refs {
		labels = append(labels, ref.Node.Label)
	}
	return strings.Join(labels, ",")
}

func TestImpactCrossesInterfacesUpToTestsAndRoutes(t *testing.T) {
	index := buildFixtureGraph(t)
	impact, ok := index.Impact("fn:(example.com/shop/store.memStore).Get")
	if !ok {
		t.Fatal("memStore.Get missing from the graph")
	}
	// memStore.Get è raggiunto solo via Store.Get (interfaccia) da Service.Lookup.
	if got := refLabels(impact.Interfaces); got != "store.Store.Get" {
		t.Fatalf("interfaces: %s", got)
	}
	if !strings.Contains(refLabels(impact.Callers), "service.Service.Lookup") || !strings.Contains(refLabels(impact.Callers), "shop.main") {
		t.Fatalf("callers: %s", refLabels(impact.Callers))
	}
	if got := refLabels(impact.Tests); got != "service.TestLookupCalls" {
		t.Fatalf("tests: %s", got)
	}
	if got := refLabels(impact.Endpoints); got != "GET /orders/{id}" {
		t.Fatalf("endpoints: %s", got)
	}
	if len(impact.Entries) == 0 || impact.Risk == "" {
		t.Fatalf("entries %v risk %q", impact.Entries, impact.Risk)
	}
}

func TestGraphLinksResources(t *testing.T) {
	index := buildFixtureGraph(t)
	open, ok := index.Impact("fn:(*example.com/shop/store.OrderRepository).Open")
	if !ok || refLabels(open.Queries) != "orders" {
		t.Fatalf("queries: %+v", open.Queries)
	}
	if len(open.Tests) != 0 || open.Risk == "low" {
		t.Fatalf("untested writer must not be low risk: %s %v", open.Risk, open.RiskReasons)
	}
	publish, _ := index.Impact("fn:example.com/shop/service.Publish")
	if refLabels(publish.Produces) != "orders.created" {
		t.Fatalf("produces: %+v", publish.Produces)
	}
	if node, ok := index.FunctionAt("store/orders.go", 4); !ok || node.Label != "store.OrderRepository.Open" {
		t.Fatalf("FunctionAt: %+v", node)
	}
	if hits := index.Search("lookup", nil, 10); len(hits) == 0 || hits[0].Label != "service.Service.Lookup" {
		t.Fatalf("search: %+v", hits)
	}
}
