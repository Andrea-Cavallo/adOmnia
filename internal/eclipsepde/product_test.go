package eclipsepde

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const rcpProduct = `<?xml version="1.0" encoding="UTF-8"?>
<?pde version="3.5"?>
<product name="Acme" uid="acme.product" id="app.product" application="app.application" version="1.0.0" useFeatures="true" includeLaunchers="true">
   <launcherArgs>
      <programArgs>-clearPersistedState</programArgs>
      <programArgsWin>--win-only</programArgsWin>
      <programArgsLin>--linux-only</programArgsLin>
      <programArgsMac>--mac-only</programArgsMac>
      <vmArgs>-Xmx512m -Dacme.mode="dev mode"</vmArgs>
   </launcherArgs>
   <features>
      <feature id="app.feature"/>
   </features>
   <configurations>
      <plugin id="org.eclipse.core.runtime" autoStart="true" startLevel="0" />
      <plugin id="core" autoStart="true" startLevel="3" />
   </configurations>
</product>`

const rcpLaunch = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<launchConfiguration type="org.eclipse.pde.ui.RuntimeWorkbench">
<stringAttribute key="application" value="app.application"/>
<booleanAttribute key="useProduct" value="false"/>
<booleanAttribute key="useDefaultConfig" value="false"/>
<stringAttribute key="org.eclipse.jdt.launching.VM_ARGUMENTS" value="-Xms64m"/>
<stringAttribute key="org.eclipse.jdt.launching.PROGRAM_ARGUMENTS" value="-os win32 -consoleLog"/>
<setAttribute key="selected_workspace_bundles"><setEntry value="app@default:default"/><setEntry value="core@2:true"/></setAttribute>
<setAttribute key="selected_target_bundles"><setEntry value="org.eclipse.swt*3.102@default:default"/></setAttribute>
</launchConfiguration>`

func TestProductLaunchStartsTheApplicationWithItsFeaturesAndArguments(t *testing.T) {
	root, target := keplerWorkspace(t)
	writeText(t, filepath.Join(root, "app", "acme.product"), rcpProduct)
	writeText(t, filepath.Join(root, "app.feature", ".project"), `<projectDescription><name>app.feature</name><natures><nature>org.eclipse.pde.FeatureNature</nature></natures></projectDescription>`)
	writeText(t, filepath.Join(root, "app.feature", "feature.xml"), `<feature id="app.feature" version="1.0.0"><includes id="platform.feature"/><plugin id="app"/></feature>`)
	writeText(t, filepath.Join(target, "features", "platform.feature_1.0.0", "feature.xml"), `<feature id="platform.feature"><plugin id="unrelated"/><plugin id="gone.bundle"/></feature>`)
	writeJar(t, filepath.Join(target, "plugins", "org.eclipse.core.runtime_3.9.jar"), bundleManifest("org.eclipse.core.runtime"))
	if _, err := ReindexReport(root); err != nil {
		t.Fatal(err)
	}
	writeText(t, filepath.Join(root, "app", "bin", "App.class"), "x")
	writeText(t, filepath.Join(root, "core", "bin", "Core.class"), "x")

	launches, err := ListAppLaunches(root)
	if err != nil || len(launches) != 1 || launches[0].File != "app/acme.product" || launches[0].Product != "app.product" {
		t.Fatalf("launches = %+v %v", launches, err)
	}
	launch, err := PrepareAppLaunch(root, LaunchJVM{Major: 8}, "app/acme.product")
	if err != nil {
		t.Fatal(err)
	}
	arguments := strings.Join(launch.Arguments, " ")
	for _, want := range []string{"-Xmx512m", "-Dacme.mode=dev mode", "-product app.product", "-clearPersistedState", "-data "} {
		if !strings.Contains(arguments, want) && !slices.Contains(launch.Arguments, want) {
			t.Fatalf("missing %q in %v", want, launch.Arguments)
		}
	}
	if slices.Contains(launch.Arguments, "-Declipse.ignoreApp=true") || !slices.Contains(launch.Arguments, "-Dosgi.noShutdown=false") {
		t.Fatalf("an application launch must run the application and end with it: %v", launch.Arguments)
	}
	if slices.Contains(launch.Arguments, "-console") {
		t.Fatal("a console would keep the JVM of an application alive")
	}
	if !slices.Contains(launch.Arguments, osSpecificArgument()) {
		t.Fatalf("the arguments of this OS are missing: %v", launch.Arguments)
	}
	config, err := os.ReadFile(filepath.Join(root, ".adomnia", "osgi", "acme", "configuration", "config.ini"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(config)
	for _, want := range []string{"unrelated", "core_", "eclipse.product=app.product", "eclipse.application=app.application"} {
		if !strings.Contains(text, want) && !strings.Contains(text, strings.TrimSuffix(want, "_")) {
			t.Fatalf("config.ini misses %q:\n%s", want, text)
		}
	}
	if !strings.Contains(text, "core/@3\\:start") && !strings.Contains(text, "core@3\\:start") {
		t.Fatalf("the product start level of core is not applied:\n%s", text)
	}
	if !hasProblem(launch.Problems, "gone.bundle") {
		t.Fatalf("a feature plug-in missing from the target must be reported: %+v", launch.Problems)
	}
}

func osSpecificArgument() string {
	return map[string]string{"win32": "--win-only", "linux": "--linux-only", "macosx": "--mac-only"}[p2Environment(false)["osgi.os"]]
}

func TestLaunchConfigurationReadsTheSelectedBundles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Acme App.launch")
	writeText(t, path, rcpLaunch)
	launch, err := ReadAppLaunch(path)
	if err != nil || launch == nil {
		t.Fatalf("%+v %v", launch, err)
	}
	if launch.Application != "app.application" || launch.Product != "" || strings.Join(launch.Plugins, ",") != "app,core,org.eclipse.swt" {
		t.Fatalf("launch = %+v", launch)
	}
	if launch.StartLevels["core"] != "@2:start" || launch.StartLevels["app"] != "" {
		t.Fatalf("start levels = %v", launch.StartLevels)
	}
	if strings.Join(launch.ProgramArguments, " ") != "-os win32 -consoleLog" || launch.VMArguments[0] != "-Xms64m" {
		t.Fatalf("arguments = %v %v", launch.ProgramArguments, launch.VMArguments)
	}

	junit := filepath.Join(t.TempDir(), "Tests.launch")
	writeText(t, junit, `<launchConfiguration type="org.eclipse.jdt.junit.launchconfig"/>`)
	if other, err := ReadAppLaunch(junit); other != nil || err != nil {
		t.Fatalf("a JUnit launch is not an application: %+v %v", other, err)
	}
}

func TestSplitArgumentsKeepsQuotedGroups(t *testing.T) {
	got := splitArguments(` -a  "b c" -Dx="y z"` + "\n-d")
	if strings.Join(got, "|") != "-a|b c|-Dx=y z|-d" {
		t.Fatalf("%q", got)
	}
}
