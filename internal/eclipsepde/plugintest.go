package eclipsepde

import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

// JUnit Plug-in Tests run inside the OSGi framework, like PDE's "JUnit Plug-in Test" launch: Equinox
// starts the test bundle and what it requires, the PDE test application loads the classes through the
// bundle's class loader, and Eclipse's RemoteTestRunner reports every test on a TCP port.

const (
	coreTestApplication = "org.eclipse.pde.junit.runtime.coretestapplication"
	junit4TestLoader    = "org.eclipse.jdt.internal.junit4.runner.JUnit4TestLoader"
	junit4LoaderBundle  = "org.eclipse.jdt.junit4.runtime"
	// remoteTestProtocol is the RemoteTestRunner protocol version written in UTF-8.
	remoteTestProtocol = "3"
)

// pluginTestRuntime are the bundles the test application needs: an Eclipse SDK target has them.
var pluginTestRuntime = []string{"org.eclipse.pde.junit.runtime", "org.eclipse.jdt.junit.runtime", junit4LoaderBundle, "org.junit"}

// PluginTestClass is a test class of a workspace bundle.
type PluginTestClass struct {
	// Bundle is the symbolic name of the bundle that holds the class; TestPlugin is the bundle whose
	// class loader loads it: the bundle itself, or the host of a test fragment.
	Bundle     string
	TestPlugin string
	Class      string
	// Dir is the bundle's project folder.
	Dir string
}

// PluginTestClassOf finds the workspace bundle of a test source (absolute, or relative to root) and the
// class it declares, from the bundle's source folders.
func PluginTestClassOf(root, file string) (PluginTestClass, error) {
	ws, err := ImportWorkspace(root)
	if err != nil {
		return PluginTestClass{}, err
	}
	absolute := file
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Join(ws.Root, filepath.FromSlash(file))
	}
	for _, project := range ws.Bundles() {
		for _, folder := range project.sourceFolders() {
			relative, within := relativeWithin(folder, absolute)
			if !within || !strings.HasSuffix(relative, ".java") {
				continue
			}
			test := PluginTestClass{
				Bundle: project.Bundle.SymbolicName, TestPlugin: project.Bundle.SymbolicName, Dir: project.Dir,
				Class: strings.ReplaceAll(strings.TrimSuffix(filepath.ToSlash(relative), ".java"), "/", "."),
			}
			if host := project.Bundle.FragmentHost; host != nil {
				test.TestPlugin = host.Name
			}
			return test, nil
		}
	}
	return PluginTestClass{}, fmt.Errorf("%s is not in a source folder of a workspace bundle", filepath.ToSlash(file))
}

// PluginTest is what to run: test classes of one bundle, or one method of one class.
type PluginTest struct {
	Bundle     string
	TestPlugin string
	Classes    []string
	// Method runs a single test of the only class.
	Method string
	// Port is where adOmnia listens for the RemoteTestRunner reports.
	Port int
}

// PreparePluginTest writes the Equinox configuration of a JUnit Plug-in Test and returns its command:
// the test bundle, the PDE test runtime and everything they require, started headless.
func PreparePluginTest(root string, jvm LaunchJVM, test PluginTest) (*Launch, error) {
	if test.Port <= 0 || len(test.Classes) == 0 || test.Bundle == "" {
		return nil, errors.New("a plug-in test needs a bundle, its test classes and a report port")
	}
	if test.Method != "" && len(test.Classes) != 1 {
		return nil, errors.New("a test method belongs to exactly one class")
	}
	_, target, err := openWorkspaceTarget(root)
	if err != nil {
		return nil, err
	}
	var missing []string
	for _, name := range pluginTestRuntime {
		if len(target.ByName(name)) == 0 {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("the target platform has no %s: JUnit Plug-in Tests need an Eclipse SDK target (with PDE and JDT)", strings.Join(missing, ", "))
	}
	app := &AppLaunch{
		Name: "junit-" + test.Bundle, Kind: "launch", Application: coreTestApplication,
		Plugins:          append([]string{test.Bundle}, pluginTestRuntime...),
		ProgramArguments: pluginTestArguments(test),
		StartLevels:      map[string]string{},
	}
	if test.TestPlugin != "" && test.TestPlugin != test.Bundle {
		app.Plugins = append(app.Plugins, test.TestPlugin)
	}
	return prepareLaunch(root, jvm, 0, app)
}

// pluginTestArguments are the RemoteTestRunner options PDE passes to the test application.
func pluginTestArguments(test PluginTest) []string {
	plugin := test.TestPlugin
	if plugin == "" {
		plugin = test.Bundle
	}
	arguments := []string{
		"-version", remoteTestProtocol, "-port", strconv.Itoa(test.Port),
		"-testLoaderClass", junit4TestLoader, "-loaderpluginname", junit4LoaderBundle,
		"-testpluginname", plugin,
	}
	if test.Method != "" {
		return append(arguments, "-test", test.Classes[0]+":"+test.Method)
	}
	return append(append(arguments, "-classNames"), test.Classes...)
}
