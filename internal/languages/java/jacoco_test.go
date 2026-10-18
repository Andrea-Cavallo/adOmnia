package java

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const sampleJaCoCo = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">
<report name="app">
  <package name="it/acme/orders">
    <sourcefile name="OrderService.java">
      <line nr="10" mi="0" ci="3" mb="0" cb="0"/>
      <line nr="11" mi="4" ci="0" mb="0" cb="0"/>
      <line nr="12" mi="2" ci="2" mb="1" cb="1"/>
      <line nr="13" mi="0" ci="0" mb="0" cb="0"/>
    </sourcefile>
    <sourcefile name="Empty.java"><line nr="1" mi="0" ci="0" mb="0" cb="0"/></sourcefile>
  </package>
</report>`

func TestParseJaCoCoKeepsLinesWithInstructions(t *testing.T) {
	files, err := ParseJaCoCo([]byte(sampleJaCoCo))
	if err != nil || len(files) != 1 {
		t.Fatalf("%v %+v", err, files)
	}
	file := files[0]
	if file.Package != "it/acme/orders" || file.Name != "OrderService.java" || len(file.Lines) != 3 {
		t.Fatalf("file = %+v", file)
	}
	if file.Lines[2].MissedInstructions != 2 || file.Lines[2].CoveredInstructions != 2 {
		t.Fatalf("partial line = %+v", file.Lines[2])
	}
	if _, err := ParseJaCoCo([]byte("not xml")); err == nil {
		t.Fatal("garbage must be reported")
	}
}

func TestCoverageArgumentsWrapTheTestGoal(t *testing.T) {
	maven := strings.Join(jacocoMavenArguments([]string{"-B", "test", "-Dtest=FooTest"}), " ")
	want := "-B " + JaCoCoPlugin + ":prepare-agent test " + JaCoCoPlugin + ":report -Dtest=FooTest"
	if maven != want {
		t.Fatalf("maven = %s", maven)
	}
	gradle, err := withCoverage(UnitGradle, []string{"--console=plain", "cleanTest", "test"})
	if err != nil || gradle[0] != "-I" || !strings.HasSuffix(gradle[1], "adomnia-jacoco.init.gradle") || gradle[len(gradle)-1] != "test" {
		t.Fatalf("gradle = %v %v", gradle, err)
	}
}

func TestFindJaCoCoReportsIgnoresOldAndForeignFiles(t *testing.T) {
	root := writeFixture(t, map[string]string{
		"target/site/jacoco/jacoco.xml":                    sampleJaCoCo,
		"api/target/site/jacoco/jacoco.xml":                sampleJaCoCo,
		"build/reports/jacoco/test/jacocoTestReport.xml":   sampleJaCoCo,
		"src/main/resources/target/site/jacoco/jacoco.xml": sampleJaCoCo,
		"docs/jacoco.xml":                                  sampleJaCoCo,
	})
	old := filepath.Join(root, "api", "target", "site", "jacoco", "jacoco.xml")
	longAgo := time.Now().Add(-24 * time.Hour)
	if err := os.Chtimes(old, longAgo, longAgo); err != nil {
		t.Fatal(err)
	}
	found := FindJaCoCoReports(root, time.Now().Add(-time.Hour))
	if len(found) != 2 {
		t.Fatalf("found = %v", found)
	}
}
