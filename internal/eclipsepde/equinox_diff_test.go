package eclipsepde

import (
	"bufio"
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The differential test runs the same bundles through Equinox 3.9 (Kepler), the
// resolver PDE uses for the target platform, and through the Go resolver, and
// compares every bundle's state and wiring. It is opt-in because it needs a JDK
// and the Kepler framework jar: ADOMNIA_TEST_EQUINOX=<path to org.eclipse.osgi_3.9.x.jar>.

// equinoxBundle is what Equinox said about one bundle.
type equinoxBundle struct {
	label    string
	resolved bool
	errors   []string
	wires    []string // "Kind name -> provider version"
}

func requireEquinox(t *testing.T) (osgiJar, classes string) {
	t.Helper()
	osgiJar = os.Getenv("ADOMNIA_TEST_EQUINOX")
	if osgiJar == "" {
		t.Skip("ADOMNIA_TEST_EQUINOX is not set: point it to org.eclipse.osgi_3.9.x.jar (Kepler) to compare with Equinox")
	}
	classes = t.TempDir()
	compile := exec.Command("javac", "-nowarn", "--release", "8", "-cp", osgiJar, "-d", classes, filepath.Join("testdata", "equinox", "EquinoxResolve.java"))
	if output, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("javac: %v\n%s", err, output)
	}
	return osgiJar, classes
}

// runEquinox resolves the bundles in Equinox and returns its view, by location.
func runEquinox(t *testing.T, osgiJar, classes, environment, mode string, locations []string) map[string]*equinoxBundle {
	t.Helper()
	arguments := append([]string{"-cp", classes + string(os.PathListSeparator) + osgiJar, "EquinoxResolve", osgiJar, environment, mode}, locations...)
	command := exec.Command("java", arguments...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		t.Fatalf("equinox: %v\n%s", err, stderr.String())
	}
	labels := map[string]string{}
	result := map[string]*equinoxBundle{}
	scanner := bufio.NewScanner(bytes.NewReader(output))
	scanner.Buffer(make([]byte, 1<<20), 1<<20)
	var wires [][]string
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), "\t")
		switch fields[0] {
		case "B":
			label := fields[2] + " " + fields[3]
			labels[fields[1]] = label
			result[fields[1]] = &equinoxBundle{label: label, resolved: fields[4] == "true"}
		case "E":
			result[fields[1]].errors = append(result[fields[1]].errors, fields[2])
		case "W":
			wires = append(wires, fields)
		}
	}
	for _, wire := range wires {
		result[wire[1]].wires = append(result[wire[1]].wires, wire[2]+" "+wire[3]+" -> "+labels[wire[4]])
	}
	return result
}

// goBundle is what the Go resolver said about one bundle.
type goBundle struct {
	resolved bool
	missing  []string
	wires    map[string]string // "Kind name" -> provider label
}

func runGo(t *testing.T, environment string, locations []string) map[string]*goBundle {
	t.Helper()
	index := NewBundleIndex()
	for _, location := range locations {
		if strings.HasSuffix(location, ".jar") {
			index.indexJarBundle(location)
		} else {
			index.indexExplodedBundle(location)
		}
	}
	if len(index.Problems) > 0 {
		t.Fatalf("index problems: %+v", index.Problems)
	}
	result := map[string]*goBundle{}
	for _, entry := range index.All() {
		resolver := NewResolver(index)
		resolver.ExecutionEnvironment = environment
		resolution := resolver.Resolve(entry).Root
		bundle := &goBundle{resolved: resolution.Status != StatusUnresolved, wires: map[string]string{}}
		for _, missing := range resolution.Missing {
			bundle.missing = append(bundle.missing, missing.Requirement.String())
		}
		for _, wire := range resolution.Wires {
			name := wire.Name
			if wire.Kind == "Require-Bundle" {
				name = wire.Provider // Equinox names a required bundle by its supplier (system.bundle → org.eclipse.osgi)
			}
			bundle.wires[wire.Kind+" "+name] = wire.Provider + " " + wire.ProviderVersion
		}
		result[entry.Bundle.Location] = bundle
	}
	return result
}

