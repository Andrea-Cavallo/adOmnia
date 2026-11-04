package eclipsepde

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Java 6 code is compiled by the compiler of the target platform: the one in JDT LS
// rejects anything below 1.8. The compiler runs on the JVM of the project, so its boot
// classpath is that JVM's rt.jar and an API newer than Java 6 does not compile.
const (
	compilerBundle = "org.eclipse.jdt.core"
	compilerMain   = "org.eclipse.jdt.internal.compiler.batch.Main"
	// maxCompilerJVM is the newest JVM with an rt.jar: the Kepler compiler cannot read the modules of Java 9+.
	maxCompilerJVM   = 8
	defaultJavaLevel = 6
	lowestJavaLevel  = 3
)

// CompileStep is one compiler run: bundles compile one at a time, because each one
// sees only what its manifest requires, as in PDE.
type CompileStep struct {
	Bundle      string
	Directory   string
	Arguments   []string
	Sources     []string
	Output      string
	Environment string
}

// BuildPlan is the ordered list of compiler runs of a workspace, dependencies first.
type BuildPlan struct {
	Steps    []CompileStep
	Problems []Problem
	// Skipped are the bundles left out because they cannot compile.
	Skipped []Problem
}

// openWorkspaceTarget reads the workspace and the index of its active target.
func openWorkspaceTarget(root string) (*Workspace, *BundleIndex, error) {
	ws, err := ImportWorkspace(root)
	if err != nil {
		return nil, nil, err
	}
	settings, err := LoadTargetSettings(ws.Root)
	if err != nil {
		return nil, nil, err
	}
	platform := NewTargetPlatform()
	platform.LoadFromSettings(absoluteProfiles(settings, ws.Root))
	if _, ok := platform.ActiveProfile(); !ok {
		return nil, nil, errors.New("choose a target platform first: Java > OSGi Bundles & Target Platform")
	}
	index, err := platform.Index()
	if err != nil {
		return nil, nil, err
	}
	return ws, index, nil
}

// HasBundles reports whether the folder holds OSGi bundles.
func HasBundles(root string) bool {
	ws, err := ImportWorkspace(root)
	return err == nil && len(ws.Bundles()) > 0
}

// RequiredEnvironment is the highest execution environment the bundles of the folder compile for, "" if none.
func RequiredEnvironment(root string) string {
	ws, err := ImportWorkspace(root)
	if err != nil {
		return ""
	}
	highest, highestLevel := "", -1
	for _, project := range ws.Bundles() {
		environment := firstEnvironment(project.Bundle.ExecutionEnvironment)
		if level, ok := executionEnvironmentLevel(environment); ok && level > highestLevel {
			highest, highestLevel = environment, level
		}
	}
	return highest
}

// EnvironmentLevel is the Java version of an execution environment: JavaSE-1.6 is 6.
func EnvironmentLevel(environment string) (int, bool) {
	return executionEnvironmentLevel(environment)
}

// firstEnvironment is the compile level of a Bundle-RequiredExecutionEnvironment list: PDE uses the first entry.
func firstEnvironment(list string) string {
	first, _, _ := strings.Cut(list, ",")
	return strings.TrimSpace(first)
}

// PlanBuild computes the compiler runs of every bundle with sources, for the JVM of the given major version.
func PlanBuild(root string, jvmMajor int) (*BuildPlan, error) {
	if jvmMajor > maxCompilerJVM {
		return nil, fmt.Errorf("the Eclipse compiler of this target needs a JVM up to Java %d, the project uses Java %d: Java > Select JDK", maxCompilerJVM, jvmMajor)
	}
	ws, target, err := openWorkspaceTarget(root)
	if err != nil {
		return nil, err
	}
	compiler, _, ok := target.BestMatch(compilerBundle, VersionRange{}, false)
	if !ok {
		return nil, fmt.Errorf("the target platform has no %s, which holds the Eclipse compiler: choose an Eclipse installation as target", compilerBundle)
	}
	resolver := NewResolver(withWorkspace(target, ws))
	plan := &BuildPlan{Problems: append([]Problem{}, ws.AllProblems()...)}
	byName := map[string]*EclipseProject{}
	for _, project := range ws.Bundles() {
		byName[project.Bundle.SymbolicName] = project
	}
	dependencies := map[string][]string{}
	classpaths := map[string][]string{}
	blocked := map[string]string{} // project name -> what it misses
	for _, project := range ws.Bundles() {
		elements, problems := resolver.BuildClasspath(project)
		plan.Problems = append(plan.Problems, problems...)
		for _, problem := range problems {
			if problem.Severity == "error" {
				blocked[project.Name] = "its required dependencies are missing from the target"
			}
		}
		classpath, depends, err := compileClasspath(project, elements, byName)
		if err != nil {
			return nil, err
		}
		classpaths[project.Name], dependencies[project.Name] = classpath, depends
	}
	for _, project := range dependencyOrder(ws.Bundles(), dependencies, plan) {
		// Compiling without its dependencies gives thousands of errors that all say the same thing.
		for _, dependency := range dependencies[project.Name] {
			if _, missing := blocked[dependency]; missing && blocked[project.Name] == "" {
				blocked[project.Name] = "it depends on " + dependency + ", which is not compiled"
			}
		}
		sources := project.sourceFolders()
		if len(sources) == 0 {
			continue // a binary bundle: nothing to compile
		}
		if reason := blocked[project.Name]; reason != "" {
			plan.Skipped = append(plan.Skipped, Problem{Severity: "error", Project: project.Name, Message: "not compiled: " + reason})
			continue
		}
		output, err := project.outputFolder()
		if err != nil {
			return nil, err
		}
		environment := firstEnvironment(project.Bundle.ExecutionEnvironment)
		level, err := compileLevel(project.Bundle.SymbolicName, environment, jvmMajor)
		if err != nil {
			return nil, err
		}
		plan.Steps = append(plan.Steps, CompileStep{
			Bundle: project.Bundle.SymbolicName, Directory: project.Dir, Sources: sources, Output: output, Environment: environment,
			Arguments: compilerArguments(compiler.Bundle.Location, level, project, classpaths[project.Name], output, sources),
		})
	}
	return plan, nil
}

