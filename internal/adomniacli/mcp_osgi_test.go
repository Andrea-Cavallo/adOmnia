package adomniacli

import (
	"bytes"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
)

// osgiMCPServer builds a server over a temporary PDE workspace without going through stdio.
func osgiMCPServer(t *testing.T, workspace string, allowWrite bool) *mcpServer {
	t.Helper()
	return &mcpServer{workspace: workspace, allowWrite: allowWrite}
}

func writeMCPBundle(t *testing.T, root, name, manifest string, files map[string]string) {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Join(dir, "META-INF"), 0o755); err != nil {
		t.Fatal(err)
	}
	project := "<projectDescription><name>" + name + "</name><natures><nature>org.eclipse.pde.PluginNature</nature></natures></projectDescription>"
	writeMCPFile(t, filepath.Join(dir, ".project"), project)
	writeMCPFile(t, filepath.Join(dir, "META-INF", "MANIFEST.MF"), manifest)
	for relative, content := range files {
		writeMCPFile(t, filepath.Join(dir, filepath.FromSlash(relative)), content)
	}
}

func writeMCPFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// mcpOsgiWorkspace creates a workspace with a core bundle, a consumer, a test fragment and
// a target platform.
func mcpOsgiWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	target := filepath.Join(root, "vendor", "target")
	writeMCPBundle(t, root, "com.acme.core", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.core
Bundle-Version: 1.0.0
Export-Package: com.acme.core.api;version="1.0.0"
Bundle-Activator: com.acme.core.Activator
Service-Component: OSGI-INF/core.xml
`, map[string]string{
		"src/com/acme/core/Activator.java": "package com.acme.core;\npublic class Activator {\n\tpublic void start(org.osgi.framework.BundleContext context) {}\n}\n",
		"OSGI-INF/core.xml":                `<?xml version="1.0"?><scr:component xmlns:scr="http://www.osgi.org/xmlns/scr/v1.1.0" name="core"><implementation class="com.acme.core.Impl"/><service><provide interface="com.acme.core.api.Service"/></service></scr:component>`,
	})
	writeMCPBundle(t, root, "com.acme.ui", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.ui
Bundle-Version: 1.0.0
Require-Bundle: com.acme.core;bundle-version="[1.0.0,2.0.0)"
Import-Package: com.acme.missing
`, nil)
	writeMCPBundle(t, root, "com.acme.core.tests", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.core.tests
Bundle-Version: 1.0.0
Fragment-Host: com.acme.core
Require-Bundle: org.junit
`, nil)
	writeMCPBundle(t, target, "com.acme.lib", "Manifest-Version: 1.0\nBundle-SymbolicName: com.acme.lib\nBundle-Version: 2.0.0\n", nil)
	if _, err := eclipsepde.SetTarget(root, target); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestMCPWorkspaceToolsAreRegistered(t *testing.T) {
	names := map[string]bool{}
	for _, tool := range mcpTools() {
		names[tool.Name] = true
	}
	for _, expected := range []string{"osgi_workspace", "osgi_bundles", "osgi_bundle", "osgi_search", "osgi_impact", "osgi_diagnose", "osgi_resolve", "osgi_target", "osgi_set_target", "osgi_manifest_set", "osgi_manifest_requirement", "osgi_import_plugins", "osgi_add_target_jars", "workspace_read_file", "workspace_write_file", "workspace_list_files", "workspace_overview", "workspace_find_files", "osgi_runtime", "osgi_runtime_start", "osgi_runtime_snapshot", "osgi_runtime_stop"} {
		if !names[expected] {
			t.Fatalf("tool %s is not registered", expected)
		}
	}
}

func TestMCPOsgiWorkspaceAndBundles(t *testing.T) {
	root := mcpOsgiWorkspace(t)
	server := osgiMCPServer(t, root, false)

	text, err := server.callWorkspaceTool("osgi_workspace", jsonv1.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	var overview struct {
		Summary struct {
			Bundles  int `json:"bundles"`
			Resolved int `json:"resolved"`
			Issues   int `json:"issues"`
		} `json:"summary"`
		HasTarget bool `json:"hasTarget"`
	}
	if err := json.Unmarshal([]byte(text), &overview); err != nil {
		t.Fatal(err)
	}
	if !overview.HasTarget || overview.Summary.Bundles != 3 || overview.Summary.Issues == 0 {
		t.Fatalf("overview = %s", text)
	}

	text, err = server.callWorkspaceTool("osgi_bundles", jsonv1.RawMessage(`{"query":"com.acme","limit":10}`))
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		Total   int              `json:"total"`
		Bundles []map[string]any `json:"bundles"`
	}
	if err := json.Unmarshal([]byte(text), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total < 4 || len(page.Bundles) == 0 {
		t.Fatalf("page = %s", text)
	}
	text, err = server.callWorkspaceTool("osgi_bundles", jsonv1.RawMessage(`{"state":"INSTALLED"}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(text), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total == 0 {
		t.Fatalf("no INSTALLED bundle: %s", text)
	}
	for _, bundle := range page.Bundles {
		if bundle["state"] != "INSTALLED" {
			t.Fatalf("state filter leaked %v", bundle["symbolicName"])
		}
	}

	text, err = server.callWorkspaceTool("osgi_bundle", jsonv1.RawMessage(`{"symbolicName":"com.acme.core","depth":2}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "com.acme.ui") || !strings.Contains(text, "com.acme.core.api.Service") {
		t.Fatalf("detail = %s", text)
	}

	text, err = server.callWorkspaceTool("osgi_impact", jsonv1.RawMessage(`{"symbolicName":"com.acme.core"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "com.acme.ui") || !strings.Contains(text, "com.acme.core.tests") {
		t.Fatalf("impact = %s", text)
	}

	text, err = server.callWorkspaceTool("osgi_diagnose", jsonv1.RawMessage(`{"severity":"error"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "missing-requirement") {
		t.Fatalf("diagnostics = %s", text)
	}

	text, err = server.callWorkspaceTool("osgi_target", jsonv1.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	var targetInfo struct {
		TargetBundles int `json:"targetBundles"`
	}
	if err := json.Unmarshal([]byte(text), &targetInfo); err != nil || targetInfo.TargetBundles != 1 {
		t.Fatalf("target = %s (%v)", text, err)
	}
}

func TestMCPOsgiResolveManifest(t *testing.T) {
	root := mcpOsgiWorkspace(t)
	server := osgiMCPServer(t, root, false)
	manifest := `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.new
Bundle-Version: 1.0.0
Import-Package: com.acme.core.api;version="[1.0.0,2.0.0)"
`
	arguments, _ := json.Marshal(map[string]string{"manifest": manifest})
	text, err := server.callWorkspaceTool("osgi_resolve", arguments)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "Resolved") {
		t.Fatalf("resolution = %s", text)
	}
	bad := strings.Replace(manifest, "[1.0.0,2.0.0)", "[9.0.0,10.0.0)", 1)
	arguments, _ = json.Marshal(map[string]string{"manifest": bad})
	text, err = server.callWorkspaceTool("osgi_resolve", arguments)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "Unresolved") || !strings.Contains(text, "9.0.0") {
		t.Fatalf("resolution = %s", text)
	}

	// A bundle path resolves by reading its manifest.
	arguments, _ = json.Marshal(map[string]string{"bundle": "com.acme.ui"})
	text, err = server.callWorkspaceTool("osgi_resolve", arguments)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "Unresolved") {
		t.Fatalf("bundle resolution = %s", text)
	}
}

func TestMCPWorkspaceWriteRequiresOptIn(t *testing.T) {
	root := mcpOsgiWorkspace(t)
	server := osgiMCPServer(t, root, false)
	arguments, _ := json.Marshal(map[string]string{"path": "notes.txt", "content": "hello"})
	if _, err := server.callWorkspaceTool("workspace_write_file", arguments); err == nil || !strings.Contains(err.Error(), "--write") {
		t.Fatalf("write without opt-in = %v", err)
	}

	server.allowWrite = true
	text, err := server.callWorkspaceTool("workspace_write_file", arguments)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, sha256Bytes([]byte("hello"))) {
		t.Fatalf("write = %s", text)
	}
	readArgs, _ := json.Marshal(map[string]string{"path": "notes.txt"})
	text, err = server.callWorkspaceTool("workspace_read_file", readArgs)
	if err != nil || !strings.Contains(text, "hello") {
		t.Fatalf("read = %s %v", text, err)
	}

	// Traversal and a stale expected hash are refused.
	outside, _ := json.Marshal(map[string]string{"path": "../escape.txt", "content": "x"})
	if _, err := server.callWorkspaceTool("workspace_write_file", outside); err == nil {
		t.Fatal("traversal must be refused")
	}
	stale, _ := json.Marshal(map[string]string{"path": "notes.txt", "content": "new", "expectedSha256": "deadbeef"})
	if _, err := server.callWorkspaceTool("workspace_write_file", stale); err == nil || !strings.Contains(err.Error(), "changed meanwhile") {
		t.Fatalf("stale write = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "..", "escape.txt")); err == nil {
		t.Fatal("a file escaped the workspace")
	}
}

func TestMCPManifestRequirementFixesAnImport(t *testing.T) {
	root := mcpOsgiWorkspace(t)
	server := osgiMCPServer(t, root, true)
	arguments, _ := json.Marshal(map[string]string{"bundle": "com.acme.ui", "kind": "import-package", "name": "com.acme.missing", "versionRange": "[1.0.0,2.0.0)"})
	text, err := server.callWorkspaceTool("osgi_manifest_requirement", arguments)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, `"added": true`) && !strings.Contains(text, `"added":true`) {
		t.Fatalf("requirement = %s", text)
	}
	manifest, err := os.ReadFile(filepath.Join(root, "com.acme.ui", "META-INF", "MANIFEST.MF"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(manifest), `com.acme.missing;version="[1.0.0,2.0.0)"`) {
		t.Fatalf("manifest = %s", manifest)
	}

	setArgs, _ := json.Marshal(map[string]string{"bundle": "com.acme.ui", "header": "Bundle-Vendor", "value": "ACME"})
	if _, err := server.callWorkspaceTool("osgi_manifest_set", setArgs); err != nil {
		t.Fatal(err)
	}
	manifest, _ = os.ReadFile(filepath.Join(root, "com.acme.ui", "META-INF", "MANIFEST.MF"))
	if !strings.Contains(string(manifest), "Bundle-Vendor: ACME") {
		t.Fatalf("manifest = %s", manifest)
	}
}

func TestMCPWorkspaceListFiles(t *testing.T) {
	root := mcpOsgiWorkspace(t)
	server := osgiMCPServer(t, root, false)
	text, err := server.callWorkspaceTool("workspace_list_files", jsonv1.RawMessage(`{"depth":1,"limit":50}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "com.acme.core") || strings.Contains(text, "META-INF") {
		t.Fatalf("listing = %s", text)
	}
	if !strings.Contains(text, `"truncated": false`) && !strings.Contains(text, `"truncated":false`) {
		t.Fatalf("truncation flag = %s", text)
	}
}

func TestMCPWorkspaceOverviewAndFindFiles(t *testing.T) {
	root := mcpOsgiWorkspace(t)
	server := osgiMCPServer(t, root, false)
	text, err := server.callWorkspaceTool("workspace_overview", jsonv1.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	var overview struct {
		Languages []string       `json:"languages"`
		Files     int            `json:"files"`
		OSGi      map[string]any `json:"osgi"`
		Write     bool           `json:"writeEnabled"`
	}
	if err := json.Unmarshal([]byte(text), &overview); err != nil {
		t.Fatal(err)
	}
	if overview.Files == 0 || len(overview.Languages) == 0 || overview.OSGi == nil || overview.Write {
		t.Fatalf("overview = %s", text)
	}
	if overview.OSGi["bundles"].(float64) != 3 {
		t.Fatalf("osgi overview = %s", text)
	}

	text, err = server.callWorkspaceTool("workspace_find_files", jsonv1.RawMessage(`{"pattern":"MANIFEST.MF"}`))
	if err != nil {
		t.Fatal(err)
	}
	var found struct {
		Total int `json:"total"`
	}
	if err := json.Unmarshal([]byte(text), &found); err != nil || found.Total != 3 {
		t.Fatalf("find = %s (%v)", text, err)
	}
	text, err = server.callWorkspaceTool("workspace_find_files", jsonv1.RawMessage(`{"query":"com.acme.ui"}`))
	if err != nil || !strings.Contains(text, "com.acme.ui/META-INF/MANIFEST.MF") {
		t.Fatalf("find by query = %s (%v)", text, err)
	}
}

func TestMCPRuntimeStatusAndOptIn(t *testing.T) {
	root := mcpOsgiWorkspace(t)
	server := osgiMCPServer(t, root, false)
	text, err := server.callWorkspaceTool("osgi_runtime", jsonv1.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, `"running": false`) && !strings.Contains(text, `"running":false`) {
		t.Fatalf("status = %s", text)
	}
	if _, err := server.callWorkspaceTool("osgi_runtime_start", jsonv1.RawMessage(`{}`)); err == nil || !strings.Contains(err.Error(), "--write") {
		t.Fatalf("runtime start without opt-in = %v", err)
	}
	if _, err := server.callWorkspaceTool("osgi_runtime_stop", jsonv1.RawMessage(`{}`)); err == nil || !strings.Contains(err.Error(), "--write") {
		t.Fatalf("runtime stop without opt-in = %v", err)
	}
}

// TestMCPStdioExposesWorkspaceTools goes through the real stdio entry point.
func TestMCPStdioExposesWorkspaceTools(t *testing.T) {
	root := mcpOsgiWorkspace(t)
	var out bytes.Buffer
	line := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"osgi_workspace","arguments":{}}}`
	if code := MCP([]string{"mcp", root}, strings.NewReader(line+"\n"), &out, &bytes.Buffer{}); code != 0 {
		t.Fatalf("exit %d", code)
	}
	var reply map[string]any
	if err := json.Unmarshal(out.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	result, ok := reply["result"].(map[string]any)
	if !ok || result["isError"] == true {
		t.Fatalf("reply = %s", out.String())
	}
}
