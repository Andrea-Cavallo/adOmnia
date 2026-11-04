package flowintel

import (
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

// FlowEntry is one flow/subflow in the explorer list. Bundle is filled when the engine can
// attribute it (Java inside a PDE bundle, declared flows with a bundle attr).
type FlowEntry struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	File   string `json:"file,omitempty"`
	Line   int    `json:"line,omitzero"`
	Bundle string `json:"bundle,omitempty"`
	Method string `json:"method,omitempty"`
}

// Overview is what the Flow Explorer needs to start: counts, adapters and the entry points.
// The full graph never crosses the binding.
type Overview struct {
	Root        string         `json:"root"`
	Fingerprint string         `json:"fingerprint"`
	Adapters    []string       `json:"adapters"`
	Counts      map[string]int `json:"counts"`
	Nodes       int            `json:"nodes"`
	Edges       int            `json:"edges"`
	Flows       []FlowEntry    `json:"flows"`
	Bundles     []string       `json:"bundles"`
	Problems    []string       `json:"problems"`
}

// Overview builds the explorer summary, with the flows ordered by bundle then label.
func (x *Index) Overview() *Overview {
	discovery := x.Discovery
	overview := &Overview{
		Root: discovery.Root, Fingerprint: discovery.Fingerprint, Adapters: discovery.Adapters,
		Counts: discovery.Counts, Nodes: len(discovery.Graph.Nodes), Edges: len(discovery.Graph.Edges),
		Problems: append([]string{}, discovery.Problems...),
	}
	for _, node := range discovery.Graph.Nodes {
		switch node.Kind {
		case graph.KindFlow, graph.KindSubflow:
			overview.Flows = append(overview.Flows, FlowEntry{
				ID: node.ID, Kind: node.Kind, Label: node.Label, File: node.File, Line: node.Line,
				Bundle: node.Attrs["bundle"], Method: node.Attrs["method"],
			})
		case graph.KindBundle:
			overview.Bundles = append(overview.Bundles, node.Label)
		}
	}
	sort.SliceStable(overview.Flows, func(i, j int) bool {
		if overview.Flows[i].Bundle != overview.Flows[j].Bundle {
			return overview.Flows[i].Bundle < overview.Flows[j].Bundle
		}
		return overview.Flows[i].Label < overview.Flows[j].Label
	})
	sort.Strings(overview.Bundles)
	return overview
}

// SearchFlows filters the flow entries by a case-insensitive query over label, id and bundle.
func (x *Index) SearchFlows(query, bundle string, limit int) []FlowEntry {
	overview := x.Overview()
	query = strings.ToLower(strings.TrimSpace(query))
	bundle = strings.TrimSpace(bundle)
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	out := make([]FlowEntry, 0, len(overview.Flows))
	for _, flow := range overview.Flows {
		if bundle != "" && flow.Bundle != bundle {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(flow.Label), query) && !strings.Contains(strings.ToLower(flow.ID), query) && !strings.Contains(strings.ToLower(flow.Bundle), query) {
			continue
		}
		out = append(out, flow)
		if len(out) >= limit {
			break
		}
	}
	return out
}