// compileLevel is the Java level of the compiler flag: the environment of the bundle, or the JVM's without one.
func compileLevel(bundle, environment string, jvmMajor int) (int, error) {
	level, ok := executionEnvironmentLevel(environment)
	switch {
	case !ok && jvmMajor > 0:
		return jvmMajor, nil
	case !ok:
		return defaultJavaLevel, nil
	case jvmMajor > 0 && level > jvmMajor:
		return 0, fmt.Errorf("%s requires %s, the project JVM is Java %d: Java > Select JDK", bundle, environment, jvmMajor)
	}
	return max(level, lowestJavaLevel), nil
}

// ponytail: the classpath goes on the command line; Windows allows 32k characters, about
// 300 jars. Use the compiler's @file argument when a bundle reaches that.
func compilerArguments(compilerJar string, level int, project *EclipseProject, classpath []string, output string, sources []string) []string {
	arguments := []string{"-cp", compilerJar, compilerMain, "-1." + strconv.Itoa(level), "-g", "-nowarn", "-proceedOnError"}
	if encoding := project.BuildProperties["javacDefaultEncoding.."]; encoding != "" {
		arguments = append(arguments, "-encoding", encoding)
	}
	if len(classpath) > 0 {
		arguments = append(arguments, "-classpath", strings.Join(classpath, string(os.PathListSeparator)))
	}
	arguments = append(arguments, "-d", output)
	return append(arguments, sources...)
}

// compileClasspath turns the PDE classpath into paths and lists the workspace bundles it depends on.
func compileClasspath(project *EclipseProject, elements []ClasspathElement, byName map[string]*EclipseProject) (classpath, depends []string, err error) {
	add := func(path string) {
		if fileExists(path) && !slices.Contains(classpath, path) {
			classpath = append(classpath, path)
		}
	}
	for _, library := range project.libraries() {
		add(library)
	}
	for _, element := range elements {
		if element.Kind != "project" {
			// ponytail: a jar nested in a packed bundle is not extracted, so it is left out.
			// Exploded bundles work; extract it when a real target needs one.
			add(element.Path)
			continue
		}
		dependency, ok := byName[element.Path]
		if !ok || dependency == project {
			continue
		}
		depends = append(depends, dependency.Name)
		output, err := dependency.outputFolder()
		if err != nil {
			return nil, nil, err
		}
		classpath = append(classpath, output)
		for _, library := range dependency.libraries() {
			add(library)
		}
	}
	return classpath, depends, nil
}

// dependencyOrder sorts the projects so each one follows the bundles it compiles against.
func dependencyOrder(projects []*EclipseProject, dependencies map[string][]string, plan *BuildPlan) []*EclipseProject {
	byName := map[string]*EclipseProject{}
	for _, project := range projects {
		byName[project.Name] = project
	}
	var ordered []*EclipseProject
	state := map[string]int{} // 1 = being visited, 2 = done
	var visit func(project *EclipseProject)
	visit = func(project *EclipseProject) {
		state[project.Name] = 1
		for _, name := range dependencies[project.Name] {
			switch state[name] {
			case 0:
				visit(byName[name])
			case 1:
				plan.Problems = append(plan.Problems, Problem{Severity: "warning", Project: project.Name, Message: "dependency cycle with " + name + ": build again if it reports missing classes"})
			}
		}
		state[project.Name] = 2
		ordered = append(ordered, project)
	}
	for _, project := range projects {
		if state[project.Name] == 0 {
			visit(project)
		}
	}
	return ordered
}

// sourceFolders are the source folders of .classpath, or source.. of build.properties.
// A folder outside the project (a /other-project reference, ../x) is not compiled.
func (p *EclipseProject) sourceFolders() []string {
	var relative []string
	for _, entry := range p.ClasspathEntries {
		if entry.Kind == "src" && !strings.HasPrefix(entry.Path, "/") {
			relative = append(relative, entry.Path)
		}
	}
	if declared := p.BuildProperties["source.."]; len(relative) == 0 && declared != "" {
		relative = strings.Split(declared, ",")
	}
	var folders []string
	for _, folder := range relative {
		path := filepath.Join(p.Dir, filepath.FromSlash(strings.TrimSpace(folder)))
		if _, within := relativeWithin(p.Dir, path); within && fileExists(path) {
			folders = append(folders, path)
		}
	}
	return folders
}

