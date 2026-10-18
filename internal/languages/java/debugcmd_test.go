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
