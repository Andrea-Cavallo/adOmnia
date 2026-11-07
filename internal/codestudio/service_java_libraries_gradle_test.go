package codestudio

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestJavaLibrariesWithRealGradle usa Gradle vero: risolve una libreria pubblica, la mostra in External
// Libraries, ne scarica i sorgenti con il task sources e li apre. Va in rete e richiede Gradle installato:
//
//	ADOMNIA_TEST_GRADLE=1 go test ./internal/codestudio/ -run TestJavaLibrariesWithRealGradle -v
func TestJavaLibrariesWithRealGradle(t *testing.T) {
	if os.Getenv("ADOMNIA_TEST_GRADLE") == "" {
		t.Skip("set ADOMNIA_TEST_GRADLE=1 to run Gradle for real (network)")
	}
	if _, err := exec.LookPath("gradle"); err != nil {
		t.Skip("gradle is not on PATH")
	}
	root, gradleHome := t.TempDir(), t.TempDir()
	t.Setenv("GRADLE_USER_HOME", gradleHome)
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	writeTestFile(t, filepath.Join(root, "settings.gradle"), "rootProject.name = 'demo'\n")
	writeTestFile(t, filepath.Join(root, "build.gradle"), `plugins { id 'java' }
repositories { mavenCentral() }
dependencies { implementation 'org.slf4j:slf4j-simple:2.0.13' }
`)

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
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