// outputFolder is where the classes go, the same folder Eclipse uses. It must stay in the project:
// the value comes from a project file and the build writes there.
func (p *EclipseProject) outputFolder() (string, error) {
	relative := "bin"
	if value := strings.TrimSpace(p.BuildProperties["output.."]); value != "" {
		relative = value
	}
	for _, entry := range p.ClasspathEntries {
		if entry.Kind == "output" && entry.Path != "" {
			relative = entry.Path
		}
	}
	path := filepath.Join(p.Dir, filepath.FromSlash(relative))
	if rel, within := relativeWithin(p.Dir, path); !within || rel == "." {
		return "", fmt.Errorf("%s: output folder %q must be a folder inside the project", p.Name, relative)
	}
	return path, nil
}

// libraries are the jars of the project itself: Bundle-ClassPath and .classpath lib entries.
func (p *EclipseProject) libraries() []string {
	var libraries []string
	if p.Bundle != nil {
		for _, entry := range p.Bundle.BundleClassPath {
			if entry != "." {
				libraries = append(libraries, filepath.Join(p.Dir, filepath.FromSlash(entry)))
			}
		}
	}
	for _, entry := range p.ClasspathEntries {
		if entry.Kind == "lib" && !isAbsoluteOnAnyOS(entry.Path) {
			libraries = append(libraries, filepath.Join(p.Dir, filepath.FromSlash(entry.Path)))
		}
	}
	return libraries
}

// Prepare creates the output folder and copies the source resources there: the compiler handles .java files only.
func (step CompileStep) Prepare() error {
	if err := os.MkdirAll(step.Output, 0o755); err != nil {
		return fmt.Errorf("%s: cannot create the output folder: %w", step.Bundle, err)
	}
	for _, source := range step.Sources {
		if err := copyResources(source, step.Output); err != nil {
			return fmt.Errorf("%s: cannot copy the resources: %w", step.Bundle, err)
		}
	}
	return nil
}

// copyResources writes through os.Root: a link inside the output folder must not lead the
// build outside it, and a link among the sources is not copied, so it cannot bring in files
// from elsewhere.
func copyResources(source, output string) error {
	root, err := os.OpenRoot(output)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }() // only directory handles: every write already reported its error
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if path != source && (path == output || strings.HasPrefix(entry.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() || strings.EqualFold(filepath.Ext(path), ".java") || strings.HasPrefix(entry.Name(), ".") {
			return nil
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if err := root.MkdirAll(filepath.Dir(relative), 0o755); err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return root.WriteFile(relative, data, 0o644)
	})
}

// BytecodeProblems lists the classes of the output folder above the level of the bundle:
// old classes left by another compiler are the usual cause of an UnsupportedClassVersionError.
func (step CompileStep) BytecodeProblems() []string {
	if _, known := MaxClassVersion(step.Environment); !known {
		return nil
	}
	problems, err := CheckBytecodeLevel(step.Output, step.Environment)
	if err != nil {
		return []string{step.Bundle + ": " + err.Error()}
	}
	messages := make([]string, 0, len(problems))
	for _, problem := range problems {
		messages = append(messages, step.Bundle+": "+problem.String())
	}
	return messages
}

// ecjProblemHeader matches the first line of a problem: `1. ERROR in C:\a\Foo.java (at line 3)`.
var ecjProblemHeader = regexp.MustCompile(`^\d+\. (ERROR|WARNING|INFO) in (.+) \(at line (\d+)\)$`)

// EcjDiagnostics returns a line parser for the compiler output. A problem spans several lines:
// the header, the source and the caret, indented with a tab, then the message. The column stays 1:
// the compiler prints the source line trimmed, so the caret does not give the real column.
func EcjDiagnostics() func(line string) (run.Diagnostic, bool) {
	severities := map[string]int{"ERROR": 1, "WARNING": 2, "INFO": 3}
	var mu sync.Mutex // the process layer reads stdout and stderr on two goroutines
	var pending *run.Diagnostic
	return func(line string) (run.Diagnostic, bool) {
		mu.Lock()
		defer mu.Unlock()
		line = strings.TrimRight(line, "\r\n")
		if match := ecjProblemHeader.FindStringSubmatch(line); match != nil {
			lineNumber, err := strconv.Atoi(match[3])
			if err != nil {
				return run.Diagnostic{}, false
			}
			pending = &run.Diagnostic{File: match[2], Line: lineNumber, Column: 1, Severity: severities[match[1]], Source: "ecj"}
			return run.Diagnostic{}, false
		}
		if pending == nil || strings.HasPrefix(line, "\t") {
			return run.Diagnostic{}, false
		}
		diagnostic := *pending
		diagnostic.Message = line
		pending = nil
		return diagnostic, true
	}
}