// compareResolvers returns one line per disagreement, sorted. Equinox reports the
// imports of attached fragments on the host; Go keeps them on the fragment, so a
// host wire is also looked up in its fragments.
func compareResolvers(equinox map[string]*equinoxBundle, golang map[string]*goBundle) []string {
	fragments := map[string][]string{} // host label -> fragment locations
	for location, bundle := range equinox {
		for _, wire := range bundle.wires {
			if host, ok := strings.CutPrefix(wire, "Fragment-Host "); ok {
				_, hostLabel, _ := strings.Cut(host, " -> ")
				fragments[hostLabel] = append(fragments[hostLabel], location)
			}
		}
	}
	var differences []string
	for location, eq := range equinox {
		g, ok := golang[location]
		if !ok {
			differences = append(differences, eq.label+": unknown to Go")
			continue
		}
		if eq.resolved != g.resolved {
			differences = append(differences, eq.label+": equinox resolved="+boolText(eq.resolved)+" go resolved="+boolText(g.resolved)+
				" (equinox: "+strings.Join(eq.errors, "; ")+" | go missing: "+strings.Join(g.missing, "; ")+")")
			continue
		}
		if !eq.resolved {
			continue
		}
		for _, wire := range eq.wires {
			requirement, provider, _ := strings.Cut(wire, " -> ")
			kind, name, _ := strings.Cut(requirement, " ")
			if kind == "Fragment-Host" {
				continue // the host edge has no choice once the fragment resolves
			}
			chosen, wired := g.wires[requirement]
			for _, fragment := range fragments[eq.label] {
				if wired {
					break
				}
				if other, ok := golang[fragment]; ok {
					chosen, wired = other.wires[requirement]
				}
			}
			if !wired && kind == "Import-Package" && providedByJRE(name) {
				continue // Go treats JRE packages as always present instead of wiring them to the framework
			}
			if chosen != provider {
				differences = append(differences, eq.label+": "+requirement+" equinox -> "+provider+", go -> "+orNone(chosen))
			}
		}
	}
	sort.Strings(differences)
	return differences
}

