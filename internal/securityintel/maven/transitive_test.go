package maven

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/securityintel"
)

func writeRepoPOM(t *testing.T, repository, group, artifact, version, body string) {
	t.Helper()
	path := PomPath(repository, Coordinate{GroupID: group, ArtifactID: artifact, Version: version})
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	pom := `<project><modelVersion>4.0.0</modelVersion><groupId>` + group + `</groupId><artifactId>` + artifact + `</artifactId><version>` + version + `</version>` + body + `</project>`
	if err := os.WriteFile(path, []byte(pom), 0o644); err != nil {
		t.Fatal(err)
	}
}

func dep(group, artifact, version, extra string) string {
	v := ""
	if version != "" {
		v = "<version>" + version + "</version>"
	}
	return "<dependency><groupId>" + group + "</groupId><artifactId>" + artifact + "</artifactId>" + v + extra + "</dependency>"
}

func TestResolveLocalWalksTransitiveDependenciesFromTheLocalRepository(t *testing.T) {
	repository := t.TempDir()
	// lib-parent (in the repository) manages the version of "b"; "a" inherits it and has no version for "b".
	writeRepoPOM(t, repository, "x", "lib-parent", "1", "<packaging>pom</packaging><dependencyManagement><dependencies>"+dep("x", "b", "2.0", "")+"</dependencies></dependencyManagement>")
	writeRepoPOM(t, repository, "x", "a", "1.0",
		"<parent><groupId>x</groupId><artifactId>lib-parent</artifactId><version>1</version></parent><dependencies>"+
			dep("x", "b", "", "")+ // inherited version, compile
			dep("x", "c", "1", "<scope>test</scope>")+ // not transitive
			dep("x", "d", "1", "<optional>true</optional>")+ // not transitive
			dep("x", "e", "1", "<scope>runtime</scope>")+
			dep("x", "skipme", "1", "")+ // excluded by the project
			"</dependencies>")
	writeRepoPOM(t, repository, "x", "b", "2.0", "<dependencies>"+dep("x", "f", "3", "")+"</dependencies>")
	writeRepoPOM(t, repository, "x", "e", "1", "")
	writeRepoPOM(t, repository, "x", "f", "3", "")
	writeRepoPOM(t, repository, "x", "skipme", "1", "<dependencies>"+dep("x", "ghost", "1", "")+"</dependencies>")

	project := t.TempDir()
	pomPath := filepath.Join(project, "pom.xml")
	root := `<project><modelVersion>4.0.0</modelVersion><groupId>app</groupId><artifactId>app</artifactId><version>1</version><dependencies>` +
		dep("x", "a", "1.0", "<exclusions><exclusion><groupId>x</groupId><artifactId>skipme</artifactId></exclusion></exclusions>") +
		`</dependencies></project>`
	if err := os.WriteFile(pomPath, []byte(root), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := (&Resolver{LocalRepository: repository}).Resolve(context.Background(), pomPath, securityintel.ResolveOptions{Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]securityintel.Component{}
	for _, component := range result.Components {
		got[component.Name] = component
	}
	if got["x:b"].Version != "2.0" || got["x:b"].Origin != securityintel.OriginTransitive || got["x:b"].Direct {
		t.Errorf("b: the version comes from a's parent management: %+v", got["x:b"])
	}
	if got["x:f"].Version != "3" || strings.Join(got["x:f"].DependencyPath, ">") != "app>x:a>x:b>x:f" {
		t.Errorf("f: two levels down, with its path: %+v", got["x:f"])
	}
	if got["x:e"].Scope != securityintel.Scope("runtime") {
		t.Errorf("e keeps the runtime scope: %+v", got["x:e"])
	}
	for _, absent := range []string{"x:c", "x:d", "x:skipme", "x:ghost"} {
		if _, found := got[absent]; found {
			t.Errorf("%s must not be on the graph", absent)
		}
	}
	if !result.Transitive {
		t.Errorf("every POM was available, the graph is complete: %v", result.Warnings)
	}
}

func TestResolveLocalSaysWhenAPOMIsNotInTheRepository(t *testing.T) {
	repository := t.TempDir()
	project := t.TempDir()
	pomPath := filepath.Join(project, "pom.xml")
	root := `<project><modelVersion>4.0.0</modelVersion><groupId>app</groupId><artifactId>app</artifactId><version>1</version><dependencies>` + dep("x", "never-downloaded", "1", "") + `</dependencies></project>`
	if err := os.WriteFile(pomPath, []byte(root), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := (&Resolver{LocalRepository: repository}).Resolve(context.Background(), pomPath, securityintel.ResolveOptions{Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.Transitive {
		t.Error("a missing POM means the graph is partial")
	}
	found := false
	for _, warning := range result.Warnings {
		found = found || strings.Contains(warning, "not in the local Maven repository")
	}
	if !found {
		t.Errorf("the partial graph must be declared: %v", result.Warnings)
	}
}

func TestPropagatedScopeAndVersionRanges(t *testing.T) {
	for _, test := range []struct{ parent, child, want string }{{"compile", "compile", "compile"}, {"compile", "runtime", "runtime"}, {"runtime", "compile", "runtime"}, {"test", "compile", "test"}, {"compile", "provided", ""}, {"compile", "test", ""}} {
		if got, ok := propagatedScope(test.parent, test.child); got != test.want || ok != (test.want != "") {
			t.Errorf("%s/%s = %q,%v", test.parent, test.child, got, ok)
		}
	}
	if pinnedVersion("[1.2,2.0)") != "1.2" || pinnedVersion("1.5") != "1.5" || pinnedVersion("(,2.0)") != "" {
		t.Error("range lower bound")
	}
}
