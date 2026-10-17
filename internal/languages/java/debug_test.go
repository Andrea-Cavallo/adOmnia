package java

import (
	"encoding/json"
	"reflect"
	"testing"

	"adomnia/internal/ide/dap"
)

var _ dap.DebugAdapterProvider = (*Language)(nil)

func TestDebugAdapterConnectsToTheServerInsideJdtls(t *testing.T) {
	options, _ := json.Marshal(DebugOptions{
		Address: "127.0.0.1:5005", MainClass: "it.acme.App", ProjectName: "app", JavaExec: "/jdk/bin/java",
		ClassPaths: []string{"/p/target/classes"}, ProgramArguments: []string{"a b", "c"}, VMArguments: []string{"-Xmx1g"},
	})
	spec, err := New().DebugAdapter(dap.LaunchRequest{WorkingDirectory: "/p", LanguageOptions: options})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Address != "127.0.0.1:5005" || spec.Title != "Debug App" || spec.Executable != "" {
		t.Fatalf("no process to start, only a connection: %+v", spec)
	}
	command, arguments := spec.Launch("")
	if command != "launch" || arguments["mainClass"] != "it.acme.App" || arguments["projectName"] != "app" || arguments["args"] != `"a b" c` {
		t.Fatalf("launch = %s %v", command, arguments)
	}
	if !reflect.DeepEqual(arguments["classPaths"], []string{"/p/target/classes"}) {
		t.Errorf("classPaths = %v", arguments["classPaths"])
	}
	if _, err := New().DebugAdapter(dap.LaunchRequest{LanguageOptions: []byte(`{"mainClass":"x"}`)}); err == nil {
		t.Error("without an adapter address there is nothing to connect to")
	}
}
