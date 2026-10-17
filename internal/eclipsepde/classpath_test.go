package eclipsepde

import (
	"strings"
	"testing"
)

func TestBuildClasspathResolvedDependencies(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: it.company.core\nBundle-Version: 2.1.0\n"+
			"Export-Package: it.company.core.api;version=\"2.1.0\"\n"+
			"Bundle-ClassPath: .,lib/legacy.jar\n",
		"Bundle-SymbolicName: org.slf4j\nBundle-Version: 1.6.1\nExport-Package: org.slf4j;version=\"1.6.1\"\n",
	)
	proj := projectWithBundle(t, "it.company.app",
		"Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\n"+
			"Require-Bundle: it.company.core;bundle-version=\"[2.0.0,3.0.0)\"\n"+
			"Import-Package: org.slf4j;version=\"[1.6,2.0)\"\n")

	elements, problems := NewResolver(idx).BuildClasspath(proj)
	if len(problems) != 0 {
		t.Fatalf("problems = %v", problems)
	}
	var kinds []string
	for _, e := range elements {
		kinds = append(kinds, e.Kind+":"+e.From)
	}
	got := strings.Join(kinds, ",")
	// core contributes itself + its bundle-internal lib/legacy.jar; slf4j itself.
	want := "bundle:it.company.core,library:it.company.core,bundle:org.slf4j"
	if got != want {
		t.Errorf("classpath = %s, want %s", got, want)
	}
	// The internal library points inside the bundle location.
	var lib *ClasspathElement
	for i := range elements {
		if elements[i].Kind == "library" {
			lib = &elements[i]
		}
	}
	if lib == nil || !strings.HasSuffix(strings.ReplaceAll(lib.Path, "\\", "/"), "lib/legacy.jar") {
		t.Errorf("library element = %+v", lib)
	}
}

func TestBuildClasspathWorkspaceBundleIsProjectKind(t *testing.T) {
	idx := NewBundleIndex()
	dep := projectWithBundle(t, "it.company.core", "Bundle-SymbolicName: it.company.core\nBundle-Version: 1.0.0\n")
	idx.AddWorkspaceProject(dep)
	proj := projectWithBundle(t, "it.company.app",
		"Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\nRequire-Bundle: it.company.core\n")

	elements, problems := NewResolver(idx).BuildClasspath(proj)
	if len(problems) != 0 {
		t.Fatalf("problems = %v", problems)
	}
	if len(elements) != 1 || elements[0].Kind != "project" || elements[0].Path != "it.company.core" {
		t.Errorf("elements = %+v", elements)
	}
}

func TestBuildClasspathReexportFollowsVisibility(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: it.company.mid\nBundle-Version: 1.0.0\n"+
			"Require-Bundle: it.company.base;visibility:=reexport\n",
		"Bundle-SymbolicName: it.company.base\nBundle-Version: 1.0.0\n",
		"Bundle-SymbolicName: it.company.hidden\nBundle-Version: 1.0.0\n",
	)
	proj := projectWithBundle(t, "it.company.app",
		"Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\nRequire-Bundle: it.company.mid\n")

	elements, _ := NewResolver(idx).BuildClasspath(proj)
	var froms []string
	for _, e := range elements {
		froms = append(froms, e.From)
	}
	got := strings.Join(froms, ",")
	if got != "it.company.mid,it.company.base" {
		t.Errorf("classpath = %s: reexport should pull base in, plain dependencies must not appear", got)
	}
}

func TestBuildClasspathMissingDependencyIsDiagnosed(t *testing.T) {
	idx := indexWith(t, "Bundle-SymbolicName: it.company.core\nBundle-Version: 1.5.0\n")
	proj := projectWithBundle(t, "it.company.app",
		"Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\n"+
			"Require-Bundle: it.company.core;bundle-version=\"[2.0.0,3.0.0)\"\n")

	elements, problems := NewResolver(idx).BuildClasspath(proj)
	if len(problems) != 1 {
		t.Fatalf("problems = %+v", problems)
	}
	msg := problems[0].Message
	for _, want := range []string{"it.company.core", "[2.0.0,3.0.0)", "1.5.0"} {
		if !strings.Contains(msg, want) {
			t.Errorf("problem message missing %q: %s", want, msg)
		}
	}
	if problems[0].Severity != "error" || problems[0].Project != "it.company.app" {
		t.Errorf("problem = %+v", problems[0])
	}
	if len(elements) != 0 {
		t.Errorf("elements should be empty, got %+v", elements)
	}
}

func TestBuildClasspathNonBundleFallsBackToClasspathLibs(t *testing.T) {
	proj := &EclipseProject{Name: "plain.java", ClasspathEntries: []ClasspathEntry{
		{Kind: "lib", Path: "lib/util.jar"},
		{Kind: "src", Path: "src"},
	}}
	elements, problems := NewResolver(NewBundleIndex()).BuildClasspath(proj)
	if len(problems) != 1 || !strings.Contains(problems[0].Message, "not an OSGi bundle") {
		t.Errorf("problems = %v", problems)
	}
	if len(elements) != 1 || elements[0].Path != "lib/util.jar" {
		t.Errorf("elements = %+v", elements)
	}
}

// projectWithBundle builds an in-memory project carrying a parsed manifest.
func projectWithBundle(t *testing.T, name, manifest string) *EclipseProject {
	t.Helper()
	b, err := ParseBundle([]byte(manifest), name)
	if err != nil {
		t.Fatal(err)
	}
	return &EclipseProject{Name: name, Dir: name, Bundle: b}
}
