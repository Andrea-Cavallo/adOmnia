package java

import (
	"encoding/json/v2"
	"net"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

const remoteRun = `%TESTC  3 v2
%TSTTREE2,core.CoreTest,true,3,false,1,core.CoreTest,,
%TESTS  3,loads(core.CoreTest)
%TESTE  3,loads(core.CoreTest)
%TESTS  4,fails(core.CoreTest)
%FAILED 4,fails(core.CoreTest)
%TRACES 
java.lang.AssertionError: expected 2
	at core.CoreTest.fails(CoreTest.java:12)
%TRACEE 
%TESTE  4,fails(core.CoreTest)
%TESTS  5,@Ignore: skipped(core.CoreTest)
%TESTE  5,@Ignore: skipped(core.CoreTest)
%RUNTIME120
`

func TestRemoteTestRunnerReportsFillTheTree(t *testing.T) {
	root := t.TempDir()
	module := filepath.Join(root, "core.tests")
	write(t, filepath.Join(module, "src", "core", "CoreTest.java"), "package core; public class CoreTest {}")
	listener, port, err := newRemoteTestListener(root, module)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte(remoteRun)); err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()

	results := map[string]string{}
	var failure string
	for _, event := range listener.Finish() {
		if event.Test == "" || event.Action == "run" {
			continue
		}
		if event.Action == "output" {
			failure += event.Output
			continue
		}
		results[event.Test] = event.Action
	}
	if results["loads"] != "pass" || results["fails"] != "fail" || results["skipped"] != "skip" {
		t.Fatalf("results = %v", results)
	}
	if !strings.Contains(failure, "expected 2") || !strings.Contains(failure, "CoreTest.java:12") {
		t.Fatalf("the failure keeps its stack trace: %q", failure)
	}
}

func TestRemoteTestListenerEndsWhenTheRunnerNeverConnects(t *testing.T) {
	listener, _, err := newRemoteTestListener(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if events := listener.Finish(); len(events) != 0 {
		t.Fatalf("events = %+v", events)
	}
}

func TestPluginTestsNeedATestFile(t *testing.T) {
	options, _ := json.Marshal(TestOptions{PluginTest: &PluginTestJVM{Java: "java", Major: 8}})
	if _, _, err := (&Language{}).TestCommand(idetesting.Request{Root: t.TempDir(), LanguageOptions: options}); err == nil || !strings.Contains(err.Error(), "test file") {
		t.Fatalf("err = %v", err)
	}
}

func TestTychoTestBundlesRunWithVerify(t *testing.T) {
	stubTools(t, "mvn")
	root := t.TempDir()
	write(t, filepath.Join(root, "pom.xml"), `<project><artifactId>parent</artifactId><packaging>pom</packaging><modules><module>core.tests</module></modules>
<build><plugins><plugin><groupId>org.eclipse.tycho</groupId><artifactId>tycho-maven-plugin</artifactId></plugin></plugins></build></project>`)
	write(t, filepath.Join(root, "core.tests", "pom.xml"), `<project><artifactId>core.tests</artifactId><packaging>eclipse-test-plugin</packaging></project>`)
	write(t, filepath.Join(root, "core.tests", "src", "test", "java", "core", "CoreTest.java"), "package core; class CoreTest {}")

	for _, packages := range [][]string{{"core.tests/src/test/java/core/CoreTest.java"}, nil} {
		options, _ := json.Marshal(TestOptions{Packages: packages})
		spec, _, err := (&Language{}).TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, LanguageOptions: options})
		if err != nil {
			t.Fatal(err)
		}
		joined := strings.Join(spec.Arguments, " ")
		if !strings.Contains(joined, "verify") || strings.Contains(" "+joined+" ", " test ") {
			t.Fatalf("tycho-surefire runs in integration-test: %v", spec.Arguments)
		}
	}
}
