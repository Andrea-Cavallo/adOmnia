package java

import (
	jsonv1 "encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

var _ dap.DebugAdapterProvider = (*Language)(nil)

func TestDebugAdapterConnectsToTheServerInsideJdtls(t *testing.T) {
	options, _ := jsonutil.Marshal(DebugOptions{
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

func TestDebugRequestsCarryStepFilters(t *testing.T) {
	launch := func(options string) map[string]any {
		spec, err := (&Language{}).DebugAdapter(dap.LaunchRequest{WorkingDirectory: "/p", LanguageOptions: jsonv1.RawMessage(options)})
		if err != nil {
			t.Fatal(err)
		}
		_, arguments := spec.Launch("")
		return arguments
	}
	filters, ok := launch(`{"address":"127.0.0.1:1","mainClass":"a.App","classPaths":[]}`)["stepFilters"].(StepFilters)
	if !ok || !filters.SkipSynthetics || !strings.Contains(strings.Join(filters.SkipClasses, " "), "net.bytebuddy.*") || filters.SkipClasses[0] != "$JDK" {
		t.Fatalf("default filters missing: %+v", filters)
	}
	custom, _ := launch(`{"address":"127.0.0.1:1","mainClass":"a.App","classPaths":[],"stepFilters":{"skipClasses":["x.*"]}}`)["stepFilters"].(StepFilters)
	if len(custom.SkipClasses) != 1 || custom.SkipSynthetics {
		t.Fatalf("custom filters must replace the defaults: %+v", custom)
	}
	if launch(`{"address":"127.0.0.1:1","mainClass":"a.App","classPaths":[]}`)["hotCodeReplace"] != "auto" {
		t.Fatal("hot code replace should be automatic while debugging")
	}
	attach := launch(`{"address":"127.0.0.1:1","attachPort":5005}`)
	if _, ok := attach["stepFilters"].(StepFilters); !ok {
		t.Fatal("attach must carry the step filters too")
	}
}
