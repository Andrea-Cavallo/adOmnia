package codestudio

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"adomnia/internal/languages/java"
)

// startJavaMarkersProject avvia JDT LS con le impostazioni di produzione e un workspace stabile
// (per poter leggere il log di Eclipse quando la prova fallisce).
func startJavaMarkersProject(t *testing.T, root, tools string) (*Service, Session) {
	t.Helper()
	workspace := filepath.Join(os.TempDir(), "adomnia-jdt-markers-workspace")
	_ = os.RemoveAll(workspace)
	service := NewService(&memoryStore{}, nil)
	service.toolsRoot = tools
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	session, err = service.SetToolAuthorization(string(session.ID), true)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := java.New().ServerSpec(root, tools)
	if err != nil {
		t.Fatal(err)
	}
	for i, arg := range spec.Arguments {
		if arg == "-data" {
			spec.Arguments[i+1] = workspace
		}
	}
	settings := java.JDTSettings()
	settings["java"].(map[string]any)["autobuild"] = map[string]any{"enabled": false}
	spec.InitializationOptions.(map[string]any)["settings"] = settings
	spec.Configuration = func() any { return settings }
	if _, err = service.lsp.Start(session, spec); err != nil {
		t.Fatal(err)
	}
	return service, session
}

// Opt-in, installed JDT LS only: la fixture Eclipse locale evita download Maven/Gradle.
// I marcatori I↓ devono venire da risultati reali di JDT LS: Shape ha due implementazioni e il suo
// metodo astratto due override. La direzione la dichiara l'adapter (`implementedBy`), perché JDT
// risponde sempre "in basso" al contrario di gopls sui tipi concreti.
func TestJavaImplementationMarkers(t *testing.T) {
	tools := os.Getenv("ADOMNIA_TEST_JAVA_TOOLS")
	if tools == "" {
		t.Skip("set ADOMNIA_TEST_JAVA_TOOLS to use installed JDT LS")
	}
	root := t.TempDir()
	const source = `public class MarkerFixture {
 interface Shape { double area(); }
 static class Circle implements Shape {
  @Override public double area() { return Math.PI * 2 * 2; }
 }
 static class Square implements Shape {
  @Override public double area() { return 4 * 4; }
 }
 public static void main(String[] args) {
  Shape shape = new Circle();
  System.out.println(shape.area());
 }
}
`
	files := map[string]string{
		".project":               `<projectDescription><name>MarkerFixture</name><buildSpec><buildCommand><name>org.eclipse.jdt.core.javabuilder</name></buildCommand></buildSpec><natures><nature>org.eclipse.jdt.core.javanature</nature></natures></projectDescription>`,
		".classpath":             `<classpath><classpathentry kind="src" path="src"/><classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/><classpathentry kind="output" path="bin"/></classpath>`,
		"src/MarkerFixture.java": source,
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
	service, session := startJavaMarkersProject(t, root, tools)
	document, err := service.OpenDocument(string(session.ID), "src/MarkerFixture.java")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	sessionID, documentID := string(session.ID), string(document.Document.ID)

	// Il documento deve essere analizzato: la definition di area() diventa risolvibile.
	line, col := positionOf(t, source, "shape.area()", 1)
	for {
		locations, err := service.Locations(ctx, sessionID, documentID, "definition", line, col)
		if err == nil && len(locations) > 0 {
			break
		}
		if ctx.Err() != nil {
			t.Fatalf("JDT LS did not analyse the fixture: %v", err)
		}
		time.Sleep(500 * time.Millisecond)
	}

	markers, err := service.ImplementationMarkers(ctx, sessionID, documentID)
	if err != nil {
		t.Fatal(err)
	}
	shape := markerNamed(markers, "Shape")
	if shape == nil || shape.Direction != "implementedBy" || len(shape.Locations) != 2 {
		t.Fatalf("Shape marker = %+v (markers: %+v)", shape, markers)
	}
	area := markerNamed(markers, "area()")
	if area == nil || area.Direction != "implementedBy" || len(area.Locations) < 2 {
		t.Fatalf("area marker = %+v (markers: %+v)", area, markers)
	}
}
