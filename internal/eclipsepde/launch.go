package eclipsepde

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// launchFolder holds the generated Equinox configuration: absolute paths of this
// machine, so it stays out of Git through its own .gitignore.
const launchFolder = ".adomnia/osgi"

// autoStart is how PDE starts the platform bundles that must run for the others to work.
var autoStart = map[string]string{
	"org.eclipse.equinox.ds":        "@1:start",
	"org.eclipse.equinox.common":    "@2:start",
	"org.eclipse.core.runtime":      "@start",
	"org.eclipse.equinox.console":   "@start",
	"org.apache.felix.gogo.runtime": "@start",
	"org.apache.felix.gogo.command": "@start",
	"org.apache.felix.gogo.shell":   "@start",
}

// consoleBundles give the Equinox console: added when the target has them, so the Run input can talk to it.
var consoleBundles = []string{"org.eclipse.equinox.console", "org.apache.felix.gogo.runtime", "org.apache.felix.gogo.command", "org.apache.felix.gogo.shell"}

// Launch is what to run: `java` plus Arguments, in Directory.
type Launch struct {
	Arguments []string
	Directory string
	Problems  []Problem
}

// PrepareLaunch writes the Equinox configuration of the workspace bundles and everything they
// need from the target, the same files PDE generates, and returns the command that starts them.
func PrepareLaunch(root string, jvmMajor int) (*Launch, error) {
	if jvmMajor > maxCompilerJVM {
		return nil, fmt.Errorf("Equinox 3.9 does not start on Java %d (\"The System Bundle could not be resolved\"): choose a JVM up to Java %d in Java > Select JDK", jvmMajor, maxCompilerJVM)
	}
	ws, target, err := openWorkspaceTarget(root)
	if err != nil {
		return nil, err
	}
	framework, _, ok := target.BestMatch(equinoxFramework, VersionRange{}, false)
	if !ok || framework.Exploded {
		return nil, fmt.Errorf("the target platform has no %s jar, the Equinox framework: choose an Eclipse installation as target", equinoxFramework)
	}
	if len(ws.Bundles()) == 0 {
		return nil, errors.New("this project has no OSGi bundles to run")
	}
	devEntries, err := devClasspath(ws)
	if err != nil {
		return nil, err
	}
	bundles, problems := launchBundles(ws, target, jvmMajor)

	folder := filepath.Join(ws.Root, filepath.FromSlash(launchFolder))
	configuration := filepath.Join(folder, "configuration")
	if err := os.MkdirAll(configuration, 0o755); err != nil {
		return nil, fmt.Errorf("cannot create %s: %w", launchFolder, err)
	}
	devFile := filepath.Join(folder, "dev.properties")
	files := map[string]string{
		filepath.Join(folder, ".gitignore"): "*\n",
		devFile:                             devEntries,
		filepath.Join(configuration, "config.ini"): configIni(bundles),
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			return nil, fmt.Errorf("cannot write %s: %w", path, err)
		}
	}
	arguments := []string{
		"-Declipse.ignoreApp=true", "-Dosgi.noShutdown=true",
		"-jar", framework.Bundle.Location,
		"-configuration", configuration,
		"-dev", fileURL(devFile),
		"-clean", "-consoleLog",
	}
	if len(target.ByName(consoleBundles[0])) > 0 {
		arguments = append(arguments, "-console")
	}
	return &Launch{Arguments: arguments, Directory: ws.Root, Problems: problems}, nil
}

// devClasspath writes dev.properties: an unpacked project keeps its classes in its output
// folder, not in the bundle root, and this tells Equinox where to find them. A bundle with
// sources that was never compiled fails here, before a framework start that would hide it.
func devClasspath(ws *Workspace) (string, error) {
	lines := []string{"@ignoredot@=true"}
	for _, project := range ws.Bundles() {
		if len(project.sourceFolders()) == 0 {
			continue
		}
		output, err := project.outputFolder()
		if err != nil {
			return "", err
		}
		if !fileExists(output) {
			return "", fmt.Errorf("%s is not compiled: build the bundles first", project.Bundle.SymbolicName)
		}
		relative, _ := relativeWithin(project.Dir, output)
		lines = append(lines, escapeProperty(project.Bundle.SymbolicName)+"="+escapeProperty(relative))
	}
	return strings.Join(lines, "\n") + "\n", nil
}

