package java

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"adomnia/internal/ide/language"
	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
)

var (
	_ language.Language         = (*Language)(nil)
	_ language.ProjectDetector  = (*Language)(nil)
	_ language.DocumentSelector = (*Language)(nil)
	_ run.SuggestionProvider    = (*Language)(nil)
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

const springPom = `<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent><artifactId>orders</artifactId></project>`

func TestDetectUnitsFindsTheOutermostMavenAndGradleProjects(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "orders", "pom.xml"), springPom)
	write(t, filepath.Join(root, "orders", "orders-api", "pom.xml"), `<project><artifactId>orders-api</artifactId></project>`)
	write(t, filepath.Join(root, "orders", "target", "pom.xml"), `<project/>`)
	write(t, filepath.Join(root, "billing", "build.gradle.kts"), `plugins { java }`)
	write(t, filepath.Join(root, "billing", "settings.gradle.kts"), `rootProject.name = "billing-service"`)
	write(t, filepath.Join(root, "node_modules", "x", "pom.xml"), `<project/>`)

	units, err := (&Language{}).DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, unit := range units {
		got[filepath.Base(unit.Root)] = unit.Kind + ":" + unit.Name
	}
	want := map[string]string{"orders": "maven:orders", "billing": "gradle:billing-service"}
	if len(got) != len(want) || got["orders"] != want["orders"] || got["billing"] != want["billing"] {
		t.Fatalf("units = %v, want %v", got, want)
	}
}

func TestMavenWinsWhenBothBuildFilesExist(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "pom.xml"), `<project><artifactId>both</artifactId></project>`)
	write(t, filepath.Join(root, "build.gradle"), ``)
	units, _ := (&Language{}).DetectUnits(context.Background(), root)
	if len(units) != 1 || units[0].Kind != UnitMaven {
		t.Fatalf("units = %+v", units)
	}
}

func stubTools(t *testing.T, found ...string) {
	t.Helper()
	previous := lookPath
	lookPath = func(name string) (string, error) {
		for _, candidate := range found {
			if candidate == name {
				return "/usr/bin/" + name, nil
			}
		}
		return "", errors.New("not found")
	}
	t.Cleanup(func() { lookPath = previous })
}

func TestSuggestUsesTheWrapperAndAddsSpringBootRun(t *testing.T) {
	stubTools(t)
	root := t.TempDir()
	wrapper := "mvnw"
	if runtime.GOOS == "windows" {
		wrapper = "mvnw.cmd"
	}
	write(t, filepath.Join(root, "pom.xml"), springPom)
	write(t, filepath.Join(root, wrapper), "")
	write(t, filepath.Join(root, ".mvn", "wrapper", "maven-wrapper.properties"), "")
	unit := project.Unit{Language: ID, Kind: UnitMaven, Root: root, Manifest: filepath.Join(root, "pom.xml")}

	suggestions := (&Language{}).Suggest(context.Background(), root, unit)
	titles := []string{}
	for _, suggestion := range suggestions {
		titles = append(titles, suggestion.Action+"="+suggestion.Configuration.Target+" "+strings.Join(suggestion.Configuration.ProgramArguments, " "))
	}
	want := []string{"run=./" + wrapper + " spring-boot:run", "test=./" + wrapper + " test", "build=./" + wrapper + " package", "build=./" + wrapper + " compile", "build=./" + wrapper + " clean install", "build=./" + wrapper + " clean"}
	if strings.Join(titles, "|") != strings.Join(want, "|") {
		t.Fatalf("suggestions = %v, want %v", titles, want)
	}
	if suggestions[0].Configuration.Kind != "command" || suggestions[0].Language != ID {
		t.Fatalf("a suggestion is a ready command configuration: %+v", suggestions[0])
	}
}

