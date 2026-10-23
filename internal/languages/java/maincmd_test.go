package java

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"adomnia/internal/ide/run"
	"adomnia/internal/jsonutil"
)

func TestMainOptionsAreValidated(t *testing.T) {
	for _, options := range []MainOptions{
		{MainClass: ""}, {MainClass: "a b"}, {MainClass: "a.App", VMOptions: []string{"Xmx1g"}}, {MainClass: "a.App", VMOptions: []string{"-Da=b\n-c"}},
	} {
		if options.validate() == nil {
			t.Errorf("%+v must be rejected", options)
		}
	}
	if err := (MainOptions{MainClass: "a.App", VMOptions: []string{"-Xmx1g", "-Dk=v w"}}).validate(); err != nil {
		t.Error(err)
	}
}

func TestMavenMainPassesArgumentsAndVMOptionsThroughMavenOpts(t *testing.T) {
	arguments := mavenMainArguments(MainOptions{MainClass: "a.App"}, []string{"--name", "two words"})
	if !slices.Contains(arguments, "-Dexec.mainClass=a.App") || !slices.Contains(arguments, `-Dexec.args=--name "two words"`) {
		t.Fatalf("%q", arguments)
	}
	if plain := mavenMainArguments(MainOptions{MainClass: "a.App"}, nil); strings.Contains(strings.Join(plain, " "), "exec.args") {
		t.Fatalf("%q", plain)
	}
}

func TestGradleMainPassesEverythingAsNumberedProperties(t *testing.T) {
	arguments := gradleMainArguments("init.gradle", MainOptions{MainClass: "a.App", VMOptions: []string{"-Xmx1g", "-Dk=v"}}, []string{"x y"})
	want := []string{"--console=plain", "-I", "init.gradle", "-PadomniaMain=a.App", "-PadomniaVm0=-Xmx1g", "-PadomniaVm1=-Dk=v", "-PadomniaArg0=x y", "adomniaRun"}
	if !slices.Equal(arguments, want) {
		t.Fatalf("%q", arguments)
	}
}

func TestMainRunnerBuildsACommandInTheModule(t *testing.T) {
	t.Setenv("MAVEN_OPTS", "")
	fakeJava(t, "21.0.4")
	root := t.TempDir()
	write(t, filepath.Join(root, "pom.xml"), `<project><artifactId>shop</artifactId></project>`)
	write(t, filepath.Join(root, "mvnw"), "")
	write(t, filepath.Join(root, ".mvn", "wrapper", "maven-wrapper.properties"), "")
	write(t, filepath.Join(root, "mvnw.cmd"), "")
	options, _ := jsonutil.Marshal(MainOptions{MainClass: "a.App", VMOptions: []string{"-Xmx1g"}})
	spec, err := New().CommandSpec(run.Request{Kind: KindMain, WorkingDirectory: root, LanguageOptions: options, ProgramArguments: []string{"go"}})
	if err != nil || spec.WorkingDirectory != root || !slices.Contains(spec.Environment, "MAVEN_OPTS=-Xmx1g") || !strings.Contains(spec.DisplayCommand, "exec.mainClass=a.App") {
		t.Fatalf("%+v %v", spec, err)
	}
	if _, err := New().CommandSpec(run.Request{Kind: KindMain, WorkingDirectory: root}); err == nil {
		t.Error("a configuration without options must fail with a clear error")
	}
	if fields := New().RunSchema(KindMain).Fields; len(fields) != 3 || fields[0].Key != "mainClass" || !fields[0].Required {
		t.Errorf("schema = %+v", fields)
	}
	if _, err := New().CommandSpec(run.Request{Kind: KindAttach}); err == nil {
		t.Error("a Remote JVM configuration has nothing to run")
	}
	if fields := New().RunSchema(KindAttach).Fields; len(fields) != 2 || fields[1].Key != "port" {
		t.Errorf("attach schema = %+v", fields)
	}
	if len(New().RunSchema("command").Fields) != 0 {
		t.Error("only the main kind has a Java form")
	}
}

func TestDebugArgumentsOpenAJDWPPort(t *testing.T) {
	maven, port, err := DebugArguments(UnitMaven, []string{"-B", "test", "-Dtest=A#b"}, 6001)
	if err != nil || port != 6001 || !slices.Contains(maven, "-Dmaven.surefire.debug=-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:6001") {
		t.Fatalf("%q %d %v", maven, port, err)
	}
	spring, _, err := DebugArguments(UnitMaven, []string{"-f", "api/pom.xml", "spring-boot:run"}, 6002)
	if err != nil || !strings.HasPrefix(spring[len(spring)-1], "-Dspring-boot.run.jvmArguments=-agentlib:jdwp") {
		t.Fatalf("%q %v", spring, err)
	}
	gradle, port, err := DebugArguments(UnitGradle, []string{"--console=plain", "cleanTest", "test", "--tests", "A.b"}, 0)
	if err != nil || port != GradleDebugPort || !slices.Equal(gradle, []string{"--console=plain", "cleanTest", "test", "--debug-jvm", "--tests", "A.b"}) {
		t.Fatalf("%q %d %v", gradle, port, err)
	}
	if _, _, err := DebugArguments(UnitMaven, []string{"-B", "compile", execPlugin + ":java"}, 6003); err == nil {
		t.Error("exec:java runs inside Maven: it has no JVM of its own to attach to")
	}
	if _, _, err := DebugArguments(UnitGradle, []string{"build"}, 0); err == nil {
		t.Error("a Gradle build has no debuggable task")
	}
}

func TestAttachSpecSendsAnAttachRequest(t *testing.T) {
	spec, err := attachSpec(DebugOptions{Address: "127.0.0.1:9", AttachPort: 5005})
	if err != nil {
		t.Fatal(err)
	}
	command, arguments := spec.Launch("")
	if command != "attach" || arguments["port"] != 5005 || arguments["hostName"] != "127.0.0.1" {
		t.Fatalf("%s %v", command, arguments)
	}
	if _, err := attachSpec(DebugOptions{Address: "127.0.0.1:9", AttachPort: 70000}); err == nil {
		t.Error("an out-of-range port must be rejected")
	}
}
