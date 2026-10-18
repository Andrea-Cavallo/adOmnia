package codestudio

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt-in, installed JDT LS only. A local Eclipse fixture avoids Maven/Gradle dependency downloads.
func TestJavaEditorSemanticHoverAndNestedDefinitions(t *testing.T) {
	tools := os.Getenv("ADOMNIA_TEST_JAVA_TOOLS")
	if tools == "" {
		t.Skip("set ADOMNIA_TEST_JAVA_TOOLS to use installed JDT LS")
	}
	root := t.TempDir()
	files := map[string]string{
		".project":   `<projectDescription><name>EditorFixture</name><buildSpec><buildCommand><name>org.eclipse.jdt.core.javabuilder</name></buildCommand></buildSpec><natures><nature>org.eclipse.jdt.core.javanature</nature></natures></projectDescription>`,
		".classpath": `<classpath><classpathentry kind="src" path="src"/><classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/><classpathentry kind="output" path="bin"/></classpath>`,
		"src/EditorFixture.java": `public class EditorFixture {
 static final int LIMIT = 42;
 int field = 1;
 int outer() {
  int local = consume(inner(deepest(LIMIT)));
  return local + field;
 }
 int consume(int value) { return value; }
 int inner(int value) { return value; }
 int deepest(int value) { return value; }
}
`,
	}
	for relative, text := range files {
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	service, _, session := startJavaDebugTestProject(t, root, tools)
	document, err := service.OpenDocument(string(session.ID), "src/EditorFixture.java")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	text := files["src/EditorFixture.java"]
	line, col := positionOf(t, text, "deepest(LIMIT)", 1)
	for {
		locations, err := service.Locations(ctx, string(session.ID), string(document.Document.ID), "definition", line, col)
		if err == nil && len(locations) > 0 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("Java definitions not ready: %v", err)
		case <-time.After(500 * time.Millisecond):
		}
	}
	tokens, err := service.SemanticTokens(ctx, string(session.ID), string(document.Document.ID))
	if err != nil || len(tokens.Data) == 0 {
		t.Fatalf("Java semantic tokens: %v %+v", err, tokens)
	}
	status := service.lsp.Status(session.ID, "java")
	if status.Features == nil {
		t.Fatal("Java semantic legend missing")
	}
	legend := status.Features
	seen := map[string]bool{}
	lines := strings.Split(text, "\n")
	tokenLine, start := 0, 0
	for i := 0; i+4 < len(tokens.Data); i += 5 {
		delta := int(tokens.Data[i])
		tokenLine += delta
		if delta > 0 {
			start = 0
		}
		start += int(tokens.Data[i+1])
		name := lines[tokenLine][start : start+int(tokens.Data[i+2])]
		tokenType := legend.TokenTypes[tokens.Data[i+3]]
		if name == "local" && tokenType == "variable" {
			seen["local"] = true
		}
		if name == "field" && tokenType == "property" {
			seen["field"] = true
		}
		if name == "LIMIT" {
			for bit, modifier := range legend.TokenModifiers {
				if tokens.Data[i+4]&(1<<bit) != 0 && modifier == "readonly" {
					seen["constant"] = true
				}
			}
		}
	}
	for _, role := range []string{"local", "field", "constant"} {
		if !seen[role] {
			t.Fatalf("Java semantic role %s missing; legend: %+v; seen: %+v", role, legend, seen)
		}
	}
	line, col = positionOf(t, text, "LIMIT)))", 1)
	hover, err := service.Hover(ctx, string(session.ID), string(document.Document.ID), line, col)
	if err != nil || !strings.Contains(hover.Markdown, "42") {
		t.Fatalf("constant value missing from hover: %v %+v", err, hover)
	}
	for _, call := range []struct {
		name string
		want int
	}{{"consume(inner", 8}, {"inner(deepest", 9}, {"deepest(LIMIT", 10}} {
		line, col = positionOf(t, text, call.name, 1)
		locations, err := service.Locations(ctx, string(session.ID), string(document.Document.ID), "definition", line, col)
		if err != nil || len(locations) != 1 || locations[0].Range.StartLine != call.want {
			t.Fatalf("nested call %s: %v %+v", call.name, err, locations)
		}
	}
}
