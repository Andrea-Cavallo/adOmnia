package eclipsepde

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func writePom(t *testing.T, root, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, "pom.xml"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestTychoTargetReadsTheRepositoriesOfAPom is the Camunda case: the target of a Tycho build is the
// repository list of its pom, with the `${properties}` the pom itself defines.
func TestTychoTargetReadsTheRepositoriesOfAPom(t *testing.T) {
	root := t.TempDir()
	writePom(t, root, `<?xml version="1.0"?>
<project>
  <properties><eclipse-site>https://download.eclipse.org/releases/kepler</eclipse-site></properties>
  <modules><module>core</module><module>app</module></modules>
  <repositories>
    <repository><id>eclipse-platform</id><layout>p2</layout><url>${eclipse-site}</url></repository>
    <repository><id>bpmn2</id><url>https://download.eclipse.org/modeling/mdt/bpmn2/updates/kepler/1.0.0/</url><layout>p2</layout></repository>
    <repository><id>maven-central</id><url>https://repo1.maven.org/maven2</url></repository>
    <repository><id>local</id><layout>p2</layout><url>${undefined-property}</url></repository>
  </repositories>
</project>`)

	target, err := ReadTychoTarget(root)
	if err != nil {
		t.Fatal(err)
	}
	urls := make([]string, 0, len(target.Repositories))
	for _, repository := range target.Repositories {
		urls = append(urls, repository.URL)
	}
	want := []string{"https://download.eclipse.org/releases/kepler", "https://download.eclipse.org/modeling/mdt/bpmn2/updates/kepler/1.0.0/"}
	if !slices.Equal(urls, want) {
		t.Fatalf("repositories = %v, want %v", urls, want)
	}
	if !slices.Equal(target.Modules, []string{"core", "app"}) {
		t.Fatalf("modules = %v", target.Modules)
	}
	// A property the pom lacks is reported instead of silently becoming an empty URL.
	if !slices.Equal(target.Unresolved, []string{"${undefined-property}"}) {
		t.Fatalf("unresolved = %v", target.Unresolved)
	}
}

// TestTychoTargetReadsTheRepositoriesOfAParentPom is the earth.sci case: the aggregator's
// pom.xml only declares <parent> and the p2 repositories (and their properties) live in the
// parent pom Maven points at.
func TestTychoTargetReadsTheRepositoriesOfAParentPom(t *testing.T) {
	root := t.TempDir()
	writeText(t, filepath.Join(root, "parent-pom.xml"), `<?xml version="1.0"?>
<project>
  <properties><luna-site>https://download.eclipse.org/releases/luna</luna-site></properties>
  <repositories>
    <repository><id>luna</id><layout>p2</layout><url>${luna-site}</url></repository>
    <repository><id>sapphire</id><layout>p2</layout><url>http://download.eclipse.org/sapphire/8/repository</url></repository>
  </repositories>
</project>`)
	writePom(t, root, `<?xml version="1.0"?>
<project>
  <parent>
    <groupId>au.gov.ga.earthsci</groupId><artifactId>earthsci-parent</artifactId><version>1.0.0-SNAPSHOT</version>
    <relativePath>./parent-pom.xml</relativePath>
  </parent>
  <modules><module>plugins</module></modules>
  <repositories>
    <repository><id>e4</id><layout>p2</layout><url>http://download.eclipse.org/e4/</url></repository>
  </repositories>
</project>`)

	target, err := ReadTychoTarget(root)
	if err != nil {
		t.Fatal(err)
	}
	var urls []string
	for _, repository := range target.Repositories {
		urls = append(urls, repository.URL)
	}
	// The child's own repository first, then the inherited ones; `${luna-site}` is resolved
	// with the property the parent defines.
	want := []string{
		"http://download.eclipse.org/e4/",
		"https://download.eclipse.org/releases/luna",
		"http://download.eclipse.org/sapphire/8/repository",
	}
	if !slices.Equal(urls, want) {
		t.Fatalf("repositories = %v, want %v", urls, want)
	}
	if !slices.Equal(target.Modules, []string{"plugins"}) {
		t.Fatalf("modules = %v", target.Modules)
	}
}

// TestTychoTargetFollowsTheDefaultParentPath covers the standard Maven layout: pom.xml in a
// module, the parent one folder up with no <relativePath> element.
func TestTychoTargetFollowsTheDefaultParentPath(t *testing.T) {
	base := t.TempDir()
	writeText(t, filepath.Join(base, "pom.xml"), `<project>
  <repositories><repository><id>kepler</id><layout>p2</layout><url>https://download.eclipse.org/releases/kepler</url></repository></repositories>
</project>`)
	child := filepath.Join(base, "module")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	writeText(t, filepath.Join(child, "pom.xml"), `<project>
  <parent><groupId>g</groupId><artifactId>p</artifactId><version>1</version></parent>
</project>`)

	target, err := ReadTychoTarget(child)
	if err != nil {
		t.Fatal(err)
	}
	if len(target.Repositories) != 1 || target.Repositories[0].URL != "https://download.eclipse.org/releases/kepler" {
		t.Fatalf("repositories = %+v", target.Repositories)
	}
}

// TestTychoTargetHonoursAnEmptyRelativePath: Maven reads no local parent when <relativePath/>
// is explicitly empty, so neither does adOmnia.
func TestTychoTargetHonoursAnEmptyRelativePath(t *testing.T) {
	base := t.TempDir()
	writeText(t, filepath.Join(base, "pom.xml"), `<project>
  <repositories><repository><id>kepler</id><layout>p2</layout><url>https://download.eclipse.org/releases/kepler</url></repository></repositories>
</project>`)
	child := filepath.Join(base, "module")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	writeText(t, filepath.Join(child, "pom.xml"), `<project>
  <parent><groupId>g</groupId><artifactId>p</artifactId><version>1</version><relativePath/></parent>
</project>`)

	if _, err := ReadTychoTarget(child); err == nil {
		t.Fatal("a module whose parent is only in the local repository has no target to read")
	}
}

func TestTychoTargetNeedsAPomWithP2(t *testing.T) {
	root := t.TempDir()
	if _, err := ReadTychoTarget(root); err == nil {
		t.Fatal("a folder without pom.xml must say so")
	}
	writePom(t, root, `<project><repositories><repository><id>x</id><url>https://example.test</url></repository></repositories></project>`)
	if _, err := ReadTychoTarget(root); err == nil {
		t.Fatal("a pom with only Maven repositories has no target")
	}
}

// TestWriteTychoTargetSeedsTheRequiredUnits writes a .target adOmnia can read back: the repositories
// of the pom plus the bundles the workspace requires, which in p2 are the installable unit ids.
func TestWriteTychoTargetSeedsTheRequiredUnits(t *testing.T) {
	root := t.TempDir()
	writePom(t, root, `<project>
  <repositories><repository><id>eclipse</id><layout>p2</layout><url>https://download.eclipse.org/releases/kepler</url></repository></repositories>
</project>`)
	writeProject(t, root, "core", bundleManifest("core", "Require-Bundle: org.eclipse.core.runtime, org.eclipse.swt;resolution:=optional, sibling", "Export-Package: core"), map[string]string{
		".classpath":      sourcesClasspath,
		"src/core/C.java": "package core;\nclass C {}\n",
	})
	writeProject(t, root, "sibling", bundleManifest("sibling", "Export-Package: sibling"), map[string]string{
		".classpath":         sourcesClasspath,
		"src/sibling/S.java": "package sibling;\nclass S {}\n",
	})

	units := RequiredUnits(root)
	// `sibling` and `core` are in the workspace; `org.eclipse.swt` is optional.
	if !slices.Equal(units, []string{"org.eclipse.core.runtime"}) {
		t.Fatalf("units = %v", units)
	}

	target, err := ReadTychoTarget(root)
	if err != nil {
		t.Fatal(err)
	}
	path, err := WriteTychoTarget(root, target, units)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(root, ".adomnia", "tycho.target") {
		t.Fatalf("path = %s", path)
	}
	definition, err := ReadTargetDefinition(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(definition.P2) != 1 || len(definition.P2[0].Repositories) != 1 || definition.P2[0].Repositories[0] != "https://download.eclipse.org/releases/kepler" {
		t.Fatalf("repositories = %+v", definition.P2)
	}
	if len(definition.P2[0].Units) != 1 || definition.P2[0].Units[0].ID != "org.eclipse.core.runtime" || definition.P2[0].Units[0].Version != "0.0.0" {
		t.Fatalf("units = %+v", definition.P2[0].Units)
	}
	// The generated definition is the one the downloader reads, and it is not a directory target.
	if len(definition.DirectoryLocations()) != 0 {
		t.Fatalf("directory locations = %v", definition.DirectoryLocations())
	}
	if !strings.Contains(string(mustRead(t, path)), `type="InstallableUnit"`) {
		t.Fatalf("generated target: %s", mustRead(t, path))
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
