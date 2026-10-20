package codestudio

import (
	"adomnia/internal/languages/java"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Opt-in: reuses installed tools; never downloads a JDK, language server or debugger.
func TestJavaDebugBuildsFreshMainAndStopsAtBreakpoint(t *testing.T) {
	tools := os.Getenv("ADOMNIA_TEST_JAVA_TOOLS")
	if tools == "" {
		t.Skip("set ADOMNIA_TEST_JAVA_TOOLS to the installed tools folder for the real JDT LS/DAP test")
	}
	root := filepath.Join(t.TempDir(), "fresh java debug")
	relative := filepath.Join("src", "main", "java", "com", "wes", "openai", "SpringBootApp.java")
	source := filepath.Join(root, relative)
	if err := os.MkdirAll(filepath.Dir(source), 0755); err != nil {
		t.Fatal(err)
	}
	pom := `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.wes</groupId><artifactId>debug-fixture</artifactId><version>1.0</version><properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties></project>`
	if err := os.WriteFile(filepath.Join(root, "pom.xml"), []byte(pom), 0644); err != nil {
		t.Fatal(err)
	}
	text := "package com.wes.openai;\npublic class SpringBootApp {\n public static void main(String[] args) {\n  int total = 41;\n  total++;\n  System.out.println(\"debug-main-ready \" + total);\n }\n}\n"
	if err := os.WriteFile(source, []byte(text), 0644); err != nil {
		t.Fatal(err)
	}
	service, recorder, session := startJavaDebugTestProject(t, root, tools)
	var err error
	if _, err = service.SetBreakpoints(string(session.ID), filepath.ToSlash(relative), lineBreakpoints(5)); err != nil {
		t.Fatal(err)
	}
	started, err := service.StartJavaDebug(JavaDebugRequest{SessionID: session.ID, MainClass: "com.wes.openai.SpringBootApp"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, "target", "classes", "com", "wes", "openai", "SpringBootApp.class")); err != nil {
		t.Fatalf("debug did not compile the source: %v; console: %s", err, debugOutput(recorder, started.ID))
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	frames, err := service.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || len(frames) == 0 || frames[0].Line != 5 || !strings.HasSuffix(filepath.ToSlash(frames[0].RelativePath), "SpringBootApp.java") {
		t.Fatalf("breakpoint: %v %+v", err, frames)
	}
	evaluated, err := service.DebugEvaluate(string(started.ID), "total", frames[0].ID, "watch")
	if err != nil || evaluated.Result != "41" {
		t.Fatalf("locals at breakpoint: %v %+v", err, evaluated)
	}
	mark := len(recorder.all())
	if err = service.DebugStep(string(started.ID), "next", stopped.ThreadID); err != nil {
		t.Fatal(err)
	}
	stepped := waitDebugState(t, recorder, started.ID, DebugStopped, mark)
	frames, err = service.DebugStackTrace(string(started.ID), stepped.ThreadID)
	if err != nil || len(frames) == 0 {
		t.Fatalf("step: %v %+v", err, frames)
	}
	evaluated, err = service.DebugEvaluate(string(started.ID), "total", frames[0].ID, "watch")
	if err != nil || evaluated.Result != "42" {
		t.Fatalf("locals after step: %v %+v", err, evaluated)
	}
	if err = service.DebugStep(string(started.ID), "continue", stepped.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, mark)
	if output := debugOutput(recorder, started.ID); !strings.Contains(output, "debug-main-ready 42") {
		t.Fatalf("console: %s", output)
	}
}

func startJavaDebugTestProject(t *testing.T, root, tools string, settingsOverride ...map[string]any) (*Service, *eventRecorder, Session) {
	t.Helper()
	workspace := filepath.Join(t.TempDir(), "jdt-workspace")
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
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
	// Keep indexes and caches isolated from the user's running JDT LS workspace.
	for i, arg := range spec.Arguments {
		if arg == "-data" {
			spec.Arguments[i+1] = workspace
		}
	}
	settings := map[string]any{"java": map[string]any{"autobuild": map[string]any{"enabled": false}}}
	if len(settingsOverride) > 0 {
		settings = settingsOverride[0]
	}
	spec.InitializationOptions.(map[string]any)["settings"] = settings
	spec.Configuration = func() any { return settings }
	if _, err = service.lsp.Start(session, spec); err != nil {
		t.Fatal(err)
	}
	return service, recorder, session
}

func TestJavaDebugPreparesExistingMain(t *testing.T) {
	tools, root := os.Getenv("ADOMNIA_TEST_JAVA_TOOLS"), os.Getenv("ADOMNIA_TEST_JAVA_PROJECT")
	if tools == "" || root == "" {
		t.Skip("set installed tools and an explicit existing Maven/Gradle project to verify compilation")
	}
	service, _, session := startJavaDebugTestProject(t, root, tools)
	if err := filepath.WalkDir(filepath.Join(root, "src"), func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && filepath.Ext(path) == ".java" {
			relative, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			_, err = service.OpenDocument(string(session.ID), filepath.ToSlash(relative))
			return err
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	options, err := service.resolveJavaDebug(session, JavaDebugRequest{SessionID: session.ID, MainClass: "com.wes.openai.SpringBootApp"})
	if err != nil {
		if server, ok := service.lsp.server(session.ID, java.ID); ok {
			server.mu.Lock()
			count := 0
			for uri, diagnostics := range server.diagnostics {
				for _, diagnostic := range diagnostics {
					if diagnostic.Severity == 1 && count < 10 {
						t.Logf("Java problem %s:%d: %s", filepath.Base(pathFromURI(uri)), diagnostic.Range.Start.Line+1, diagnostic.Message)
						count++
					}
				}
			}
			server.mu.Unlock()
		}
		t.Fatal(err)
	}
	compiled := filepath.Join(root, "target", "classes", "com", "wes", "openai", "SpringBootApp.class")
	if _, err := os.Stat(compiled); err != nil {
		t.Fatalf("main is not compiled: %v", err)
	}
	found := false
	for _, entry := range options.ClassPaths {
		if _, err := os.Stat(filepath.Join(entry, "com", "wes", "openai", "SpringBootApp.class")); err == nil {
			found = true
			break
		}
	}
	if !found || options.JavaExec == "" || options.Address == "" {
		t.Fatalf("incomplete Java launch: class=%t java=%t adapter=%t", found, options.JavaExec != "", options.Address != "")
	}
	t.Logf("existing SpringBootApp compiled and on runtime classpath (%d entries), JDK and debug adapter resolved", len(options.ClassPaths))
}
