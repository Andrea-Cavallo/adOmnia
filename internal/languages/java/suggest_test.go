package java

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
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

func TestSuggestRecognizesQuarkusAndMicronaut(t *testing.T) {
	withSystemTools(t, "mvn", "gradle")
	quarkus := writeFixture(t, map[string]string{"pom.xml": "<project><artifactId>q</artifactId><dependencies><dependency><groupId>io.quarkus</groupId><artifactId>quarkus-resteasy</artifactId></dependency></dependencies></project>"})
	if got := titles(suggestFor(quarkus, UnitMaven, "pom.xml")); !strings.HasPrefix(got, "Maven · mvn quarkus:dev|") {
		t.Fatalf("quarkus: %s", got)
	}
	micronaut := writeFixture(t, map[string]string{"pom.xml": "<project><artifactId>m</artifactId><build><plugins><plugin><groupId>io.micronaut.maven</groupId><artifactId>micronaut-maven-plugin</artifactId></plugin></plugins></build></project>"})
	if got := titles(suggestFor(micronaut, UnitMaven, "pom.xml")); !strings.HasPrefix(got, "Maven · mvn mn:run|") {
		t.Fatalf("micronaut: %s", got)
	}
	gradleQuarkus := writeFixture(t, map[string]string{"build.gradle": "plugins { id 'io.quarkus' }"})
	if got := titles(suggestFor(gradleQuarkus, UnitGradle, "build.gradle")); !strings.HasPrefix(got, "Gradle · gradle quarkusDev|") {
		t.Fatalf("gradle quarkus: %s", got)
	}
	plain := writeFixture(t, map[string]string{"pom.xml": "<project><artifactId>p</artifactId></project>"})
	if got := titles(suggestFor(plain, UnitMaven, "pom.xml")); strings.Contains(got, "quarkus") || strings.Contains(got, "mn:run") {
		t.Fatalf("a plain project must not get a framework run: %s", got)
	}
}