func TestSuggestFallsBackToTheSystemToolAndSkipsWhenThereIsNone(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "build.gradle"), `plugins { id 'org.springframework.boot' version '3.3.0' }`)
	unit := project.Unit{Language: ID, Kind: UnitGradle, Root: root, Manifest: filepath.Join(root, "build.gradle")}

	stubTools(t, "gradle")
	suggestions := (&Language{}).Suggest(context.Background(), root, unit)
	if len(suggestions) != 5 || suggestions[0].Configuration.Target != "gradle" || suggestions[0].Configuration.ProgramArguments[0] != "bootRun" {
		t.Fatalf("suggestions = %+v", suggestions)
	}

	stubTools(t)
	if got := (&Language{}).Suggest(context.Background(), root, unit); len(got) != 0 {
		t.Fatalf("without Gradle there is nothing runnable to propose, got %+v", got)
	}
}

func TestDocumentLanguageID(t *testing.T) {
	for path, want := range map[string]bool{"src/Main.java": true, "Main.JAVA": true, "Main.kt": false, "pom.xml": false} {
		if _, ok := (&Language{}).DocumentLanguageID(path); ok != want {
			t.Fatalf("%s: got %v, want %v", path, ok, want)
		}
	}
}

func TestMajorReadsOldAndNewVersionSchemes(t *testing.T) {
	for version, want := range map[string]int{"21.0.4": 21, "17": 17, "1.8.0_402": 8, "22-ea": 22, "": 0, "junk": 0} {
		if got := Major(version); got != want {
			t.Fatalf("Major(%q) = %d, want %d", version, got, want)
		}
	}
}

func TestDetectJDKPrefersJavaHomeAndExplainsAMissingOne(t *testing.T) {
	home := t.TempDir()
	t.Setenv("JAVA_HOME", home)
	stubTools(t, "java")
	previous := javaVersion
	t.Cleanup(func() { javaVersion = previous })
	javaVersion = func(binary string) (string, error) { return "21.0.4", nil }

	jdk := DetectJDK()
	if !jdk.Available || jdk.Source != "JAVA_HOME" || jdk.Home != home || jdk.Major != 21 {
		t.Fatalf("jdk = %+v", jdk)
	}

	javaVersion = func(string) (string, error) { return "", errors.New("no java") }
	jdk = DetectJDK()
	if jdk.Available || jdk.Problem == "" || len(jdk.Remedies) == 0 {
		t.Fatalf("a missing JDK must come with a problem and remedies, got %+v", jdk)
	}
}

func TestSuggestFindsMainClassesInModulesAndStartsSpringBootAppsThere(t *testing.T) {
	fakeJava(t, "21.0.4")
	root := t.TempDir()
	write(t, filepath.Join(root, "pom.xml"), `<project><artifactId>shop</artifactId><packaging>pom</packaging></project>`)
	write(t, filepath.Join(root, "mvnw"), "")
	write(t, filepath.Join(root, ".mvn", "wrapper", "maven-wrapper.properties"), "")
	write(t, filepath.Join(root, "mvnw.cmd"), "")
	write(t, filepath.Join(root, "api", "pom.xml"), `<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent><artifactId>api</artifactId></project>`)
	write(t, filepath.Join(root, "api", "src", "main", "java", "it", "acme", "ApiApp.java"),
		"package it.acme;\n@SpringBootApplication\npublic class ApiApp { public static void main(String[] args) {} }")
	write(t, filepath.Join(root, "tools", "pom.xml"), `<project><artifactId>tools</artifactId></project>`)
	write(t, filepath.Join(root, "tools", "src", "main", "java", "Cli.java"), "public class Cli { public static void main(final String... args) {} }")
	write(t, filepath.Join(root, "tools", "src", "test", "java", "NotMain.java"), "class NotMain { public static void main(String[] a) {} }")

	units, _ := New().DetectUnits(context.Background(), root)
	if len(units) != 1 {
		t.Fatalf("one outermost unit expected: %+v", units)
	}
	titles := map[string][]string{}
	var cli *run.Suggestion
	for _, suggestion := range New().Suggest(context.Background(), root, units[0]) {
		titles[suggestion.Action+"|"+suggestion.Configuration.Name] = suggestion.Configuration.ProgramArguments
		if suggestion.Configuration.Name == "Main Cli" {
			suggestion := suggestion
			cli = &suggestion
		}
	}
	if args := titles["run|Maven Spring Boot ApiApp"]; strings.Join(args, " ") != "-f api/pom.xml spring-boot:run" {
		t.Errorf("Spring Boot module app: %v", titles)
	}
	if cli == nil || cli.Configuration.Kind != KindMain || cli.UnitRoot != filepath.Join(root, "tools") || !strings.Contains(string(cli.Configuration.LanguageOptions), `"mainClass":"Cli"`) {
		t.Errorf("plain main class must become a main configuration in its module: %+v", cli)
	}
	if _, found := titles["run|Main NotMain"]; found {
		t.Error("test sources are not run targets")
	}
}

