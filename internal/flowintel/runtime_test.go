package flowintel

import (
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

func TestObserveRuntimeCorrelatesBundlesAndServices(t *testing.T) {
	builder := graph.NewBuilder()
	builder.Node(graph.Node{ID: "bundle:com.acme.core", Kind: graph.KindBundle, Label: "com.acme.core"})
	builder.Node(graph.Node{ID: "bundle:com.acme.ui", Kind: graph.KindBundle, Label: "com.acme.ui"})
	builder.Node(graph.Node{ID: "service:com.acme.core.api.Service", Kind: graph.KindService, Label: "com.acme.core.api.Service"})
	builder.EdgeWithConfidence("bundle:com.acme.core", "service:com.acme.core.api.Service", graph.EdgeProvides, "core.xml", graph.ConfidenceDeclared)
	discovery := &Discovery{Root: "/ws", Graph: builder.Graph(), Counts: map[string]int{}}
	index := NewIndex(discovery)

	snapshot := &eclipsepde.RuntimeSnapshot{
		CapturedAt: time.Now(), StartupMs: 1200,
		Bundles: []eclipsepde.RuntimeBundle{
			{ID: 1, State: "ACTIVE", SymbolicName: "com.acme.core"},
			{ID: 2, State: "RESOLVED", SymbolicName: "com.acme.ui"},
			{ID: 3, State: "ACTIVE", SymbolicName: "org.eclipse.ui"},
		},
		Services: []eclipsepde.RuntimeService{
			{Interface: "com.acme.core.api.Service", Provider: "com.acme.core", BundleID: "1", Consumers: []string{"com.acme.ui_1.0.0 [2]"}},
			{Interface: "org.osgi.service.log.LogService", Provider: "org.eclipse.osgi", BundleID: "0"},
		},
	}
	evidence := index.ObserveRuntime(snapshot)
	if len(evidence.ActiveBundles) != 1 || evidence.ActiveBundles[0] != "com.acme.core" {
		t.Fatalf("active = %+v", evidence.ActiveBundles)
	}
	if len(evidence.Unmatched) != 1 || evidence.Unmatched[0] != "org.eclipse.ui" {
		t.Fatalf("unmatched = %+v", evidence.Unmatched)
	}
	if len(evidence.Services) != 2 {
		t.Fatalf("services = %+v", evidence.Services)
	}
	core := evidence.Services[0]
	if core.Interface != "com.acme.core.api.Service" && evidence.Services[1].Interface != "com.acme.core.api.Service" {
		t.Fatalf("services = %+v", evidence.Services)
	}
	for _, service := range evidence.Services {
		if service.Interface != "com.acme.core.api.Service" {
			continue
		}
		if !service.Active || service.Provider != "com.acme.core" {
			t.Fatalf("core service = %+v", service)
		}
		if len(service.Consumers) != 1 || service.Consumers[0] != "com.acme.ui" {
			t.Fatalf("consumers = %+v", service.Consumers)
		}
	}
	if evidence.ObservedEdges < 2 {
		t.Fatalf("observed edges = %d", evidence.ObservedEdges)
	}
}
