package java

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
)

func writeFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func withSystemTools(t *testing.T, tools ...string) {
	t.Helper()
	previous := lookPath
	lookPath = func(name string) (string, error) {
		for _, tool := range tools {
			if tool == name {
				return "/usr/bin/" + name, nil
			}
		}
		return "", errors.New("not found")
	}
	t.Cleanup(func() { lookPath = previous })
}

func suggestFor(root, kind, manifest string) []run.Suggestion {
	return (&Language{}).Suggest(context.Background(), root, project.Unit{Language: ID, Kind: kind, Root: root, Manifest: filepath.Join(root, manifest)})
}

func titles(suggestions []run.Suggestion) string {
	names := make([]string, 0, len(suggestions))
	for _, item := range suggestions {
		names = append(names, item.Title)
	}
	return strings.Join(names, "|")
}

func TestSuggestMavenUsesSystemToolAndOffersLifecycleGoals(t *testing.T) {
	withSystemTools(t, "mvn")
	root := writeFixture(t, map[string]string{"pom.xml": "<project><artifactId>demo</artifactId></project>"})
	got := titles(suggestFor(root, UnitMaven, "pom.xml"))
	for _, want := range []string{"mvn test", "mvn package", "mvn clean install"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %s", want, got)
		}
	}
	if strings.Contains(got, "spring-boot:run") {
		t.Errorf("plain Maven project must not get Spring Boot run: %s", got)
	}
}

func TestSuggestSpringBootAddsRunFirst(t *testing.T) {
	withSystemTools(t, "mvn")
	root := writeFixture(t, map[string]string{"pom.xml": "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>"})
	suggestions := suggestFor(root, UnitMaven, "pom.xml")
	if len(suggestions) == 0 || suggestions[0].Action != "run" || !strings.Contains(suggestions[0].Title, "spring-boot:run") {
		t.Fatalf("Spring Boot run should lead: %s", titles(suggestions))
	}
}

func TestSuggestPrefersWrapperOverSystemTool(t *testing.T) {
	withSystemTools(t, "gradle")
	files := map[string]string{"build.gradle": "plugins { id 'application' }", "gradle/wrapper/gradle-wrapper.properties": "x=y"}
	script := "gradlew"
	if runtime.GOOS == "windows" {
		script = "gradlew.bat"
	}
	files[script] = "#!/bin/sh"
	root := writeFixture(t, files)
	suggestions := suggestFor(root, UnitGradle, "build.gradle")
	if len(suggestions) == 0 || !strings.Contains(suggestions[0].Title, "./gradlew run") {
		t.Fatalf("wrapper and application run expected: %s", titles(suggestions))
	}
	if !strings.HasPrefix(suggestions[0].Configuration.Target, "./") {
		t.Errorf("target should be the project wrapper, got %q", suggestions[0].Configuration.Target)
	}
}

func TestSuggestNothingWithoutAnyBuildTool(t *testing.T) {
	withSystemTools(t)
	root := writeFixture(t, map[string]string{"pom.xml": "<project/>"})
	if got := suggestFor(root, UnitMaven, "pom.xml"); len(got) != 0 {
		t.Fatalf("a card that cannot start must not be proposed: %s", titles(got))
	}
}