func boolText(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func orNone(value string) string {
	if value == "" {
		return "(none)"
	}
	return value
}

// equinoxScenario writes each manifest as an exploded bundle and returns their
// locations, the Kepler framework first (it is the system bundle).
func equinoxScenario(t *testing.T, osgiJar string, manifests map[string]string) []string {
	t.Helper()
	root := t.TempDir()
	locations := []string{osgiJar}
	names := make([]string, 0, len(manifests))
	for name := range manifests {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		directory := filepath.Join(root, name)
		writeText(t, filepath.Join(directory, "META-INF", "MANIFEST.MF"), "Manifest-Version: 1.0\nBundle-ManifestVersion: 2\n"+manifests[name])
		locations = append(locations, directory)
	}
	return locations
}

var equinoxScenarios = []struct {
	name      string
	manifests map[string]string
}{
	{"transitive failure", map[string]string{
		"app": "Bundle-SymbolicName: app\nBundle-Version: 1.0.0\nRequire-Bundle: lib\n",
		"lib": "Bundle-SymbolicName: lib\nBundle-Version: 1.0.0\nImport-Package: missing.pkg\n",
		"use": "Bundle-SymbolicName: use\nBundle-Version: 1.0.0\nImport-Package: lib.api\n",
		"exp": "Bundle-SymbolicName: exp\nBundle-Version: 1.0.0\nExport-Package: lib.api\nRequire-Bundle: lib\n",
	}},
	{"newest exporter in range", map[string]string{
		"p1":  "Bundle-SymbolicName: p1\nBundle-Version: 1.0.0\nExport-Package: x;version=\"1.0\"\n",
		"p2":  "Bundle-SymbolicName: p2\nBundle-Version: 1.0.0\nExport-Package: x;version=\"2.0\"\n",
		"any": "Bundle-SymbolicName: any\nBundle-Version: 1.0.0\nImport-Package: x;version=\"[1,3)\"\n",
		"old": "Bundle-SymbolicName: old\nBundle-Version: 1.0.0\nImport-Package: x;version=\"[1,2)\"\n",
	}},
	{"multiple bundle versions", map[string]string{
		"lib1": "Bundle-SymbolicName: lib\nBundle-Version: 1.0.0\n",
		"lib2": "Bundle-SymbolicName: lib\nBundle-Version: 2.0.0\n",
		"old":  "Bundle-SymbolicName: old\nBundle-Version: 1.0.0\nRequire-Bundle: lib;bundle-version=\"[1,2)\"\n",
		"new":  "Bundle-SymbolicName: new\nBundle-Version: 1.0.0\nRequire-Bundle: lib\n",
	}},
	{"singleton versions", map[string]string{
		"s1":  "Bundle-SymbolicName: s;singleton:=true\nBundle-Version: 1.0.0\n",
		"s2":  "Bundle-SymbolicName: s;singleton:=true\nBundle-Version: 2.0.0\n",
		"old": "Bundle-SymbolicName: old\nBundle-Version: 1.0.0\nRequire-Bundle: s;bundle-version=\"[1,2)\"\n",
		"new": "Bundle-SymbolicName: new\nBundle-Version: 1.0.0\nRequire-Bundle: s\n",
	}},
	{"uses constraint", map[string]string{
		"q1":  "Bundle-SymbolicName: q1\nBundle-Version: 1.0.0\nExport-Package: q;version=\"1.0\"\n",
		"q2":  "Bundle-SymbolicName: q2\nBundle-Version: 1.0.0\nExport-Package: q;version=\"2.0\"\n",
		"a":   "Bundle-SymbolicName: a\nBundle-Version: 1.0.0\nExport-Package: p;uses:=\"q\"\nImport-Package: q;version=\"[1,2)\"\n",
		"app": "Bundle-SymbolicName: app\nBundle-Version: 1.0.0\nImport-Package: p,q;version=\"[2,3)\"\n",
	}},
	{"fragment exports", map[string]string{
		"host": "Bundle-SymbolicName: host\nBundle-Version: 1.0.0\n",
		"frag": "Bundle-SymbolicName: frag\nBundle-Version: 1.0.0\nFragment-Host: host\nExport-Package: frag.api\n",
		"app":  "Bundle-SymbolicName: app\nBundle-Version: 1.0.0\nImport-Package: frag.api\n",
		"lost": "Bundle-SymbolicName: lost\nBundle-Version: 1.0.0\nFragment-Host: nohost\n",
	}},
	{"optional and system bundle", map[string]string{
		"app": "Bundle-SymbolicName: app\nBundle-Version: 1.0.0\nRequire-Bundle: system.bundle\nImport-Package: javax.swing,org.osgi.framework,org.w3c.dom,never.there;resolution:=optional\n",
	}},
	{"execution environment", map[string]string{
		"java7": "Bundle-SymbolicName: java7\nBundle-Version: 1.0.0\nBundle-RequiredExecutionEnvironment: JavaSE-1.7\n",
		"java6": "Bundle-SymbolicName: java6\nBundle-Version: 1.0.0\nBundle-RequiredExecutionEnvironment: JavaSE-1.6\n",
		"user":  "Bundle-SymbolicName: user\nBundle-Version: 1.0.0\nRequire-Bundle: java7\n",
	}},
	{"cycle", map[string]string{
		"a": "Bundle-SymbolicName: a\nBundle-Version: 1.0.0\nRequire-Bundle: b\nExport-Package: a.api\n",
		"b": "Bundle-SymbolicName: b\nBundle-Version: 1.0.0\nImport-Package: a.api\n",
	}},
	{"import attributes", map[string]string{
		"p1":   "Bundle-SymbolicName: p1\nBundle-Version: 1.0.0\nExport-Package: x;version=\"1.0\"\n",
		"p2":   "Bundle-SymbolicName: p2\nBundle-Version: 1.0.0\nExport-Package: x;version=\"2.0\"\n",
		"pick": "Bundle-SymbolicName: pick\nBundle-Version: 1.0.0\nImport-Package: x;bundle-symbolic-name=p1\n",
	}},
	{"java package from a bundle", map[string]string{
		"servlet": "Bundle-SymbolicName: servlet\nBundle-Version: 1.0.0\nExport-Package: javax.servlet;version=\"2.5\"\n",
		"web":     "Bundle-SymbolicName: web\nBundle-Version: 1.0.0\nImport-Package: javax.servlet;version=\"[2.5,3)\",javax.inject\n",
	}},
}

func TestGoResolverAgreesWithEquinoxKepler(t *testing.T) {
	osgiJar, classes := requireEquinox(t)
	for _, scenario := range equinoxScenarios {
		t.Run(scenario.name, func(t *testing.T) {
			locations := equinoxScenario(t, osgiJar, scenario.manifests)
			equinox := runEquinox(t, osgiJar, classes, "JavaSE-1.6", "development", locations)
			if differences := compareResolvers(equinox, runGo(t, "JavaSE-1.6", locations)); len(differences) > 0 {
				t.Errorf("Go and Equinox disagree:\n%s", strings.Join(differences, "\n"))
			}
		})
	}
}

// knownRuntimeDifferences are where Equinox at runtime (production mode) is
// stricter than PDE: a bundle whose dependency does not resolve, the singleton
// that loses the selection and a uses conflict. The Go resolver follows PDE and
// reports the first two as warnings ("via …"); uses conflicts are not computed.
var knownRuntimeDifferences = []string{
	"execution environment | user 1.0.0",
	"singleton versions | old 1.0.0",
	"singleton versions | s 1.0.0",
	"transitive failure | app 1.0.0",
	"transitive failure | exp 1.0.0",
	"transitive failure | use 1.0.0",
	"uses constraint | app 1.0.0",
}

func TestRuntimeDifferencesWithEquinoxAreKnown(t *testing.T) {
	osgiJar, classes := requireEquinox(t)
	var found []string
	for _, scenario := range equinoxScenarios {
		locations := equinoxScenario(t, osgiJar, scenario.manifests)
		for _, line := range compareResolvers(runEquinox(t, osgiJar, classes, "JavaSE-1.6", "production", locations), runGo(t, "JavaSE-1.6", locations)) {
			bundle, _, _ := strings.Cut(line, ":")
			found = append(found, scenario.name+" | "+bundle)
		}
	}
	sort.Strings(found)
	if strings.Join(found, "\n") != strings.Join(knownRuntimeDifferences, "\n") {
		t.Fatalf("runtime differences changed:\n%s", strings.Join(found, "\n"))
	}
}
