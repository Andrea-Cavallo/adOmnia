package java

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/language"
	idetesting "adomnia/internal/ide/testing"
	"adomnia/internal/jsonutil"
)

var _ language.TestRunner = (*Language)(nil)

const surefireReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="it.acme.orders.OrderServiceTest" time="0.512" tests="3" errors="1" skipped="1" failures="1">
  <testcase name="createsOrder" classname="it.acme.orders.OrderServiceTest" time="0.2"/>
  <testcase name="totalsLines/with discount" classname="it.acme.orders.OrderServiceTest" time="0.1">
    <failure message="expected: &lt;10&gt; but was: &lt;9&gt;" type="org.opentest4j.AssertionFailedError">org.opentest4j.AssertionFailedError: expected: &lt;10&gt; but was: &lt;9&gt;
	at org.junit.jupiter.api.AssertEquals.fail(AssertEquals.java:55)
	at it.acme.orders.OrderServiceTest.totalsLines(OrderServiceTest.java:42)
</failure>
  </testcase>
  <testcase name="later" classname="it.acme.orders.OrderServiceTest" time="0"><skipped/></testcase>
  <testcase name="blowsUp" classname="it.acme.orders.OrderServiceTest" time="0.01">
    <error message="boom" type="java.lang.IllegalStateException">java.lang.IllegalStateException: boom</error>
  </testcase>
