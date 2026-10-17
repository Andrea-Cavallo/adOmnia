package eclipsepde

import (
	"strings"
	"testing"
)

func TestBuildDependencyGraph(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: it.company.core\nBundle-Version: 2.1.0\nExport-Package: it.company.core.api;version=\"2.1.0\"\n",
		"Bundle-SymbolicName: org.slf4j\nBundle-Version: 1.6.1\nExport-Package: org.slf4j;version=\"1.6.1\"\n",
	)
	root, err := ParseBundle([]byte(
		"Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\n"+
			"Require-Bundle: it.company.core;bundle-version=\"[2.0.0,3.0.0)\",\n"+
			" it.company.absent;resolution:=optional\n"+
			"Import-Package: org.slf4j;version=\"[1.6,2.0)\"\n"), "app")
	if err != nil {
		t.Fatal(err)
	}
	res := NewResolver(idx).Resolve(&IndexedBundle{Bundle: root, Source: SourceWorkspace, Exploded: true})
	g := BuildDependencyGraph(res)

	if len(g.Nodes) != 3 {
		t.Fatalf("nodes = %+v", g.Nodes)
	}
	// The optional missing edge dangles; the others are satisfied.
	var dangling, optional int
	for _, e := range g.Edges {
		if !e.Satisfied {
			dangling++
			if !strings.Contains(e.To, "it.company.absent") {
				t.Errorf("dangling edge should point at the missing name: %+v", e)
			}
		}
		if e.Optional {
			optional++
		}
	}
	if dangling != 1 {
		t.Errorf("dangling edges = %d", dangling)
	}
	if optional != 1 {
		t.Errorf("optional edges = %d", optional)
	}
	if len(g.Edges) != 3 {
		t.Errorf("edges = %+v", g.Edges)
	}
	// Explain surfaces the missing requirements.
	if got := res.Explain(); len(got) != 1 || got[0].Requirement.Name != "it.company.absent" {
		t.Errorf("Explain = %+v", got)
	}
}

func TestBuildDependencyGraphFragmentEdge(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: it.company.host\nBundle-Version: 1.0.0\n",
		"Bundle-SymbolicName: it.company.fragment\nBundle-Version: 1.0.0\nFragment-Host: it.company.host;bundle-version=\"[1.0,2.0)\"\n",
	)
	frag := idx.ByName("it.company.fragment")[0]
	res := NewResolver(idx).Resolve(frag)
	g := BuildDependencyGraph(res)

	var hostEdge *GraphEdge
	for i := range g.Edges {
		if g.Edges[i].Kind == "Fragment-Host" {
			hostEdge = &g.Edges[i]
		}
	}
	if hostEdge == nil || !hostEdge.Satisfied {
		t.Fatalf("fragment host edge = %+v", g.Edges)
	}
	if !strings.Contains(hostEdge.To, "it.company.host") {
		t.Errorf("edge target = %q", hostEdge.To)
	}
}

func TestTargetPlatformLifecycle(t *testing.T) {
	root := t.TempDir()
	writeJar(t, root+"/plugins/a.jar", "Bundle-SymbolicName: a.bundle\nBundle-Version: 1.0.0\n")

	tp := NewTargetPlatform()
	if err := tp.Add(TargetProfile{Name: "kepler", Kind: TargetLocalDirectory, Path: root, ExecutionEnvironment: "JavaSE-1.6", Offline: true}); err != nil {
		t.Fatal(err)
	}
	// Duplicate names are refused; unknown profiles cannot be activated.
	if err := tp.Add(TargetProfile{Name: "kepler", Path: root}); err == nil {
		t.Error("duplicate profile name accepted")
	}
	if err := tp.SetActive("nope"); err == nil {
		t.Error("unknown active profile accepted")
	}
	if err := tp.SetActive("kepler"); err != nil {
		t.Fatal(err)
	}
	profile, ok := tp.ActiveProfile()
	if !ok || profile.ExecutionEnvironment != "JavaSE-1.6" {
		t.Errorf("active = %+v", profile)
	}

	idx, err := tp.Index()
	if err != nil {
		t.Fatal(err)
	}
	if len(idx.All()) != 1 {
		t.Errorf("indexed = %d", len(idx.All()))
	}
	// Reindex picks up additions to the target directory.
	writeJar(t, root+"/plugins/b.jar", "Bundle-SymbolicName: b.bundle\nBundle-Version: 1.0.0\n")
	idx, err = tp.Reindex()
	if err != nil {
		t.Fatal(err)
	}
	if len(idx.All()) != 2 {
		t.Errorf("after reindex = %d", len(idx.All()))
	}

	if err := tp.Remove("kepler"); err != nil {
		t.Fatal(err)
	}
	if _, ok := tp.ActiveProfile(); ok {
		t.Error("active profile should be cleared on remove")
	}
	if _, err := tp.Index(); err == nil {
		t.Error("Index should fail without an active target")
	}
}

func TestValidateReportsStatisticsAndDuplicates(t *testing.T) {
	root := t.TempDir()
	writeJar(t, root+"/plugins/a1.jar", "Bundle-SymbolicName: a.bundle\nBundle-Version: 1.0.0\n")
	writeJar(t, root+"/plugins/a2.jar", "Bundle-SymbolicName: a.bundle\nBundle-Version: 1.0.0\n")

	wsRoot := t.TempDir()
	writeProject(t, wsRoot, "it.company.app", "Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\nRequire-Bundle: it.company.missing\n", nil)
	ws, err := ImportWorkspace(wsRoot)
	if err != nil {
		t.Fatal(err)
	}

	tp := NewTargetPlatform()
	if err := tp.Add(TargetProfile{Name: "t", Kind: TargetLocalDirectory, Path: root}); err != nil {
		t.Fatal(err)
	}
	if err := tp.SetActive("t"); err != nil {
		t.Fatal(err)
	}
	result, err := tp.Validate(ws)
	if err != nil {
		t.Fatal(err)
	}
	if result.BundlesIndexed != 2 || result.WorkspaceBundles != 1 || result.Unresolved != 1 {
		t.Errorf("stats = %s", result)
	}
	if len(result.ExactDuplicates) != 1 {
		t.Errorf("exact duplicates = %v", result.ExactDuplicates)
	}
	if !strings.Contains(result.String(), "[Bundles indexed] 2") {
		t.Errorf("layout = %q", result.String())
	}
	// The unresolved requirement is reported as an error problem.
	found := false
	for _, p := range result.Problems {
		if p.Severity == "error" && strings.Contains(p.Message, "it.company.missing") {
			found = true
		}
	}
	if !found {
		t.Errorf("problems = %+v", result.Problems)
	}
}

func TestValidateMissingTargetPath(t *testing.T) {
	tp := NewTargetPlatform()
	if err := tp.Add(TargetProfile{Name: "gone", Kind: TargetLocalDirectory, Path: "C:/definitely/not/here"}); err != nil {
		t.Fatal(err)
	}
	if err := tp.SetActive("gone"); err != nil {
		t.Fatal(err)
	}
	result, err := tp.Validate(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Problems) == 0 || !strings.Contains(result.Problems[0].Message, "does not exist") {
		t.Errorf("problems = %+v", result.Problems)
	}
}
