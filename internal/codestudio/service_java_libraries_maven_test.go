package codestudio

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestJavaLibrariesWithRealMaven usa Maven vero: risolve una libreria pubblica, la mostra in External Libraries,
// ne scarica i sorgenti con dependency:get e li apre. Va in rete, quindi solo su richiesta:
//
//	ADOMNIA_TEST_MAVEN=1 go test ./internal/codestudio/ -run TestJavaLibrariesWithRealMaven -v
func TestJavaLibrariesWithRealMaven(t *testing.T) {
	if os.Getenv("ADOMNIA_TEST_MAVEN") == "" {
		t.Skip("set ADOMNIA_TEST_MAVEN=1 to run Maven for real (network)")
	}
	maven, err := exec.LookPath("mvn")
	if err != nil {
		t.Skip("mvn is not on PATH")
	}
	root, repository := t.TempDir(), t.TempDir()
	t.Setenv("MAVEN_OPTS", "-Dmaven.repo.local="+repository)
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	writeTestFile(t, filepath.Join(root, "pom.xml"), `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>com.acme</groupId><artifactId>demo</artifactId><version>1</version>
<dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-simple</artifactId><version>2.0.13</version></dependency></dependencies></project>`)
	resolve := exec.Command(maven, "-B", "-q", "dependency:resolve")
	resolve.Dir = root
	if output, err := resolve.CombinedOutput(); err != nil {
		t.Skipf("Maven could not resolve (offline?): %v\n%s", err, output)
	}

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.JavaLibraries(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	var coordinates []string
	for _, library := range result.Libraries {
		coordinates = append(coordinates, library.Coordinate())
	}
	t.Logf("libraries: %v warnings: %v", coordinates, result.Warnings)
	joined := strings.Join(coordinates, " ")
	if !strings.Contains(joined, "org.slf4j:slf4j-simple:2.0.13") || !strings.Contains(joined, "org.slf4j:slf4j-api:") {
		t.Fatalf("the direct and the transitive library must be listed: %v", coordinates)
	}
	before, err := service.JavaLibrarySource(string(session.ID), "org.slf4j", "slf4j-simple", "2.0.13")
	if err != nil || before.Downloaded {
		t.Fatalf("no sources before the download: %+v %v", before, err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if err := service.DownloadJavaLibrarySources(string(session.ID), "org.slf4j", "slf4j-simple", "2.0.13"); err != nil {
		t.Fatal(err)
	}
	source, err := service.JavaLibrarySource(string(session.ID), "org.slf4j", "slf4j-simple", "2.0.13")
	if err != nil || !source.Downloaded || !strings.HasSuffix(source.EntryPath, ".java") {
		t.Fatalf("the sources must be browsable after the download: %+v %v", source, err)
	}
	document, err := service.OpenExternalDocument(string(session.ID), filepath.Join(source.Directory, filepath.FromSlash(source.EntryPath)))
	if err != nil || !strings.Contains(document.Content, "package org.slf4j") {
		t.Fatalf("the entry file must open read-only: %v", err)
	}
	t.Logf("opened %s (%d files)", source.EntryPath, len(source.Files))
}
