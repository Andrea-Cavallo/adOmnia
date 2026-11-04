package adomniacli

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/flowintel"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

// Flow Intelligence over MCP: the same discovery engine the IDE will render, so an agent
// queries the indexed flow graph instead of re-reading thousands of files.

// callFlowTool dispatches the flow tools.
func (s *mcpServer) callFlowTool(name string, raw jsonv1.RawMessage) (string, error) {
	var args mcpFlowArgs
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	index, err := s.flowIndex(root, args.Refresh)
	if err != nil {
		return "", err
	}
	switch name {
	case "flow_discover":
		return s.flowDiscover(index)
	case "flow_trace":
		if strings.TrimSpace(args.ID) == "" {
			return "", fmt.Errorf("id is required")
		}
		trace, err := index.Trace(args.ID, args.Direction, args.Depth)
		if err != nil {
			return "", err
		}
		return jsonText(trace)
	case "flow_find_paths":
		if strings.TrimSpace(args.From) == "" || strings.TrimSpace(args.To) == "" {
			return "", fmt.Errorf("from and to are required")
		}
		paths, err := index.FindPaths(args.From, args.To, args.Depth, args.Limit)
		if err != nil {
			return "", err
		}
		return jsonText(map[string]any{"from": args.From, "to": args.To, "paths": paths})
	case "flow_impact":
		if strings.TrimSpace(args.ID) == "" {
			return "", fmt.Errorf("id is required")
		}
		impact, err := index.Impact(args.ID, args.Depth)
		if err != nil {
			return "", err
		}
		return jsonText(impact)
	case "flow_explain":
		if strings.TrimSpace(args.ID) == "" {
			return "", fmt.Errorf("id is required")
		}
		explanation, err := index.Explain(args.ID)
		if err != nil {
			return "", err
		}
		return jsonText(explanation)
	}
	return "", fmt.Errorf("unknown flow tool %q", name)
}

type mcpFlowArgs struct {
	Workspace string `json:"workspace"`
	ID        string `json:"id"`
	From      string `json:"from"`
	To        string `json:"to"`
	Direction string `json:"direction"`
	Depth     int    `json:"depth"`
	Limit     int    `json:"limit"`
	Refresh   bool   `json:"refresh"`
}

// flowIndex returns the cached index of a workspace, discovering it on first use.
func (s *mcpServer) flowIndex(root string, refresh bool) (*flowintel.Index, error) {
	s.flowMu.Lock()
	index := s.flowIndexes[root]
	s.flowMu.Unlock()
	if index != nil && !refresh {
		return index, nil
	}
	discovery, err := flowintel.Discover(root)
	if err != nil {
		return nil, err
	}
	index = flowintel.NewIndex(discovery)
	s.flowMu.Lock()
	if s.flowIndexes == nil {
		s.flowIndexes = map[string]*flowintel.Index{}
	}
	s.flowIndexes[root] = index
	s.flowMu.Unlock()
	return index, nil
}

// invalidateFlow drops the cached flow graph after a write.
func (s *mcpServer) invalidateFlow(root string) {
	s.flowMu.Lock()
	delete(s.flowIndexes, root)
	s.flowMu.Unlock()
}

// flowDiscover lists what the engine found and the entry points to start from.
func (s *mcpServer) flowDiscover(index *flowintel.Index) (string, error) {
	discovery := index.Discovery
	flows := index.Flows()
	sort.SliceStable(flows, func(i, j int) bool { return flows[i].Label < flows[j].Label })
	limit := 200
	if len(flows) > limit {
		flows = flows[:limit]
	}
	entryPoints := make([]map[string]any, 0, len(flows))
	for _, flow := range flows {
		entryPoints = append(entryPoints, map[string]any{
			"id": flow.ID, "kind": flow.Kind, "label": flow.Label,
			"file": flow.File, "line": flow.Line,
		})
	}
	problems := discovery.Problems
	if len(problems) > 50 {
		problems = problems[:50]
	}
	return jsonText(map[string]any{
		"root":        discovery.Root,
		"fingerprint": discovery.Fingerprint,
		"adapters":    discovery.Adapters,
		"counts":      discovery.Counts,
		"nodes":       len(discovery.Graph.Nodes),
		"edges":       len(discovery.Graph.Edges),
		"flows":       entryPoints,
		"problems":    problems,
	})
}

// mcpFlowTools is appended to the server tool list.
func mcpFlowTools() []mcpTool {
	object := func(props map[string]any, required ...string) map[string]any {
		schema := map[string]any{"type": "object", "properties": props}
		if len(required) > 0 {
			schema["required"] = required
		}
		return schema
	}
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	integer := func(description string) map[string]any {
		return map[string]any{"type": "integer", "description": description}
	}
	boolean := func(description string) map[string]any {
		return map[string]any{"type": "boolean", "description": description}
	}
	readOnly := map[string]any{"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}
	workspace := str("Code Studio project root. Defaults to the folder passed to `adomnia mcp --workspace`, else the working directory.")
	return []mcpTool{
		{"flow_discover", "Discover flows", "Index the Flow Intelligence graph of the workspace and list the flow/subflow entry points with their source file and line. Adapters: declared `.adomnia/flows.json`, generic XML flow elements, Java annotations (@Flow/@Subflow) and OSGi bundles/Activators/DS services. Read-only; the result is cached per workspace (pass refresh to re-index).", object(map[string]any{"workspace": workspace, "refresh": boolean("Re-index instead of using the cached graph.")}), readOnly},
		{"flow_trace", "Trace a flow", "Walk one flow, subflow or method: downstream (what it calls), upstream (who calls it) or both, up to depth. Returns nodes and edges with the requirement, the source and a confidence (declared, derived, inferred, observed).", object(map[string]any{"workspace": workspace, "id": str("Flow/subflow id or name, method (Class.method), class, bundle or service."), "direction": str("downstream, upstream or both (default downstream)."), "depth": integer("Maximum depth (default 4, max 12).")}, "id"), readOnly},
		{"flow_find_paths", "Find execution paths", "Shortest downstream paths between two nodes of the flow graph, with the edges traversed and the weakest confidence of the path.", object(map[string]any{"workspace": workspace, "from": str("Start flow/method/class id or name."), "to": str("Destination node id or name."), "depth": integer("Maximum path length (default 8, max 16)."), "limit": integer("Maximum paths (default 3, max 10).")}, "from", "to"), readOnly},
		{"flow_impact", "Flow impact", "What reaches this flow/method/class: direct and transitive callers, the flows that would break, the bundles and services involved and the external systems (SOAP/REST/DB/queue) on the way.", object(map[string]any{"workspace": workspace, "id": str("Node id or name."), "depth": integer("Upstream depth (default 6, max 10).")}, "id"), readOnly},
		{"flow_explain", "Explain a step", "Why a node is in the graph: incoming and outgoing relations with the exact requirement/annotation and confidence, plus the source snippet around its line.", object(map[string]any{"workspace": workspace, "id": str("Node id or name.")}, "id"), readOnly},
	}
}

func flowTool(name string) bool {
	for _, tool := range mcpFlowTools() {
		if tool.Name == name {
			return true
		}
	}
	return false
}

var _ = graph.KindFlow
