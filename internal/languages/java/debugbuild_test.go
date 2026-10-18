package java

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestDebugBuildMovesVMOptionsOutOfBatchCommand(t *testing.T) {
	args, cleanup, err := PrepareDebugBuild("mvn.cmd", []string{"spring-boot:run", `-Dspring-boot.run.jvmArguments=-Xmx512m "-Dconfig=C:\Program Files\app" -Dmarker=a&b`})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	file := strings.TrimPrefix(args[1], "-Dspring-boot.run.jvmArguments=@")
	data, err := os.ReadFile(file)
	if err != nil || !strings.Contains(string(data), `-Xmx512m`) || !strings.Contains(string(data), `Program Files`) {
		t.Fatalf("%v %s", err, data)
	}
	if strings.ContainsAny(args[1], "&\"") {
		t.Fatalf("shell characters leaked: %v", args)
	}
	cleanup()
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("argument file not removed")
	}
}
func TestSplitVMOptionsRejectsBrokenQuoting(t *testing.T) {
	for _, text := range []string{`-Dkey="broken`, "-Dkey=one\n-two"} {
		if _, err := splitVMOptions(text); err == nil {
			t.Fatalf("accepted %q", text)
		}
	}
}
func TestResolveAttachProjectUsesJDTProjectIdentity(t *testing.T) {
	for _, test := range []struct {
		raw, want string
		bad       bool
	}{
		{`[{"projectName":"module-a"},{"projectName":"module-a"}]`, "module-a", false},
		{`[{"projectName":"module-a"},{"projectName":"module-b"}]`, "", true},
		{`[]`, "", false},
	} {
		name, err := ResolveAttachProject("file:///workspace/module", func(command string, args ...any) (json.RawMessage, error) {
			if command != CommandResolveMainClass || args[0] != "file:///workspace/module" {
				t.Fatalf("wrong resolution: %s %v", command, args)
			}
			return json.RawMessage(test.raw), nil
		})
		if name != test.want || (err != nil) != test.bad {
			t.Fatalf("%s: %s %v", test.raw, name, err)
		}
	}
}
