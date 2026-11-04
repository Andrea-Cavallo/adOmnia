package adomniacli

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// MCP tools for Code Studio workspaces: the same OSGi/PDE engine the IDE uses, exposed to
// an agent as JSON. They read the project folder directly (the folder passed to
// `adomnia mcp` or `--workspace`), so the agent sees the active target platform and the
// workspace bundles without the desktop app running. Writes are disabled unless the server
// was started with --write.

const (
	mcpMaxFileBytes   = 4 << 20
	mcpMaxBundleRows  = 500
	mcpMaxDetailItems = 50
)

// mcpWorkspaceTools is appended to the tool list of the server.
func mcpWorkspaceTools() []mcpTool {
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
	boolean := func(description string) map[string]any {
		return map[string]any{"type": "boolean", "description": description}
	}
	integer := func(description string) map[string]any {
		return map[string]any{"type": "integer", "description": description}
	}
	readOnly := map[string]any{"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}
	write := map[string]any{"readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false}
	destructive := map[string]any{"readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false}
	workspace := str("Code Studio project root (the workspace). Defaults to the folder passed to `adomnia mcp --workspace`, else the process working directory.")
	return []mcpTool{
		{"osgi_workspace", "OSGi workspace overview", "Summarize an OSGi/PDE workspace exactly like the IDE: bundles of the workspace and of the active target platform, resolved/unresolved counts, lazy bundles, issues, Activators, the target path and its Java environment. Read-only.", object(map[string]any{"workspace": workspace}), readOnly},
		{"osgi_bundles", "List OSGi bundles", "List bundles with state (INSTALLED/RESOLVED/RESOLVED-lazy/ACTIVE/TARGET), Activator, start level, issues and missing requirements. Optional full-text query uses the same hot index as the IDE; source/state/issuesOnly filter and limit/offset page large workspaces.", object(map[string]any{"workspace": workspace, "query": str("Full-text query: name, Activator, package, vendor or manifest text."), "source": str("workspace or target."), "state": str("INSTALLED, RESOLVED, ACTIVE or TARGET."), "issuesOnly": boolean("Only bundles with diagnostics."), "limit": integer("Rows per page (default 100, max 500)."), "offset": integer("Rows to skip (default 0).")}), readOnly},
		{"osgi_bundle", "OSGi bundle detail", "Full answer for one bundle: manifest headers, wiring, missing requirements, diagnostics, Activator with start()/stop() lines, Declarative Services, dependency impact (consumers, services, tests, checks) and the focused graph. Arrays are capped for transport; use osgi_impact for the complete consumer list.", object(map[string]any{"workspace": workspace, "symbolicName": str("Bundle-SymbolicName (workspace version wins over the target)."), "depth": integer("Focused graph depth, 1 or 2 (default 1).")}, "symbolicName"), readOnly},
		{"osgi_search", "Search bundles", "Instant search over symbolic name, Activator, exported/imported packages, vendor and manifest text; returns which field matched and how well.", object(map[string]any{"workspace": workspace, "query": str("Text to search."), "limit": integer("Maximum hits (default 40, max 200).")}, "query"), readOnly},
		{"osgi_impact", "Dependency impact", "What breaks if this bundle or class changes: direct and transitive consumers with the exact requirement, incompatible ranges, DS services consumed, PDE test bundles and the checks to run before shipping.", object(map[string]any{"workspace": workspace, "symbolicName": str("Bundle-SymbolicName. Use instead of class."), "class": str("Java class or interface of the workspace, e.g. com.acme.core.api.Service.")}), readOnly},
		{"osgi_diagnose", "OSGi diagnostics", "Every static diagnostic with cause, evidence (manifest headers), available versions and suggested fixes, plus Equinox runtime diagnostics when a runtime snapshot exists in the IDE. Filter by bundle or severity.", object(map[string]any{"workspace": workspace, "symbolicName": str("Only diagnostics of this bundle."), "severity": str("error, warning or info.")}), readOnly},
		{"osgi_resolve", "Resolve a manifest", "Resolve an arbitrary MANIFEST.MF (text) or an existing bundle (path) against the workspace and the active target platform: status, chosen wires, missing requirements with versions available and actions. This is the same resolver the IDE uses.", object(map[string]any{"workspace": workspace, "manifest": str("MANIFEST.MF content to resolve."), "bundle": str("Path of a bundle directory, MANIFEST.MF file or jar inside the workspace.")}), readOnly},
		{"osgi_target", "Target platform", "The active target platform (kind, path, indexed bundles, execution environment) and, with compare, the diff against another target: added, removed and version-changed bundles.", object(map[string]any{"workspace": workspace, "compare": str("Folder of bundles, Eclipse installation or .target file to compare with the active target.")}), readOnly},
		{"osgi_runtime", "OSGi runtime status", "Whether the workspace is running in Equinox for this MCP session, with the console address and start time.", object(map[string]any{"workspace": workspace}), readOnly},
		{"osgi_runtime_start", "Start the OSGi runtime", "Start the compiled bundles in Equinox on the project JVM with the console on an ephemeral loopback port, then return the real state: ACTIVE bundles with the first activation time, start level, service registry and the Equinox `diag` text of what did not resolve. The process belongs to this MCP server and is stopped when it exits. Requires --write.", object(map[string]any{"workspace": workspace}), write},
		{"osgi_runtime_snapshot", "Refresh the OSGi runtime", "Read the running framework again (states, activation order, services, diagnostics) and update the explorer cache.", object(map[string]any{"workspace": workspace}), readOnly},
		{"osgi_runtime_stop", "Stop the OSGi runtime", "Stop the framework and close its console; the ACTIVE overlay is removed. Requires --write.", object(map[string]any{"workspace": workspace}), write},
		{"osgi_set_target", "Set the target platform", "Make a folder of bundles, an Eclipse installation or a .target file the active target of the workspace (writes .adomnia/eclipse-target.json) and return the new overview. Requires --write.", object(map[string]any{"workspace": workspace, "path": str("Absolute path, or a path relative to the workspace, of the target platform.")}, "path"), write},
		{"osgi_manifest_set", "Set a manifest header", "Set or remove one MANIFEST.MF header of a bundle, preserving every other line, the header order and the line endings; the result is parsed before writing. Example: set Require-Bundle to a comma-separated list. Requires --write.", object(map[string]any{"workspace": workspace, "bundle": str("Bundle directory, MANIFEST.MF path or jar inside the workspace."), "header": str("Header name, e.g. Import-Package."), "value": str("Header value; an empty string removes the header."), "expectedSha256": str("Optional SHA-256 of the current manifest: the write fails when the file changed meanwhile.")}, "bundle", "header", "value"), write},
		{"osgi_manifest_requirement", "Add a bundle requirement", "Append one clause to Import-Package or Require-Bundle unless it is already there, with an optional version range. This is the safe way to fix an unresolved import. Returns the new header value. Requires --write.", object(map[string]any{"workspace": workspace, "bundle": str("Bundle directory or MANIFEST.MF path."), "kind": str("import-package or require-bundle."), "name": str("Package name or bundle symbolic name."), "versionRange": str("OSGi version range, e.g. [1.0.0,2.0.0).")}, "bundle", "kind", "name"), write},
		{"osgi_import_plugins", "Import plug-in projects", "Copy one or more Eclipse plug-in project folders into plugins/ of the workspace, as the IDE import does (no overwrite; existing names reported). Requires --write.", object(map[string]any{"workspace": workspace, "sources": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Absolute paths of plug-in project folders."}}, "sources"), write},
		{"osgi_add_target_jars", "Add JARs to the target", "Validate and copy loose JARs into the active target folder (only a folder target; .target definitions and Eclipse installations are refused). Requires --write.", object(map[string]any{"workspace": workspace, "files": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Absolute paths of the JAR files."}}, "files"), destructive},
		{"workspace_read_file", "Read a workspace file", "Read a UTF-8 file inside the workspace (text only, 4 MiB limit) and return its content with SHA-256 and size. Paths outside the workspace are refused.", object(map[string]any{"workspace": workspace, "path": str("File path relative to the workspace (or absolute inside it).")}, "path"), readOnly},
		{"workspace_write_file", "Write a workspace file", "Create or replace a UTF-8 file inside the workspace atomically, optionally only when its current SHA-256 matches. Requires --write.", object(map[string]any{"workspace": workspace, "path": str("File path relative to the workspace."), "content": str("New content."), "expectedSha256": str("Optional SHA-256 of the current content; the write fails when the file changed meanwhile."), "createDirs": boolean("Create missing parent folders (default true).")}, "path", "content"), write},
		{"workspace_list_files", "List workspace files", "List files and folders under a workspace folder (bounded depth and entries), excluding VCS, build output and hidden folders, for navigation of large projects.", object(map[string]any{"workspace": workspace, "path": str("Folder relative to the workspace (default the root)."), "depth": integer("Depth to descend (default 2, max 6)."), "limit": integer("Maximum entries (default 200, max 1000).")}), readOnly},
		{"workspace_overview", "Workspace overview", "What this project is before asking OSGi questions: detected languages/build markers, file and folder counts, the most common extensions, the top-level entries, the project JVM, and - for a PDE workspace - the bundle counts, issues, Activators, target and runtime state. Bounded walk, no file is executed.", object(map[string]any{"workspace": workspace}), readOnly},
		{"workspace_find_files", "Find workspace files", "Find files by a path substring (query) or a glob on the name/relative path (pattern, e.g. *.java or plugins/*/META-INF/MANIFEST.MF). Bounded and ignores VCS/build folders: the way to locate files in a huge workspace.", object(map[string]any{"workspace": workspace, "path": str("Folder to search under (default the workspace root)."), "query": str("Case-insensitive substring of the relative path."), "pattern": str("Glob matched against the file name, then the relative path."), "limit": integer("Maximum matches (default 100, max 500).")}), readOnly},
	}
}

// workspaceOSGITool reports whether the tool belongs to this file.
func workspaceOSGITool(name string) bool {
	for _, tool := range mcpWorkspaceTools() {
		if tool.Name == name {
			return true
		}
	}
	return false
}

type mcpWorkspaceArgs struct {
	Workspace      string   `json:"workspace"`
	Query          string   `json:"query"`
	Source         string   `json:"source"`
	State          string   `json:"state"`
	IssuesOnly     bool     `json:"issuesOnly"`
	Limit          int      `json:"limit"`
	Offset         int      `json:"offset"`
	SymbolicName   string   `json:"symbolicName"`
	Depth          int      `json:"depth"`
	Class          string   `json:"class"`
	Severity       string   `json:"severity"`
	Manifest       string   `json:"manifest"`
	Bundle         string   `json:"bundle"`
	Compare        string   `json:"compare"`
	Path           string   `json:"path"`
	Header         string   `json:"header"`
	Value          string   `json:"value"`
	ExpectedSHA256 string   `json:"expectedSha256"`
	Kind           string   `json:"kind"`
	Name           string   `json:"name"`
	VersionRange   string   `json:"versionRange"`
	Sources        []string `json:"sources"`
	Files          []string `json:"files"`
	Content        string   `json:"content"`
	CreateDirs     *bool    `json:"createDirs"`
	Pattern        string   `json:"pattern"`
}

// callWorkspaceTool dispatches the workspace/OSGi tools.
func (s *mcpServer) callWorkspaceTool(name string, raw jsonv1.RawMessage) (string, error) {
	var args mcpWorkspaceArgs
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return "", fmt.Errorf("invalid arguments: %w", err)
		}
	}
	switch name {
	case "osgi_workspace":
		return s.osgiWorkspace(args)
	case "osgi_bundles":
		return s.osgiBundles(args)
	case "osgi_bundle":
		return s.osgiBundle(args)
	case "osgi_search":
		return s.osgiSearch(args)
	case "osgi_impact":
		return s.osgiImpact(args)
	case "osgi_diagnose":
		return s.osgiDiagnose(args)
	case "osgi_resolve":
		return s.osgiResolve(args)
	case "osgi_target":
		return s.osgiTarget(args)
	case "osgi_runtime", "osgi_runtime_start", "osgi_runtime_snapshot", "osgi_runtime_stop":
		return s.callRuntimeTool(name, raw)
	case "osgi_set_target":
		return s.osgiSetTarget(args)
	case "osgi_manifest_set":
		return s.osgiManifestSet(args)
	case "osgi_manifest_requirement":
		return s.osgiManifestRequirement(args)
	case "osgi_import_plugins":
		return s.osgiImportPlugins(args)
	case "osgi_add_target_jars":
		return s.osgiAddTargetJars(args)
	case "workspace_read_file":
		return s.workspaceReadFile(args)
	case "workspace_write_file":
		return s.workspaceWriteFile(args)
	case "workspace_list_files":
		return s.workspaceListFiles(args)
	case "workspace_overview":
		return s.workspaceOverview(args)
	case "workspace_find_files":
		return s.workspaceFindFiles(args)
	}
	return "", fmt.Errorf("unknown workspace tool %q", name)
}

// workspaceRoot resolves the workspace argument: the request, the server default, the cwd.
func (s *mcpServer) workspaceRoot(requested string) (string, error) {
	root := strings.TrimSpace(requested)
	if root == "" {
		root = strings.TrimSpace(s.workspace)
	}
	if root == "" {
		root = "."
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absolute)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("workspace %s is not a folder", root)
	}
	return absolute, nil
}

// osgiReport returns the cached explorer of a workspace, building it on first use.
func (s *mcpServer) osgiReport(requested string) (*eclipsepde.ExplorerReport, string, error) {
	root, err := s.workspaceRoot(requested)
	if err != nil {
		return nil, "", err
	}
	s.workspaceMu.Lock()
	if report := s.osgiReports[root]; report != nil {
		s.workspaceMu.Unlock()
		return report, root, nil
	}
	s.workspaceMu.Unlock()

	report, err := eclipsepde.BuildExplorer(root, mcpProjectJVMMajor(root))
	if err != nil {
		return nil, "", err
	}
	s.workspaceMu.Lock()
	if s.osgiReports == nil {
		s.osgiReports = map[string]*eclipsepde.ExplorerReport{}
	}
	s.osgiReports[root] = report
	s.workspaceMu.Unlock()
	return report, root, nil
}

// invalidateWorkspace drops the cached explorer after a write.
func (s *mcpServer) invalidateWorkspace(root string) {
	s.workspaceMu.Lock()
	delete(s.osgiReports, root)
	s.workspaceMu.Unlock()
}

// mcpProjectJVMMajor is the JVM chosen for the project, as the IDE reads it.
func mcpProjectJVMMajor(root string) int {
	home := java.ProjectJavaHome(root)
	if home == "" {
		return 0
	}
	jdk, ok := java.InspectJDK(home, "project")
	if !ok {
		return 0
	}
	return jdk.Major
}

// mcpBundleRow is the compact row returned by osgi_bundles.
type mcpBundleRow struct {
	SymbolicName  string `json:"symbolicName"`
	Version       string `json:"version"`
	Source        string `json:"source"`
	State         string `json:"state"`
	RuntimeState  string `json:"runtimeState,omitempty"`
	Lazy          bool   `json:"lazy,omitempty"`
	StartLevel    int    `json:"startLevel"`
	StartOnLaunch bool   `json:"startOnLaunch,omitempty"`
	Activator     string `json:"activator,omitempty"`
	Issues        int    `json:"issues,omitempty"`
	Missing       int    `json:"missing,omitempty"`
	Fragment      bool   `json:"fragment,omitempty"`
	Dependencies  int    `json:"dependencies"`
	Location      string `json:"location,omitempty"`
	ActiveAtMs    int64  `json:"activeAtMs,omitempty"`
	ExecutionEnv  string `json:"executionEnvironment,omitempty"`
}

func bundleRowFrom(row eclipsepde.BundleRow) mcpBundleRow {
	return mcpBundleRow{
		SymbolicName: row.SymbolicName, Version: row.Version, Source: row.Source, State: row.State,
		RuntimeState: row.RuntimeState, Lazy: row.Lazy, StartLevel: row.StartLevel, StartOnLaunch: row.StartOnLaunch,
		Activator: row.Activator, Issues: row.Issues, Missing: len(row.Missing), Fragment: row.Fragment,
		Dependencies: row.Dependencies, Location: row.Location, ActiveAtMs: row.ActiveAtMs,
		ExecutionEnv: row.ExecutionEnvironment,
	}
}

func (s *mcpServer) osgiWorkspace(args mcpWorkspaceArgs) (string, error) {
	report, root, err := s.osgiReport(args.Workspace)
	if err != nil {
		return "", err
	}
	severity := map[string]int{}
	for _, diagnostic := range report.Diagnostics {
		severity[diagnostic.Severity]++
	}
	return jsonText(map[string]any{
		"root":          root,
		"hasTarget":     report.HasTarget,
		"targetPath":    report.TargetPath,
		"targetBundles": report.TargetBundles,
		"java":          report.JVM,
		"summary":       report.Summary,
		"otherProjects": report.OtherProjects,
		"diagnostics":   severity,
		"activators":    len(report.Activators),
		"runtime":       report.Runtime != nil,
		"problems":      report.Problems,
	})
}

func (s *mcpServer) osgiBundles(args mcpWorkspaceArgs) (string, error) {
	report, _, err := s.osgiReport(args.Workspace)
	if err != nil {
		return "", err
	}
	limit := args.Limit
	if limit <= 0 || limit > mcpMaxBundleRows {
		limit = 100
	}
	offset := max(0, args.Offset)
	rows := report.Bundles
	query := strings.ToLower(strings.TrimSpace(args.Query))
	matched := map[string]int{}
	if query != "" {
		for rank, hit := range report.Search(args.Query, mcpMaxBundleRows) {
			if _, seen := matched[hit.SymbolicName]; !seen {
				matched[hit.SymbolicName] = rank
			}
		}
	}
	source := strings.TrimSpace(args.Source)
	state := strings.ToUpper(strings.TrimSpace(args.State))
	filtered := make([]eclipsepde.BundleRow, 0, len(rows))
	for _, row := range rows {
		if query != "" {
			if _, ok := matched[row.SymbolicName]; !ok {
				continue
			}
		}
		if source != "" && row.Source != source {
			continue
		}
		if state != "" && strings.ToUpper(row.State) != state && strings.ToUpper(row.RuntimeState) != state {
			continue
		}
		if args.IssuesOnly && row.Issues == 0 {
			continue
		}
		filtered = append(filtered, row)
	}
	if query != "" {
		sort.SliceStable(filtered, func(i, j int) bool {
			return matched[filtered[i].SymbolicName] < matched[filtered[j].SymbolicName]
		})
	}
	total := len(filtered)
	if offset > total {
		offset = total
	}
	end := min(total, offset+limit)
	page := make([]mcpBundleRow, 0, end-offset)
	for _, row := range filtered[offset:end] {
		page = append(page, bundleRowFrom(row))
	}
	return jsonText(map[string]any{
		"total":    total,
		"offset":   offset,
		"limit":    limit,
		"returned": len(page),
		"bundles":  page,
	})
}

func (s *mcpServer) osgiBundle(args mcpWorkspaceArgs) (string, error) {
	report, _, err := s.osgiReport(args.Workspace)
	if err != nil {
		return "", err
	}
	name := strings.TrimSpace(args.SymbolicName)
	if name == "" {
		return "", fmt.Errorf("symbolicName is required")
	}
	depth := args.Depth
	if depth != 2 {
		depth = 1
	}
	detail, err := report.Detail(name, depth)
	if err != nil {
		return "", err
	}
	impact := detail.Impact
	if impact != nil {
		impact = truncateImpact(impact)
	}
	graph := detail.Graph
	if graph != nil && len(graph.Nodes) > mcpMaxDetailItems {
		graph.Nodes = graph.Nodes[:mcpMaxDetailItems]
		graph.Truncated = true
	}
	return jsonText(map[string]any{
		"bundle":            bundleRowFrom(detail.Row),
		"manifestFile":      detail.ManifestFile,
		"manifest":          detail.Manifest,
		"wires":             detail.Wires,
		"missing":           detail.Missing,
		"notes":             detail.Notes,
		"diagnostics":       detail.Diagnostics,
		"activator":         detail.Activator,
		"serviceComponents": detail.ServiceComponents,
		"impact":            impact,
		"graph":             graph,
	})
}

// truncateImpact keeps the MCP payload small: the first items are the ones that matter.
func truncateImpact(impact *eclipsepde.Impact) *eclipsepde.Impact {
	copied := *impact
	if len(copied.DirectConsumers) > mcpMaxDetailItems {
		copied.DirectConsumers = copied.DirectConsumers[:mcpMaxDetailItems]
	}
	if len(copied.Transitive) > mcpMaxDetailItems {
		copied.Transitive = copied.Transitive[:mcpMaxDetailItems]
	}
	if len(copied.Tests) > mcpMaxDetailItems {
		copied.Tests = copied.Tests[:mcpMaxDetailItems]
	}
	return &copied
}

func (s *mcpServer) osgiSearch(args mcpWorkspaceArgs) (string, error) {
	report, _, err := s.osgiReport(args.Workspace)
	if err != nil {
		return "", err
	}
	query := strings.TrimSpace(args.Query)
	if query == "" {
		return "", fmt.Errorf("query is required")
	}
	limit := args.Limit
	if limit <= 0 || limit > 200 {
		limit = 40
	}
	return jsonText(map[string]any{"query": query, "hits": report.Search(query, limit)})
}

func (s *mcpServer) osgiImpact(args mcpWorkspaceArgs) (string, error) {
	report, _, err := s.osgiReport(args.Workspace)
	if err != nil {
		return "", err
	}
	if class := strings.TrimSpace(args.Class); class != "" {
		impact, err := report.AnalyzeImpactForClass(class)
		if err != nil {
			return "", err
		}
		return jsonText(truncateImpact(impact))
	}
	name := strings.TrimSpace(args.SymbolicName)
	if name == "" {
		return "", fmt.Errorf("symbolicName or class is required")
	}
	impact, err := report.AnalyzeImpact(name)
	if err != nil {
		return "", err
	}
	return jsonText(truncateImpact(impact))
}

func (s *mcpServer) osgiDiagnose(args mcpWorkspaceArgs) (string, error) {
	report, _, err := s.osgiReport(args.Workspace)
	if err != nil {
		return "", err
	}
	name := strings.TrimSpace(args.SymbolicName)
	severity := strings.ToLower(strings.TrimSpace(args.Severity))
	out := []eclipsepde.Diagnostic{}
	for _, diagnostic := range append(append([]eclipsepde.Diagnostic{}, report.Diagnostics...), report.RuntimeDiagnostics...) {
		if name != "" && diagnostic.Bundle != name {
			continue
		}
		if severity != "" && diagnostic.Severity != severity {
			continue
		}
		out = append(out, diagnostic)
	}
	return jsonText(map[string]any{"total": len(out), "diagnostics": out})
}

func (s *mcpServer) osgiResolve(args mcpWorkspaceArgs) (string, error) {
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	jvm := mcpProjectJVMMajor(root)
	if bundle := strings.TrimSpace(args.Bundle); bundle != "" {
		resolution, err := eclipsepde.ResolveManifestFile(root, bundle, jvm)
		if err != nil {
			return "", err
		}
		return jsonText(resolution)
	}
	if manifest := args.Manifest; strings.TrimSpace(manifest) != "" {
		resolution, err := eclipsepde.ResolveManifest(root, []byte(manifest), jvm)
		if err != nil {
			return "", err
		}
		return jsonText(resolution)
	}
	return "", fmt.Errorf("manifest or bundle is required")
}

func (s *mcpServer) osgiTarget(args mcpWorkspaceArgs) (string, error) {
	report, root, err := s.osgiReport(args.Workspace)
	if err != nil {
		return "", err
	}
	out := map[string]any{
		"hasTarget":        report.HasTarget,
		"targetPath":       report.TargetPath,
		"targetBundles":    report.TargetBundles,
		"workspaceBundles": report.Summary.Bundles,
	}
	compare := strings.TrimSpace(args.Compare)
	if compare == "" {
		return jsonText(out)
	}
	if !filepath.IsAbs(compare) {
		compare = filepath.Join(root, filepath.FromSlash(compare))
	}
	comparison, err := eclipsepde.CompareTargets(report.TargetPath, compare)
	if err != nil {
		return "", err
	}
	out["comparison"] = comparison
	return jsonText(out)
}

func (s *mcpServer) osgiSetTarget(args mcpWorkspaceArgs) (string, error) {
	if err := s.requireWrite(); err != nil {
		return "", err
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	path := strings.TrimSpace(args.Path)
	if path == "" {
		return "", fmt.Errorf("path is required")
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, filepath.FromSlash(path))
	}
	if _, err := eclipsepde.SetTarget(root, path); err != nil {
		return "", err
	}
	s.invalidateWorkspace(root)
	return s.osgiWorkspace(mcpWorkspaceArgs{Workspace: root})
}

func (s *mcpServer) osgiManifestSet(args mcpWorkspaceArgs) (string, error) {
	if err := s.requireWrite(); err != nil {
		return "", err
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	manifestPath, err := s.bundleManifestPath(root, args.Bundle)
	if err != nil {
		return "", err
	}
	before, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", err
	}
	sha := sha256Bytes(before)
	if expected := strings.TrimSpace(args.ExpectedSHA256); expected != "" && !strings.EqualFold(expected, sha) {
		return "", fmt.Errorf("the manifest changed meanwhile (current sha256 %s)", sha)
	}
	if strings.TrimSpace(args.Header) == "" {
		return "", fmt.Errorf("header is required")
	}
	edited, changed, err := eclipsepde.SetManifestHeader(before, args.Header, args.Value)
	if err != nil {
		return "", err
	}
	if changed {
		if err := writeFileAtomic(manifestPath, edited, true); err != nil {
			return "", err
		}
		s.invalidateWorkspace(root)
	}
	manifest, _ := eclipsepde.ParseManifest(edited)
	value := ""
	if manifest != nil {
		value = manifest.Main[args.Header]
	}
	return jsonText(map[string]any{"path": manifestPath, "header": args.Header, "value": value, "changed": changed, "sha256": sha256Bytes(edited)})
}

func (s *mcpServer) osgiManifestRequirement(args mcpWorkspaceArgs) (string, error) {
	if err := s.requireWrite(); err != nil {
		return "", err
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	manifestPath, err := s.bundleManifestPath(root, args.Bundle)
	if err != nil {
		return "", err
	}
	before, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", err
	}
	edited, added, err := eclipsepde.AddManifestRequirement(before, args.Kind, args.Name, args.VersionRange)
	if err != nil {
		return "", err
	}
	if added {
		if err := writeFileAtomic(manifestPath, edited, true); err != nil {
			return "", err
		}
		s.invalidateWorkspace(root)
	}
	manifest, _ := eclipsepde.ParseManifest(edited)
	header := "Import-Package"
	if strings.Contains(strings.ToLower(args.Kind), "bundle") {
		header = "Require-Bundle"
	}
	value := ""
	if manifest != nil {
		value = manifest.Main[header]
	}
	return jsonText(map[string]any{"path": manifestPath, "header": header, "value": value, "added": added})
}

// bundleManifestPath resolves a bundle argument (directory, manifest file or jar) inside the
// workspace. Only paths inside the workspace are accepted.
func (s *mcpServer) bundleManifestPath(root, bundle string) (string, error) {
	if strings.TrimSpace(bundle) == "" {
		return "", fmt.Errorf("bundle is required")
	}
	path, err := secureWorkspacePath(root, bundle)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("bundle %s not found", bundle)
	}
	if info.IsDir() {
		return filepath.Join(path, "META-INF", "MANIFEST.MF"), nil
	}
	if strings.EqualFold(filepath.Ext(path), ".jar") {
		return "", fmt.Errorf("editing a manifest inside a jar is not supported: extract the bundle or edit its source project")
	}
	return path, nil
}

func (s *mcpServer) osgiImportPlugins(args mcpWorkspaceArgs) (string, error) {
	if err := s.requireWrite(); err != nil {
		return "", err
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	if len(args.Sources) == 0 {
		return "", fmt.Errorf("sources is required")
	}
	result, err := eclipsepde.ImportPlugins(context.Background(), root, args.Sources, nil)
	if err != nil {
		return "", err
	}
	if len(result.Imported) > 0 {
		s.invalidateWorkspace(root)
	}
	return jsonText(result)
}

func (s *mcpServer) osgiAddTargetJars(args mcpWorkspaceArgs) (string, error) {
	if err := s.requireWrite(); err != nil {
		return "", err
	}
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	if len(args.Files) == 0 {
		return "", fmt.Errorf("files is required")
	}
	result, err := eclipsepde.ImportLooseJars(root, args.Files)
	if err != nil {
		return "", err
	}
	if len(result.Imported) > 0 {
		s.invalidateWorkspace(root)
	}
	return jsonText(result)
}