// launchBundles is the closure of the workspace bundles: what they reach, the fragments for this
// platform and the optional services. The framework is excluded: it is the jar that gets launched.
func launchBundles(ws *Workspace, target *BundleIndex, jvmMajor int) ([]*IndexedBundle, []Problem) {
	merged := withWorkspace(target, ws)
	resolver := NewResolver(merged)
	if jvmMajor >= 1 && jvmMajor <= maxCompilerJVM {
		resolver.ExecutionEnvironment = "JavaSE-1." + strconv.Itoa(jvmMajor)
	}
	selected := map[string]*IndexedBundle{}
	reported := map[string]bool{}
	var problems []Problem
	var add func(entry *IndexedBundle)
	add = func(entry *IndexedBundle) {
		if selected[labelOf(entry)] != nil {
			return
		}
		for label, result := range resolver.Resolve(entry).Transitive {
			if selected[label] != nil || result.Bundle.Bundle.SymbolicName == equinoxFramework {
				continue
			}
			selected[label] = result.Bundle
			for _, missing := range result.Missing {
				if message := missing.Requirement.String(); !missing.Requirement.Optional && !reported[label+message] {
					reported[label+message] = true
					problems = append(problems, Problem{Severity: "warning", Project: result.Bundle.Bundle.SymbolicName, Message: "will not resolve at runtime: " + message})
				}
			}
			for _, fragment := range merged.PlatformFragmentsOf(result.Bundle) {
				add(fragment)
			}
		}
	}
	needsServices := false
	for _, project := range ws.Bundles() {
		if project.Bundle.MatchesThisPlatform() {
			add(&IndexedBundle{Bundle: project.Bundle, Source: SourceWorkspace, Exploded: true})
			needsServices = needsServices || project.Bundle.Manifest.Main["Service-Component"] != ""
		}
	}
	extras := consoleBundles
	if needsServices {
		extras = append([]string{"org.eclipse.equinox.ds"}, consoleBundles...)
	}
	for _, name := range extras {
		if entry, _, ok := target.BestMatch(name, VersionRange{}, false); ok {
			add(entry)
		}
	}
	bundles := make([]*IndexedBundle, 0, len(selected))
	for _, entry := range selected {
		bundles = append(bundles, entry)
	}
	sort.Slice(bundles, func(i, j int) bool { return labelOf(bundles[i]) < labelOf(bundles[j]) })
	sort.Slice(problems, func(i, j int) bool {
		return problems[i].Project+problems[i].Message < problems[j].Project+problems[j].Message
	})
	return bundles, problems
}

// startSuffix is how a bundle starts: workspace bundles and known platform services start
// on their own, fragments never (they attach to a host), everything else on demand.
func startSuffix(entry *IndexedBundle) string {
	switch {
	case entry.Bundle.FragmentHost != nil:
		return ""
	case entry.Source == SourceWorkspace:
		return "@start"
	}
	return autoStart[entry.Bundle.SymbolicName]
}

// configIni is the config.ini Equinox reads at startup.
func configIni(bundles []*IndexedBundle) string {
	references := make([]string, 0, len(bundles))
	for _, entry := range bundles {
		references = append(references, "reference:file:"+filepath.ToSlash(entry.Bundle.Location)+startSuffix(entry))
	}
	return "osgi.bundles=" + escapeProperty(strings.Join(references, ",")) + "\n" +
		"osgi.bundles.defaultStartLevel=4\n" +
		"osgi.configuration.cascaded=false\n"
}

// escapeProperty writes a value in the Java properties format: `:` and `=` escaped, ISO-8859-1 only.
func escapeProperty(value string) string {
	var out strings.Builder
	for _, char := range value {
		switch {
		case char == '\\' || char == ':' || char == '=':
			out.WriteByte('\\')
			out.WriteRune(char)
		case char > 0x7e:
			for _, unit := range utf16Units(char) {
				fmt.Fprintf(&out, `\u%04x`, unit)
			}
		default:
			out.WriteRune(char)
		}
	}
	return out.String()
}

func utf16Units(char rune) []rune {
	if char < 0x10000 {
		return []rune{char}
	}
	char -= 0x10000
	return []rune{0xd800 + (char >> 10), 0xdc00 + (char & 0x3ff)}
}

func fileURL(path string) string {
	slashed := filepath.ToSlash(path)
	if !strings.HasPrefix(slashed, "/") {
		slashed = "/" + slashed
	}
	return "file:" + slashed
}
