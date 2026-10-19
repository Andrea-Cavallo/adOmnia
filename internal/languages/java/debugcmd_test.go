package java

import (
	"slices"
	"strings"
	"testing"
)

func TestDebugArgumentsQualifiedGradleTasks(t *testing.T) {
	for _, task := range []string{":api:bootRun", ":api:run", ":api:test", ":api:adomniaRun"} {
		args, _, err := DebugArguments(UnitGradle, []string{"--offline", task}, 0)
		if err != nil || !slices.Contains(args, "--debug-jvm") {
			t.Fatalf("%s: %v %v", task, args, err)
		}
	}
}

// Quarkus dev mode ha già JDWP in ascolto sulla sua porta: gli argomenti restano intatti e
// l'agent non va iniettato, altrimenti si aprono due debugger e nessuno dei due funziona.
func TestDebugArgumentsLeaveQuarkusDevModeAlone(t *testing.T) {
	args, port, err := DebugArguments(UnitMaven, []string{"-B", "quarkus:dev"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(args, []string{"-B", "quarkus:dev"}) {
		t.Fatalf("quarkus:dev arguments were rewritten: %v", args)
	}
	if port != QuarkusDebugPort {
		t.Fatalf("port = %d, want %d", port, QuarkusDebugPort)
	}
	for _, arg := range args {
		if strings.Contains(arg, "jdwp") {
			t.Fatalf("quarkus:dev must not carry a JDWP agent: %v", args)
		}
	}

	gradle, port, err := DebugArguments(UnitGradle, []string{":api:quarkusDev"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(gradle, []string{":api:quarkusDev"}) {
		t.Fatalf("quarkusDev arguments were rewritten: %v", gradle)
	}
	if slices.Contains(gradle, "--debug-jvm") {
		t.Fatalf("quarkusDev must not take --debug-jvm: %v", gradle)
	}
	if port != QuarkusDebugPort {
		t.Fatalf("port = %d, want %d", port, QuarkusDebugPort)
	}
}
func TestDebugArgumentsKeepSpringVMOptions(t *testing.T) {
	args, _, err := DebugArguments(UnitMaven, []string{"spring-boot:run", "-Dspring-boot.run.jvmArguments=-Xmx512m -Ddemo.mode=local"}, 6002)
	if err != nil {
		t.Fatal(err)
	}
	var values []string
	for _, arg := range args {
		if strings.HasPrefix(arg, "-Dspring-boot.run.jvmArguments=") {
			values = append(values, arg)
		}
	}
	if len(values) != 1 || !strings.Contains(values[0], "-Xmx512m") || !strings.Contains(values[0], "address=127.0.0.1:6002") || !strings.Contains(values[0], "-Dspring.devtools.restart.enabled=false") {
		t.Fatalf("lost VM settings: %v", args)
	}
}
func TestDebugArgumentsDoNotDuplicateGradleFlag(t *testing.T) {
	args, _, err := DebugArguments(UnitGradle, []string{"run", "--debug-jvm"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, arg := range args {
		if arg == "--debug-jvm" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("duplicate flag: %v", args)
	}
}
