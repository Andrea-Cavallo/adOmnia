package codestudio

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// Opt-in, installed JDT LS only. A Maven project at Java 1.6 is still a real Java project for JDT LS:
// m2e gives it level 1.6, which JDT no longer compiles; the adapter's repair raises JDT LS's model to
// 1.8 by itself, so the real error of the code replaces "Java 1.6 is no longer supported".
func TestJavaLegacyMavenProjectGetsRealDiagnostics(t *testing.T) {
	tools := os.Getenv("ADOMNIA_TEST_JAVA_TOOLS")
	if tools == "" {
		t.Skip("set ADOMNIA_TEST_JAVA_TOOLS to use installed JDT LS")
	}
	root := t.TempDir()
	files := map[string]string{
		"pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>com.acme</groupId><artifactId>legacy</artifactId><version>1.0</version>
<properties><maven.compiler.source>1.6</maven.compiler.source><maven.compiler.target>1.6</maven.compiler.target></properties></project>`,
		"src/main/java/com/acme/Legacy.java": "package com.acme;\npublic class Legacy {\n public int size() { return undefinedName; }\n}\n",
	}
	for relative, text := range files {
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if reason := java.New().ServerBlocked(root); reason != "" {
		t.Fatalf("a Java 1.6 Maven project must get the language server: %s", reason)
	}
	var mu sync.Mutex
	var seen []string
	service := NewService(&memoryStore{}, nil)
	service.toolsRoot = tools
	t.Cleanup(service.Shutdown)
	service.lsp.SetEmitter(func(eventType string, _ SessionID, _ string, payload any) {
		mu.Lock()
		seen = append(seen, eventType+" "+fmt.Sprintf("%+v", payload))
		mu.Unlock()
	})
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if session, err = service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	spec, err := java.New().ServerSpec(root, tools)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.lsp.Start(session, spec); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OpenDocument(string(session.ID), "src/main/java/com/acme/Legacy.java"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(150 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		all := strings.Join(seen, "\n")
		mu.Unlock()
		if strings.Contains(all, "undefinedName") {
			return
		}
		time.Sleep(time.Second)
	}
	mu.Lock()
	defer mu.Unlock()
	t.Fatalf("no real diagnostic for the Java 1.6 project:\n%s", strings.Join(seen, "\n"))
}