func TestGradleApplicationPluginProposesRun(t *testing.T) {
	fakeJava(t, "21.0.4")
	root := t.TempDir()
	write(t, filepath.Join(root, "build.gradle.kts"), "plugins { application }\napplication { mainClass.set(\"x.Main\") }")
	write(t, filepath.Join(root, "gradlew"), "")
	write(t, filepath.Join(root, "gradle", "wrapper", "gradle-wrapper.properties"), "")
	write(t, filepath.Join(root, "gradlew.bat"), "")
	units, _ := New().DetectUnits(context.Background(), root)
	for _, suggestion := range New().Suggest(context.Background(), root, units[0]) {
		if suggestion.Action == "run" && strings.Join(suggestion.Configuration.ProgramArguments, " ") == "run" {
			return
		}
	}
	t.Error("the application plugin must propose gradle run")
}

func TestMainCommandRunsTheClassInItsMavenModule(t *testing.T) {
	fakeJava(t, "21.0.4")
	root := t.TempDir()
	write(t, filepath.Join(root, "pom.xml"), `<project><artifactId>shop</artifactId></project>`)
	write(t, filepath.Join(root, "mvnw"), "")
	write(t, filepath.Join(root, ".mvn", "wrapper", "maven-wrapper.properties"), "")
	write(t, filepath.Join(root, "mvnw.cmd"), "")
	source := filepath.Join(root, "src", "main", "java", "a", "App.java")
	write(t, source, "package a;")
	module, ok := ModuleOf(root, source)
	if !ok || module != root {
		t.Fatalf("module = %q %v", module, ok)
	}
	executable, arguments, display, err := MainCommand(module, "a.App")
	if err != nil || !strings.HasPrefix(filepath.Base(executable), "mvnw") || !strings.Contains(display, "-Dexec.mainClass=a.App") || arguments[len(arguments)-1] != "-Dexec.mainClass=a.App" {
		t.Fatalf("%q %v %q %v", executable, arguments, display, err)
	}
	if _, _, _, err := MainCommand(t.TempDir(), "a.App"); err == nil {
		t.Error("a folder without a build file cannot run a class")
	}
}

func TestIncompleteWrapperFallsBackToTheSystemTool(t *testing.T) {
	stubTools(t, "mvn")
	root := t.TempDir()
	write(t, filepath.Join(root, "pom.xml"), springPom)
	write(t, filepath.Join(root, "mvnw"), "")
	write(t, filepath.Join(root, "mvnw.cmd"), "")
	unit := project.Unit{Language: ID, Kind: UnitMaven, Root: root, Manifest: filepath.Join(root, "pom.xml")}

	tool, ok := resolveBuildTool(unit)
	if !ok || tool.Target != "mvn" {
		t.Fatalf("a mvnw without .mvn/wrapper must not be used, got %+v ok=%v", tool, ok)
	}
}