</testsuite>`

func writeModule(t *testing.T, root, module string) string {
	t.Helper()
	write(t, filepath.Join(root, module, "pom.xml"), `<project><artifactId>`+module+`</artifactId></project>`)
	source := filepath.Join(root, module, "src", "test", "java", "it", "acme", "orders", "OrderServiceTest.java")
	write(t, source, "class OrderServiceTest {}")
	write(t, filepath.Join(root, module, "target", "surefire-reports", "TEST-it.acme.orders.OrderServiceTest.xml"), surefireReport)
	return source
}

func TestReportParserTurnsSurefireXMLIntoTheTestTree(t *testing.T) {
	root := t.TempDir()
	source := writeModule(t, root, "orders")
	parser := newReportParser(root, root)

	if events := parser.ParseAll([]byte("[INFO] Tests run: 3")); events != nil {
		t.Fatalf("nothing is read before the build ends: %+v", events)
	}
	events := parser.ParseAll([]byte("[INFO] BUILD FAILURE"))
	pkg := "orders/src/test/java/it/acme/orders/OrderServiceTest.java"
	if len(events) == 0 || events[0].Package != pkg {
		t.Fatalf("tests must hang under the test source file: %+v", events)
	}
	tree := idetesting.NewTree()
	for _, event := range events {
		tree.Apply(event)
	}
	results, _ := tree.Snapshot()
	status := map[string]string{}
	for _, node := range results {
		status[node.Name] = node.Status
	}
	want := map[string]string{"": "fail", "createsOrder": "pass", "totalsLines∕with discount": "fail", "later": "skip", "blowsUp": "fail"}
	if !reflect.DeepEqual(status, want) {
		t.Fatalf("statuses = %v, want %v", status, want)
	}
	var failure *idetesting.TestLocation
	for _, node := range results {
		if node.Name == "totalsLines∕with discount" {
			failure = node.Failure
		}
	}
	if failure == nil || failure.Line != 42 || failure.File != source {
		t.Fatalf("failure must point at the assertion in the test source: %+v", failure)
	}
	if again := parser.ParseAll([]byte("BUILD FAILURE")); again != nil {
		t.Error("the report is read once")
	}
}

func TestReportParserIgnoresStaleReportsAndFindsGradleResults(t *testing.T) {
	root := t.TempDir()
	writeModule(t, root, "old")
	stale := filepath.Join(root, "old", "target", "surefire-reports", "TEST-it.acme.orders.OrderServiceTest.xml")
	if err := os.Chtimes(stale, time.Now().Add(-time.Hour), time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, "app", "build", "test-results", "test", "TEST-x.Y.xml"),
		`<testsuite name="x.Y" time="0.1"><testcase name="ok" classname="x.Y" time="0.1"/></testsuite>`)
	events := newReportParser(root, root).ParseAll([]byte("BUILD SUCCESSFUL in 3s"))
	for _, event := range events {
		if strings.Contains(event.Package, "OrderServiceTest") {
			t.Fatalf("a report from a previous run must not show up: %+v", event)
		}
	}
	if len(events) != 3 || events[0].Package != "x.Y" {
		t.Fatalf("Gradle result with no source file falls back to the class name: %+v", events)
	}
}

func TestTestArgumentsFilterWithoutFailingOtherModules(t *testing.T) {
	maven := testArguments(UnitMaven, []string{"it.acme.FooTest"}, "bar")
	if maven[1] != "test" || !contains(maven, "-Dtest=it.acme.FooTest#bar") || !contains(maven, "-Dsurefire.failIfNoSpecifiedTests=false") {
		t.Errorf("maven = %v", maven)
	}
	if all := testArguments(UnitMaven, nil, ""); !reflect.DeepEqual(all, []string{"-B", "test"}) {
		t.Errorf("unfiltered maven = %v", all)
	}
	gradle := testArguments(UnitGradle, []string{"it.acme.FooTest"}, "bar")
	if !contains(gradle, "cleanTest") || !contains(gradle, "it.acme.FooTest.bar") {
		t.Errorf("gradle must rerun and filter: %v", gradle)
	}
}

func TestClassNameFollowsTheSourceRoot(t *testing.T) {
	cases := map[string]string{
		"src/test/java/it/acme/FooTest.java": "it.acme.FooTest",
		"mod/src/test/kotlin/it/acme/Bar.kt": "it.acme.Bar",
		"loose/BazTest.java":                 "*.BazTest",
	}
	for file, want := range cases {
		if got := className(file); got != want {
			t.Errorf("className(%q) = %q, want %q", file, got, want)
		}
	}
}

func TestTestCommandRunsTheUnitAndRejectsUnsafeFilters(t *testing.T) {
	fakeJava(t, "21.0.4")
	root := t.TempDir()
	write(t, filepath.Join(root, "pom.xml"), `<project><artifactId>a</artifactId></project>`)
	write(t, filepath.Join(root, "mvnw.cmd"), "")
	write(t, filepath.Join(root, "mvnw"), "")
	write(t, filepath.Join(root, ".mvn", "wrapper", "maven-wrapper.properties"), "")
	write(t, filepath.Join(root, "src", "test", "java", "FooTest.java"), "class FooTest {}")
	options, _ := jsonutil.Marshal(TestOptions{Packages: []string{"src/test/java/FooTest.java"}, Run: "works"})
	spec, parser, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: options})
	if err != nil {
		t.Fatal(err)
	}
	if spec.WorkingDirectory != root || !strings.HasPrefix(filepath.Base(spec.Executable), "mvnw") || parser == nil || !contains(spec.Arguments, "-Dtest=FooTest#works") {
		t.Fatalf("unexpected command: %+v", spec)
	}
	bad, _ := jsonutil.Marshal(TestOptions{Packages: []string{"src/test/java/FooTest.java"}, Run: "x; rm -rf /"})
	if _, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: bad}); err == nil {
		t.Error("a method filter that is not an identifier must be refused")
	}
	if _, _, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: t.TempDir()}); err == nil {
		t.Error("a folder with no build file has nothing to test")
	}
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func TestSkippedTestKeepsItsReason(t *testing.T) {
	var suite junitSuite
	report := `<testsuite name="a.FooTest"><testcase name="later" classname="a.FooTest"><skipped message="not ready yet"/></testcase><testcase name="plain" classname="a.FooTest"><skipped/></testcase></testsuite>`
	if err := xml.Unmarshal([]byte(report), &suite); err != nil {
		t.Fatal(err)
	}
	var outputs []string
	var skips int
	for _, event := range suiteEvents("", "a.FooTest", "", suite) {
		if event.Action == "output" {
			outputs = append(outputs, event.Output)
		}
		if event.Action == "skip" {
			skips++
		}
	}
	if skips != 2 || len(outputs) != 1 || outputs[0] != "Skipped: not ready yet\n" {
		t.Fatalf("skips=%d outputs=%q", skips, outputs)
	}
}

func TestMultiMethodFilter(t *testing.T) {
	maven := strings.Join(testArguments(UnitMaven, []string{"a.FooTest"}, "one,two"), " ")
	if !strings.Contains(maven, "-Dtest=a.FooTest#one+two") {
		t.Fatalf("maven: %s", maven)
	}
	gradle := strings.Join(testArguments(UnitGradle, []string{"a.FooTest"}, "one,two"), " ")
	if !strings.Contains(gradle, "--tests a.FooTest.one --tests a.FooTest.two") {
		t.Fatalf("gradle: %s", gradle)
	}
}
