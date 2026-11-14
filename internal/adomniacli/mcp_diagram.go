package adomniacli

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/diagrams"
)

// Diagram Studio over MCP: an agent turns Markdown (or its own structured description) into a
// blueprint file that Diagram Studio opens as a laid-out, fully editable diagram (Import, or drop
// the file on the canvas). Writing the file needs --write; the blueprint is always returned.

type mcpDiagramArgs struct {
	Workspace string            `json:"workspace"`
	Markdown  string            `json:"markdown"`
	Path      string            `json:"path"`
	Output    string            `json:"output"`
	Diagram   jsonv1.RawMessage `json:"diagram"`
	Query     string            `json:"query"`
	Kinds     []string          `json:"kinds"`
	Limit     int               `json:"limit"`
	Refresh   bool              `json:"refresh"`
}

func mcpDiagramTools() []mcpTool {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	object := func(props map[string]any, required ...string) map[string]any {
		schema := map[string]any{"type": "object", "properties": props}
		if len(required) > 0 {
			schema["required"] = required
		}
		return schema
	}
	readOnly := map[string]any{"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}
	write := map[string]any{"readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}
	workspace := str("Folder the output path is relative to. Defaults to `adomnia mcp --workspace`, else the working directory.")
	output := str("Optional file to write, relative to the workspace (default diagrams/<name>.adomnia-diagram.json when set to \"default\"). Requires --write. Open it in Diagram Studio with Import or by dropping it on the canvas.")
	diagram := map[string]any{"type": "object", "description": "Blueprint: {name, nodes:[{key, shape, label, subtitle?, color?, parent?}], links:[{from, to, label?, dashed?, flow?, color?}], sequence?}. sequence is Mermaid sequenceDiagram text (participant/actor, A->>B sync, A-)B async, A-->>B reply, loop/alt/else/opt/end). Call diagram_shapes for shape ids and colors.", "properties": map[string]any{
		"name": str("Diagram name."), "nodes": map[string]any{"type": "array", "items": map[string]any{"type": "object"}}, "links": map[string]any{"type": "array", "items": map[string]any{"type": "object"}}, "sequence": str("Optional sequence diagram text."),
	}}
	return []mcpTool{
		{"diagram_shapes", "Diagram shapes", "List the Diagram Studio shape ids (with what each is for) and the palette colors a blueprint can use.", object(map[string]any{}), readOnly},
		{"diagram_workspace_overview", "Diagram workspace overview", "Summarize the workspace as Diagram Studio sees it: Flow Intelligence (Java/XML/OSGi) entities by kind, adapters, source problems and the services, endpoints, topics, flows and tables worth drawing. Read-only; it never scans outside the workspace. The desktop app adds the Go Semantic Workspace Graph on top of these results.", object(map[string]any{"workspace": workspace, "refresh": map[string]any{"type": "boolean", "description": "Re-discover the sources instead of using the cached index."}, "limit": map[string]any{"type": "integer", "description": "Maximum entities listed per kind (default 20, max 200)."}}), readOnly},
		{"diagram_find_entity", "Find a diagram entity", "Search services, methods, flows, bundles, endpoints, topics and tables of the indexed workspace. Each hit carries its stable id, file and line, so an agent can focus the right node instead of guessing names. Use the flow_* tools for traces, impact and paths.", object(map[string]any{"workspace": workspace, "query": str("Name, id or file fragment."), "kinds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Only these entity kinds (service, function, method, flow, subflow, bundle, endpoint, topic, table, external)."}, "limit": map[string]any{"type": "integer", "description": "Maximum hits (default 20, max 100)."}}), readOnly},
		{"diagram_from_markdown", "Diagram from Markdown", "Turn Markdown into a colored, laid-out Diagram Studio diagram: `#` title, `##` sections with bullet lists become containers of components (shape inferred: database, Kafka topic, queue, cache, gateway, client, external, service), numbered lists become step flows (questions become decisions), lines `A -> B: label` become links (`-->` dashed, `=>` animated), ```mermaid flowcharts and sequenceDiagram blocks are read too. Pass markdown text or a .md path inside the workspace. Returns the blueprint and, with output, writes the file.", object(map[string]any{"workspace": workspace, "markdown": str("Markdown text."), "path": str("A Markdown file inside the workspace, instead of markdown."), "output": output}), write},
		{"diagram_create", "Create a diagram", "Write a diagram the agent describes directly as a blueprint (nodes, links, containers via parent, optional sequence). Validated: unique keys, links and parents must point at nodes. Diagram Studio lays it out with ELK when opened. With output, writes the file (requires --write).", object(map[string]any{"workspace": workspace, "diagram": diagram, "output": output}, "diagram"), write},
	}
}

func diagramTool(name string) bool {
	return strings.HasPrefix(name, "diagram_")
}

func (s *mcpServer) callDiagramTool(name string, raw jsonv1.RawMessage) (string, error) {
	var args mcpDiagramArgs
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
	}
	switch name {
	case "diagram_shapes":
		ids := make([]string, 0, len(diagrams.Shapes))
		for id := range diagrams.Shapes {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		shapes := make([]map[string]string, 0, len(ids))
		for _, id := range ids {
			shapes = append(shapes, map[string]string{"id": id, "use": diagrams.Shapes[id]})
		}
		return jsonText(map[string]any{"shapes": shapes, "colors": diagrams.Colors})
	case "diagram_workspace_overview":
		root, err := s.workspaceRoot(args.Workspace)
		if err != nil {
			return "", err
		}
		index, err := s.flowIndex(root, args.Refresh)
		if err != nil {
			return "", err
		}
		analysis := diagrams.BuildWorkspace(diagrams.WorkspaceInput{Root: root, Flows: index.Discovery})
		limit := args.Limit
		if limit <= 0 || limit > 200 {
			limit = 20
		}
		return jsonText(diagramOverview(analysis, index.Discovery.Adapters, limit))
	case "diagram_find_entity":
		root, err := s.workspaceRoot(args.Workspace)
		if err != nil {
			return "", err
		}
		index, err := s.flowIndex(root, false)
		if err != nil {
			return "", err
		}
		analysis := diagrams.BuildWorkspace(diagrams.WorkspaceInput{Root: root, Flows: index.Discovery})
		return jsonText(diagramFind(analysis, args.Query, args.Kinds, args.Limit))
	case "diagram_from_markdown":
		markdown, err := s.diagramMarkdown(args)
		if err != nil {
			return "", err
		}
		bp, err := diagrams.FromMarkdown(markdown)
		if err != nil {
			return "", err
		}
		return s.diagramResult(bp, args)
	case "diagram_create":
		var bp diagrams.Blueprint
		if len(args.Diagram) == 0 {
			return "", fmt.Errorf("diagram is required")
		}
		if err := json.Unmarshal(args.Diagram, &bp); err != nil {
			return "", fmt.Errorf("invalid diagram: %w", err)
		}
		if err := diagrams.Validate(&bp); err != nil {
			return "", err
		}
		return s.diagramResult(bp, args)
	}
	return "", fmt.Errorf("unknown tool %s", name)
}

func (s *mcpServer) diagramMarkdown(args mcpDiagramArgs) (string, error) {
	if strings.TrimSpace(args.Markdown) != "" {
		return args.Markdown, nil
	}
	if strings.TrimSpace(args.Path) == "" {
		return "", fmt.Errorf("markdown or path is required")
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	path, err := secureWorkspacePath(root, args.Path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", args.Path, err)
	}
	if info.Size() > diagrams.MaxMarkdownBytes {
		return "", fmt.Errorf("%s is larger than %d bytes", args.Path, diagrams.MaxMarkdownBytes)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", args.Path, err)
	}
	return string(content), nil
}

// diagramResult returns the blueprint and writes it when an output was asked for.
func (s *mcpServer) diagramResult(bp diagrams.Blueprint, args mcpDiagramArgs) (string, error) {
	result := map[string]any{"name": bp.Name, "nodes": len(bp.Nodes), "links": len(bp.Links), "hasSequence": bp.Sequence != "", "blueprint": bp}
	output := strings.TrimSpace(args.Output)
	if output == "" {
		result["hint"] = "Pass output (or \"default\") with a server started with --write to save it, then Import the file in Diagram Studio."
		return jsonText(result)
	}
	if err := s.requireWrite(); err != nil {
		return "", err
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	if output == "default" {
		output = diagrams.FileName(bp.Name)
	}
	path, err := secureWorkspacePath(root, output)
	if err != nil {
		return "", err
	}
	data, err := jsonText(bp)
	if err != nil {
		return "", fmt.Errorf("encode the diagram: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("create %s: %w", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(data+"\n"), 0o644); err != nil {
		return "", fmt.Errorf("write %s: %w", output, err)
	}
	result["path"] = path
	return jsonText(result)
}

// diagramOverview is the agent-facing summary of the indexed workspace. It lists a sample per
// entity kind (not everything) and says which adapters ran, so a diagram is never presented as
// complete when only part of the workspace was indexed.
func diagramOverview(analysis diagrams.WorkspaceAnalysis, adapters []string, limit int) map[string]any {
	byKind := map[string][]map[string]any{}
	counts := map[string]int{}
	for _, entity := range analysis.Entities {
		counts[entity.Kind]++
		if len(byKind[entity.Kind]) >= limit {
			continue
		}
		byKind[entity.Kind] = append(byKind[entity.Kind], map[string]any{
			"id": entity.ID, "label": entity.Label, "kind": entity.Kind,
			"file": entity.File, "line": entity.Line, "service": entity.Service, "language": entity.Language,
		})
	}
	kinds := make([]string, 0, len(counts))
	for kind := range counts {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	services := map[string]map[string]any{}
	for _, entity := range analysis.Entities {
		if entity.Kind == diagrams.EntityService {
			services[entity.ID] = map[string]any{"id": entity.ID, "label": entity.Label, "language": entity.Language, "file": entity.File}
		}
	}
	return map[string]any{
		"root": analysis.Root, "fingerprint": analysis.Fingerprint, "languages": analysis.Languages,
		"adapters": adapters, "stats": analysis.Stats, "kinds": kinds, "entitiesByKind": byKind,
		"services": services, "links": len(analysis.Links), "truncated": analysis.Truncated,
		"problems": analysis.Problems,
		"note":     "Flow Intelligence (Java/XML/OSGi) only. Open the project in Code Studio to add the Go Semantic Workspace Graph; the same normalized model feeds Diagram Studio there.",
	}
}

// diagramFind searches the normalized entities by name, id or file, optionally filtered by kind.
func diagramFind(analysis diagrams.WorkspaceAnalysis, query string, kinds []string, limit int) map[string]any {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	needle := strings.ToLower(strings.TrimSpace(query))
	allow := map[string]bool{}
	for _, kind := range kinds {
		allow[strings.ToLower(strings.TrimSpace(kind))] = true
	}
	hits := []map[string]any{}
	for _, entity := range analysis.Entities {
		if len(allow) > 0 && !allow[entity.Kind] {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(entity.Label), needle) &&
			!strings.Contains(strings.ToLower(entity.ID), needle) && !strings.Contains(strings.ToLower(entity.File), needle) {
			continue
		}
		hits = append(hits, map[string]any{
			"id": entity.ID, "kind": entity.Kind, "label": entity.Label, "file": entity.File,
			"line": entity.Line, "service": entity.Service, "confidence": entity.Confidence, "language": entity.Language,
		})
		if len(hits) >= limit {
			break
		}
	}
	return map[string]any{"query": query, "hits": hits, "total": len(hits), "truncated": len(hits) >= limit}
}
