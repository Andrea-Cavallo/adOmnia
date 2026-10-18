package codestudio

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Installed Gradle/JDT LS only; no repositories and no tool downloads.
func TestJavaGradleDebugRunStopsAtBreakpoint(t *testing.T) {
	tools, gradle := os.Getenv("ADOMNIA_TEST_JAVA_TOOLS"), os.Getenv("ADOMNIA_TEST_GRADLE")
	if tools == "" || gradle == "" || runtime.GOOS != "windows" {
		t.Skip("set installed Java tools and ADOMNIA_TEST_GRADLE on Windows")
	}
	root := t.TempDir()
	files := map[string]string{
		"gradle/wrapper/gradle-wrapper.properties": "# Fixture delegates to the installed Gradle; no distribution download.\n",
		"settings.gradle":                          "rootProject.name = 'GradleFixture'\n",
		"build.gradle":                             "plugins { id 'application' }\napplication { mainClass = 'demo.App' }\ntasks.register('bootRun', JavaExec) { classpath = sourceSets.main.runtimeClasspath; mainClass = 'demo.App' }\n",
		"gradlew.bat":                              fmt.Sprintf("@call \"%s\" %%*\r\n", gradle),
		".project":                                 `<projectDescription><name>GradleFixture</name><buildSpec><buildCommand><name>org.eclipse.jdt.core.javabuilder</name></buildCommand></buildSpec><natures><nature>org.eclipse.jdt.core.javanature</nature></natures></projectDescription>`,
		".classpath":                               `<classpath><classpathentry kind="src" path="src/main/java"/><classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/><classpathentry kind="output" path="build/classes/java/main"/></classpath>`,
		"src/main/java/demo/App.java": `package demo;
public class App {
 public static void main(String[] args) {
  int total = 41;
  total++;
  System.out.println("gradle-ready " + total + " " + System.getenv("ADOMNIA_FIXTURE_MODE"));
 }
}
`,
	}

	junit, hamcrest := os.Getenv("ADOMNIA_TEST_JUNIT_JAR"), os.Getenv("ADOMNIA_TEST_HAMCREST_JAR")
	if junit != "" && hamcrest != "" {
		files["build.gradle"] += fmt.Sprintf("dependencies { testImplementation files('%s', '%s') }\n", filepath.ToSlash(junit), filepath.ToSlash(hamcrest))
		files[".classpath"] = strings.Replace(files[".classpath"], "</classpath>", fmt.Sprintf(`<classpathentry kind="src" path="src/test/java" output="build/classes/java/test"/><classpathentry kind="lib" path="%s"/><classpathentry kind="lib" path="%s"/></classpath>`, filepath.ToSlash(junit), filepath.ToSlash(hamcrest)), 1)
		files["src/test/java/demo/AppTest.java"] = `package demo;
import org.junit.Test;
public class AppTest {
 @Test public void adds() {
  int total = 41;
  total++;
  org.junit.Assert.assertEquals(42, total);
 }
}
`
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
	settings := map[string]any{"java": map[string]any{"autobuild": map[string]any{"enabled": false}, "import": map[string]any{"gradle": map[string]any{"enabled": false}, "maven": map[string]any{"enabled": false}}}}
	service, recorder, session := startJavaDebugTestProject(t, root, tools, settings)

	cases := []struct {
		task, source string
		line         int
	}{{":run", "src/main/java/demo/App.java", 5}, {":bootRun", "src/main/java/demo/App.java", 5}}
	if junit != "" && hamcrest != "" {
		cases = append(cases, struct {
			task, source string
			line         int
		}{":test", "src/test/java/demo/AppTest.java", 6})
	}
	for _, test := range cases {
		t.Run(test.task, func(t *testing.T) {
			if _, err := service.OpenDocument(string(session.ID), test.source); err != nil {
				t.Fatal(err)
			}
			if _, err := service.SetBreakpoints(string(session.ID), test.source, lineBreakpoints(test.line)); err != nil {
				t.Fatal(err)
			}
			started, err := service.StartJavaDebug(JavaDebugRequest{SessionID: session.ID, BuildArguments: []string{"--offline", "--no-daemon", test.task}, Environment: map[string]string{"ADOMNIA_FIXTURE_MODE": "local"}})
			if err != nil {
				t.Fatalf("Gradle debug: %v", err)
			}
			stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
			frames, err := service.DebugStackTrace(string(started.ID), stopped.ThreadID)
			if err != nil || len(frames) == 0 || frames[0].Line != test.line {
				t.Fatalf("Gradle breakpoint: %v %+v", err, frames)
			}
			evaluated, err := service.DebugEvaluate(string(started.ID), "total", frames[0].ID, "watch")
			if err != nil || evaluated.Result != "41" {
				t.Fatalf("Gradle local: %v %+v", err, evaluated)
			}
			mode, err := service.DebugEvaluate(string(started.ID), `System.getenv("ADOMNIA_FIXTURE_MODE")`, frames[0].ID, "watch")
			if err != nil || !strings.Contains(mode.Result, "local") {
				t.Fatalf("Gradle environment lost: %v %+v", err, mode)
			}
			mark := len(recorder.all())
			if err = service.DebugStep(string(started.ID), "continue", stopped.ThreadID); err != nil {
				t.Fatal(err)
			}
			waitDebugState(t, recorder, started.ID, DebugTerminated, mark)
		})
	}
}
