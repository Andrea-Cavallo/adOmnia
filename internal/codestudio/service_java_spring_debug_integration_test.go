package codestudio

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Uses installed tools and the local Maven cache; -o forbids dependency downloads.
func TestJavaSpringBootGoalDebugKeepsVMOptions(t *testing.T) {
	tools, version := os.Getenv("ADOMNIA_TEST_JAVA_TOOLS"), os.Getenv("ADOMNIA_TEST_SPRING_VERSION")
	if tools == "" || version == "" {
		t.Skip("set installed Java tools and a cached Spring Boot version")
	}
	if _, err := exec.LookPath("mvn"); err != nil {
		t.Skip("Maven not installed")
	}
	root := t.TempDir()
	pom := fmt.Sprintf(`<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>%s</version><relativePath/></parent><groupId>demo</groupId><artifactId>spring-debug-fixture</artifactId><version>1.0</version><properties><java.version>17</java.version></properties><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency></dependencies><build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>`, version)
	source := `package demo;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@SpringBootApplication
public class App {
 public static void main(String[] args) {
  int total = 41;
  total++;
  SpringApplication app = new SpringApplication(App.class);
  app.setWebApplicationType(org.springframework.boot.WebApplicationType.NONE);
  try (var context = app.run(args)) { System.out.println("spring-ready " + total); }
 }
}
`
	for relative, text := range map[string]string{"pom.xml": pom, "src/main/java/demo/App.java": source} {
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	settings := map[string]any{"java": map[string]any{"autobuild": map[string]any{"enabled": false}, "import": map[string]any{"maven": map[string]any{"offline": map[string]any{"enabled": true}}}}}
	service, recorder, session := startJavaDebugTestProject(t, root, tools, settings)
	if _, err := service.OpenDocument(string(session.ID), "src/main/java/demo/App.java"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetBreakpoints(string(session.ID), "src/main/java/demo/App.java", lineBreakpoints(8)); err != nil {
		t.Fatal(err)
	}
	started, err := service.StartJavaDebug(JavaDebugRequest{SessionID: session.ID, BuildArguments: []string{"-o", "-B", "spring-boot:run", "-Dspring-boot.run.jvmArguments=-Xmx256m -Dfixture.flag=kept"}})
	if err != nil {
		t.Fatalf("Spring Boot debug: %v", err)
	}
	stopped := waitDebugState(t, recorder, started.ID, DebugStopped, 0)
	frames, err := service.DebugStackTrace(string(started.ID), stopped.ThreadID)
	if err != nil || len(frames) == 0 || frames[0].Line != 8 {
		t.Fatalf("Spring breakpoint: %v %+v", err, frames)
	}
	for expression, want := range map[string]string{"total": "41", `System.getProperty("fixture.flag")`: "kept", `System.getProperty("spring.devtools.restart.enabled")`: "false"} {
		result, err := service.DebugEvaluate(string(started.ID), expression, frames[0].ID, "watch")
		if err != nil || !strings.Contains(result.Result, want) {
			t.Fatalf("%s: %v %+v", expression, err, result)
		}
	}
	mark := len(recorder.all())
	if err = service.DebugStep(string(started.ID), "continue", stopped.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitDebugState(t, recorder, started.ID, DebugTerminated, mark)
}
