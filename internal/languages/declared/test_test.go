package declared

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

func rowAdapter(t *testing.T, id string) language.Language {
	t.Helper()
	for _, l := range Languages() {
		if l.ID() == id {
			return l
		}
	}
	t.Fatalf("no row %s", id)
	return nil
}

func TestCapabilitiesFollowTheRow(t *testing.T) {
	for id, want := range map[string]language.Capabilities{
		"php":    {Run: true, Debug: true, Tests: true, ProjectDetection: true},
		"ruby":   {Run: true, ProjectDetection: true},
		"yaml":   {},
		"cpp":    {Run: true, Debug: true, Tests: true, ProjectDetection: true},
		"csharp": {Run: true, Debug: true, Tests: true, ProjectDetection: true},
	} {
		got := language.CapabilitiesOf(rowAdapter(t, id))
		if got.Run != want.Run || got.Debug != want.Debug || got.Tests != want.Tests || got.ProjectDetection != want.ProjectDetection {
			t.Errorf("%s: %+v", id, got)
		}
	}
}

func TestReportsBecomeTheTestTree(t *testing.T) {
	directory := t.TempDir()
	phpunit := `<testsuites><testsuite name="All"><testsuite name="CartTest">
<testcase name="testAdd" classname="CartTest" time="0.01"/>
<testcase name="testRemove" classname="CartTest" time="0.02"><failure message="boom">Failed asserting 1 = 2</failure></testcase>
<testcase name="testSkip" classname="CartTest"><skipped/></testcase>
</testsuite></testsuite></testsuites>`
	trx := `<TestRun><Results>
<UnitTestResult testId="a" testName="Shop.CartTests.Adds" outcome="Passed" duration="00:00:01.5000000"/>
<UnitTestResult testId="b" testName="Shop.CartTests.Removes" outcome="Failed" duration="00:00:00.1"><Output><ErrorInfo><Message>expected 2</Message><StackTrace>at Removes()</StackTrace></ErrorInfo></Output></UnitTestResult>
</Results><TestDefinitions>
<UnitTest id="a"><TestMethod className="Shop.CartTests" name="Adds"/></UnitTest>
<UnitTest id="b"><TestMethod className="Shop.CartTests" name="Removes"/></UnitTest>
</TestDefinitions></TestRun>`
	for name, content := range map[string]string{"phpunit.xml": phpunit, "run.trx": trx} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	parser := &reportParser{directory: directory}
	tree := idetesting.NewTree()
	for _, event := range parser.Finish() {
		tree.Apply(event)
	}
	if parser.Finish() != nil {
		t.Fatal("reports are read once")
	}
	if _, err := os.Stat(directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("the report folder is removed")
	}
	statuses := map[string]string{}
	results, _ := tree.Snapshot()
	for _, result := range results {
		statuses[result.Package+"/"+result.Name] = result.Status
	}
	for key, status := range map[string]string{
		"CartTest/testAdd": "pass", "CartTest/testRemove": "fail", "CartTest/testSkip": "skip", "CartTest/": "fail",
		"Shop.CartTests/Adds": "pass", "Shop.CartTests/Removes": "fail",
	} {
		if statuses[key] != status {
			t.Errorf("%s = %q, want %q (%v)", key, statuses[key], status, statuses)
		}
	}
}

func TestPHPUnitOfTheProjectWinsAndScriptsDebug(t *testing.T) {
	root := t.TempDir()
	local := filepath.Join(root, "vendor", "bin", "phpunit")
	script := filepath.Join(root, "index.php")
	for _, file := range []string{local, script} {
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("<?php"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(name string) (string, error) { return "/bin/" + name, nil }
	php := rowAdapter(t, "php")

	spec, parser, err := php.(language.TestRunner).TestCommand(idetesting.Request{Root: root, WorkingDirectory: root})
	if err != nil || spec.Executable != local || spec.Arguments[0] != "--log-junit" {
		t.Fatalf("phpunit: %+v %v", spec, err)
	}
	_ = os.RemoveAll(filepath.Dir(spec.Arguments[1]))
	_ = parser

	debug, err := php.(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"program":"index.php","programArguments":["-v"]}`)})
	if err != nil || debug.Executable != "/bin/php-debug-adapter" || debug.Transport != dap.Stdio {
		t.Fatalf("debug: %+v %v", debug, err)
	}
	if _, launch := debug.Launch(""); launch["type"] != "php" || launch["runtimeExecutable"] != "/bin/php" || launch["program"] == "" {
		t.Fatalf("launch: %+v", launch)
	}
	if _, err := rowAdapter(t, "ruby").(dap.DebugAdapterProvider).DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"program":"index.php"}`)}); err == nil {
		t.Fatal("a row without a debugger refuses")
	}
}

func TestDotnetRunsTheProject(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "App.csproj"), []byte("<Project/>"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(name string) (string, error) { return "/bin/" + name, nil }
	runner := rowAdapter(t, "csharp").(language.Runner)
	spec, err := runner.CommandSpec(run.Request{Kind: KindDotnet, Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"project":"App.csproj"}`), ProgramArguments: []string{"--port", "1"}})
	if err != nil || spec.Executable != "/bin/dotnet" || spec.Arguments[0] != "run" || spec.Arguments[1] != "--project" || !slices.Contains(spec.Arguments, "--") {
		t.Fatalf("dotnet: %+v %v", spec, err)
	}
	if _, err := runner.CommandSpec(run.Request{Kind: KindDotnet, Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"project":"../x.csproj"}`)}); err == nil {
		t.Fatal("a project outside the folder is refused")
	}
}

func TestDotnetDebugsTheBuiltAssembly(t *testing.T) {
	root := t.TempDir()
	assembly := filepath.Join(root, "bin", "Debug", "net8.0", "App.dll")
	for _, file := range []string{filepath.Join(root, "App.csproj"), assembly} {
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { lookPath, runDotnetBuild = defaultLookPath, defaultRunDotnetBuild })
	lookPath = func(name string) (string, error) { return "/bin/" + name, nil }
	built := ""
	runDotnetBuild = func(_, _, project string, _ []string) ([]byte, error) {
		built = project
		return []byte("Build succeeded.\n" + assembly + "\n"), nil
	}
	debugger := rowAdapter(t, "csharp").(dap.DebugAdapterProvider)

	spec, err := debugger.DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"programArguments":["-v"]}`)})
	if err != nil || spec.Executable != "/bin/netcoredbg" || spec.Arguments[0] != "--interpreter=vscode" || spec.Transport != dap.Stdio || filepath.Base(built) != "App.csproj" {
		t.Fatalf("debug: %+v %v (built %s)", spec, err, built)
	}
	if _, launch := spec.Launch(""); launch["type"] != "coreclr" || filepath.Base(launch["program"].(string)) != "App.dll" || launch["args"].([]string)[0] != "-v" {
		t.Fatalf("launch: %+v", launch)
	}

	// An SDK older than .NET 8 prints no TargetPath: the newest bin/Debug/<tfm>/App.dll is used.
	runDotnetBuild = func(string, string, string, []string) ([]byte, error) { return []byte("Build succeeded.\n"), nil }
	if spec, err := debugger.DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root}); err != nil || spec.Title != "Debug App.dll" {
		t.Fatalf("fallback: %+v %v", spec, err)
	}
	if _, err := debugger.DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"program":"../Other.csproj"}`)}); err == nil {
		t.Fatal("a project outside the folder is refused")
	}
	if got := language.CapabilitiesOf(rowAdapter(t, "csharp")); !got.Debug {
		t.Fatalf("csharp debugs: %+v", got)
	}
}
