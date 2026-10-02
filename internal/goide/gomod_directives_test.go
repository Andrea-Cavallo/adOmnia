package goide

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGoModDirectiveActionsBuildSafeArguments(t *testing.T) {
	cases := []struct {
		request DependencyActionRequest
		want    string
	}{
		{DependencyActionRequest{Action: "goversion", Version: "1.24"}, "mod edit -go=1.24"},
		{DependencyActionRequest{Action: "toolchain", Version: "go1.24.3"}, "mod edit -toolchain=go1.24.3"},
		{DependencyActionRequest{Action: "toolchain", Version: "none"}, "mod edit -toolchain=none"},
		{DependencyActionRequest{Action: "module", ModulePath: "example.com/renamed"}, "mod edit -module=example.com/renamed"},
		{DependencyActionRequest{Action: "exclude", ModulePath: "example.com/lib", Version: "v1.2.3"}, "mod edit -exclude=example.com/lib@v1.2.3"},
		{DependencyActionRequest{Action: "dropexclude", ModulePath: "example.com/lib", Version: "v1.2.3"}, "mod edit -dropexclude=example.com/lib@v1.2.3"},
		{DependencyActionRequest{Action: "retract", Version: "v1.0.1"}, "mod edit -retract=v1.0.1"},
		{DependencyActionRequest{Action: "dropretract", Version: "[v1.0.0,v1.1.0]"}, "mod edit -dropretract=[v1.0.0,v1.1.0]"},
		{DependencyActionRequest{Action: "tidydiff"}, "mod tidy -diff"},
	}
	for _, testCase := range cases {
		arguments, err := dependencyArguments(testCase.request, t.TempDir())
		if err != nil || strings.Join(arguments, " ") != testCase.want {
			t.Fatalf("%s: %v %v, atteso %q", testCase.request.Action, arguments, err, testCase.want)
		}
	}
	for _, bad := range []DependencyActionRequest{
		{Action: "goversion", Version: "1.24; rm -rf"},
		{Action: "toolchain", Version: "-modfile=x"},
		{Action: "module", ModulePath: "-replace=x"},
		{Action: "exclude", ModulePath: "example.com/lib", Version: "latest"},
		{Action: "retract", Version: "[v1.0.0]"},
	} {
		if _, err := dependencyArguments(bad, t.TempDir()); err == nil {
			t.Fatalf("%s %q doveva essere rifiutato", bad.Action, bad.Version+bad.ModulePath)
		}
	}
}

func TestDependencyStateReadsDirectives(t *testing.T) {
	root := t.TempDir()
	goMod := "module example.com/app\n\ngo 1.24\n\ntoolchain go1.24.3\n\nexclude example.com/lib v1.2.3\n\nretract (\n\tv1.0.1 // broken build\n\t[v0.9.0, v0.9.5]\n)\n"
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte(goMod), 0o644); err != nil {
		t.Fatal(err)
	}
	state, err := readDependencyState(Project{RootPath: root, RealPath: root}, ".")
	if err != nil {
		t.Fatal(err)
	}
	if state.GoVersion != "1.24" || state.Toolchain != "go1.24.3" || len(state.Excludes) != 1 || len(state.Retracts) != 2 {
		t.Fatalf("direttive non lette: %+v", state)
	}
	if state.Retracts[0].Rationale != "broken build" || state.Retracts[1].Low != "v0.9.0" || state.Retracts[1].High != "v0.9.5" {
		t.Fatalf("retract non letti: %+v", state.Retracts)
	}
}

func TestParseModuleVersionsNewestFirst(t *testing.T) {
	versions, err := parseModuleVersions(`{"Path":"example.com/lib","Version":"v1.3.0","Versions":["v1.1.0","v1.2.0","v1.3.0"]}`)
	if err != nil || strings.Join(versions, ",") != "v1.3.0,v1.2.0,v1.1.0" {
		t.Fatalf("versioni %v %v", versions, err)
	}
}
