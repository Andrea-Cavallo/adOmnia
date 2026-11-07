package adomniacli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMCPBuildToolsAreRegistered(t *testing.T) {
	names := map[string]bool{}
	for _, tool := range mcpTools() {
		names[tool.Name] = true
	}
	for _, expected := range []string{"project_build_plan", "project_build"} {
		if !names[expected] {
			t.Fatalf("tool %s is not registered", expected)
		}
	}
}

// A Gradle project without gradlew and without gradle on PATH must still produce a plan: the
// unit is detected and the reason says what is missing, instead of failing the call.
func TestMCPBuildPlanReportsAMissingTool(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "build.gradle"), []byte("// build"), 0o644); err != nil {
		t.Fatal(err)
	}
	server := &mcpServer{workspace: root}
	text, err := server.projectBuildPlan("")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if !strings.Contains(text, `"kind": "gradle"`) || !strings.Contains(text, `"runnable": false`) {
		t.Fatalf("unexpected plan: %s", text)
	}
	if !strings.Contains(text, "no build tool found") {
		t.Fatalf("the plan must explain the missing tool: %s", text)
	}
}

func TestMCPBuildRejectsAnEmptyProject(t *testing.T) {
	server := &mcpServer{workspace: t.TempDir()}
	if _, err := server.projectBuild("", "", 0, ""); err == nil {
		t.Fatal("expected an error for a project without build units")
	}
}

func TestMCPBuildRejectsAnUnknownUnitFilter(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "build.gradle"), []byte("// build"), 0o644); err != nil {
		t.Fatal(err)
	}
	server := &mcpServer{workspace: root}
	if _, err := server.projectBuild("", "", 0, "unit-that-does-not-exist"); err == nil {
		t.Fatal("expected an error for a filter that matches nothing")
	}
}
