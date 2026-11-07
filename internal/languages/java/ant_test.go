package java

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

const legacyBuildXML = `<?xml version="1.0"?>
<project name="billing" default="dist" basedir=".">
  <target name="-init"/>
  <target name="compile" description="Compile the sources"/>
  <target name="test" depends="compile"/>
  <target name="dist" depends="compile" description="Build the WAR"/>
  <target name="deploy"/>
</project>`

func TestDetectsAnAntProjectOnlyWithoutMavenOrGradle(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "billing", "build.xml"), legacyBuildXML)
	write(t, filepath.Join(root, "modern", "pom.xml"), `<project><artifactId>modern</artifactId></project>`)
	write(t, filepath.Join(root, "modern", "build.xml"), legacyBuildXML)
	write(t, filepath.Join(root, "notant", "build.xml"), `<configuration/>`)

	units, err := (&Language{}).DetectUnits(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]string{}
	for _, unit := range units {
		kinds[filepath.Base(unit.Root)] = unit.Kind + ":" + unit.Name
	}
	if kinds["billing"] != "ant:billing" || kinds["modern"] != "maven:modern" || kinds["notant"] != "" {
		t.Fatalf("units = %v", kinds)
	}
}

func TestSuggestsTheAntTargetsDefaultFirstAndSkipsPrivateOnes(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "build.xml"), legacyBuildXML)
	unit := project.Unit{Language: ID, Kind: UnitAnt, Root: root, Manifest: filepath.Join(root, "build.xml")}

	stubTools(t)
	t.Setenv("ANT_HOME", "")
	if got := (&Language{}).Suggest(context.Background(), root, unit); len(got) != 0 {
		t.Fatalf("without Ant there is nothing runnable to propose, got %+v", got)
	}

	stubTools(t, "ant")
	suggestions := (&Language{}).Suggest(context.Background(), root, unit)
	got := []string{}
	for _, suggestion := range suggestions {
		got = append(got, suggestion.Action+"="+suggestion.Configuration.Target+" "+strings.Join(suggestion.Configuration.ProgramArguments, " "))
	}
	want := "build=ant -noinput dist|build=ant -noinput compile|test=ant -noinput test|run=ant -noinput deploy"
	if strings.Join(got, "|") != want {
		t.Fatalf("suggestions = %v, want %s", got, want)
	}
	if !strings.Contains(suggestions[0].Title, "(default)") || !strings.Contains(suggestions[0].Title, "Build the WAR") || suggestions[0].Configuration.Kind != "command" {
		t.Fatalf("the default target is marked and described: %+v", suggestions[0])
	}
}

func TestAntFallsBackToAntHome(t *testing.T) {
	home := t.TempDir()
	write(t, filepath.Join(home, "bin", antScript()), "")
	t.Setenv("ANT_HOME", home)
	stubTools(t)
	tool, ok := resolveAnt()
	if !ok || tool.Target != filepath.Join(home, "bin", antScript()) {
		t.Fatalf("tool = %+v, %v", tool, ok)
	}
}
