package flowintel

import (
	"sort"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

// RuntimeEvidence is what the running framework proves about the flow graph. OSGi gives
// real bundle/service state; method-level call paths still need bytecode instrumentation,
// so those edges keep their static confidence.
type RuntimeEvidence struct {
	CapturedAt    time.Time                `json:"capturedAt"`
	StartupMs     int64                    `json:"startupMs"`
	ActiveBundles []string                 `json:"activeBundles"`
	Services      []RuntimeServiceEvidence `json:"services"`
	ObservedEdges int                      `json:"observedEdges"`
	// Unmatched lists ACTIVE bundles that are not in the workspace flow graph (target
	// platform only), so the panel does not pretend to know where they fit.
	Unmatched []string `json:"unmatched,omitempty"`
}

// RuntimeServiceEvidence is one service the framework really registered.
type RuntimeServiceEvidence struct {
	Interface string   `json:"interface"`
	Provider  string   `json:"provider,omitempty"`
	Consumers []string `json:"consumers,omitempty"`
	Active    bool     `json:"active"`
}

// ObserveRuntime correlates a runtime snapshot with the flow graph: ACTIVE bundles, their
// services, the consumers the framework reports, and the edges this proves. It does not
// change static edges; the caller decides how to show the evidence.
func (x *Index) ObserveRuntime(snapshot *eclipsepde.RuntimeSnapshot) *RuntimeEvidence {
	evidence := &RuntimeEvidence{CapturedAt: snapshot.CapturedAt, StartupMs: snapshot.StartupMs}
	if evidence.CapturedAt.IsZero() {
		evidence.CapturedAt = time.Now()
	}
	bundles := map[string]graph.Node{}
	for _, node := range x.Discovery.Graph.Nodes {
		if node.Kind == graph.KindBundle {
			bundles[node.Label] = node
		}
	}
	active := map[string]bool{}
	for _, bundle := range snapshot.Bundles {
		if bundle.State == "ACTIVE" {
			active[bundle.SymbolicName] = true
		}
	}
	for name := range active {
		if _, ok := bundles[name]; ok {
			evidence.ActiveBundles = append(evidence.ActiveBundles, name)
			evidence.ObservedEdges++ // bundle is active: its start/contains wiring is proven
		} else {
			evidence.Unmatched = append(evidence.Unmatched, name)
		}
	}
	for _, service := range snapshot.Services {
		provider := service.Provider
		item := RuntimeServiceEvidence{
			Interface: service.Interface, Provider: provider,
			Consumers: cleanConsumers(service.Consumers), Active: provider != "" && active[provider],
		}
		if item.Active {
			evidence.ObservedEdges++ // bundle → service registration
		}
		evidence.Services = append(evidence.Services, item)
	}
	sort.Strings(evidence.ActiveBundles)
	sort.Strings(evidence.Unmatched)
	sort.SliceStable(evidence.Services, func(i, j int) bool {
		if evidence.Services[i].Interface != evidence.Services[j].Interface {
			return evidence.Services[i].Interface < evidence.Services[j].Interface
		}
		return evidence.Services[i].Provider < evidence.Services[j].Provider
	})
	return evidence
}

// cleanConsumers turns the console's "name_version [id]" into bundle symbolic names.
func cleanConsumers(consumers []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(consumers))
	for _, consumer := range consumers {
		name := strings.TrimSpace(consumer)
		if cut := strings.LastIndexByte(name, '['); cut > 0 {
			name = strings.TrimSpace(name[:cut])
		}
		if cut := strings.LastIndexByte(name, '_'); cut > 0 {
			name = name[:cut]
		}
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
