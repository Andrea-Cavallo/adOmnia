package codestudio

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeSourcesJar(t *testing.T, path string, files map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

// Un progetto Maven con due moduli: External Libraries mostra la libreria (e la sua transitiva dal repository
// locale) una volta sola, non il modulo fratello, e ne apre i sorgenti dal jar `-sources`.
func TestJavaLibrariesListsTheResolvedDependenciesAndOpensTheirSources(t *testing.T) {
	root, repository := t.TempDir(), t.TempDir()
	t.Setenv("MAVEN_OPTS", "-Dmaven.repo.local="+repository)
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	writeTestFile(t, filepath.Join(root, "pom.xml"), `<project><groupId>com.acme</groupId><artifactId>parent</artifactId><version>1</version><packaging>pom</packaging><modules><module>core</module><module>web</module></modules></project>`)
	writeTestFile(t, filepath.Join(root, "core", "pom.xml"), `<project><groupId>com.acme</groupId><artifactId>core</artifactId><version>1</version>
<dependencies><dependency><groupId>org.lib</groupId><artifactId>lib</artifactId><version>2.0</version></dependency></dependencies></project>`)
	writeTestFile(t, filepath.Join(root, "web", "pom.xml"), `<project><groupId>com.acme</groupId><artifactId>web</artifactId><version>1</version>
<dependencies><dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>1</version></dependency>
<dependency><groupId>org.lib</groupId><artifactId>lib</artifactId><version>2.0</version></dependency></dependencies></project>`)
	writeTestFile(t, filepath.Join(repository, "org", "lib", "lib", "2.0", "lib-2.0.pom"), `<project><groupId>org.lib</groupId><artifactId>lib</artifactId><version>2.0</version>
<dependencies><dependency><groupId>org.tiny</groupId><artifactId>tiny</artifactId><version>0.1</version></dependency></dependencies></project>`)
	writeTestFile(t, filepath.Join(repository, "org", "tiny", "tiny", "0.1", "tiny-0.1.pom"), `<project><groupId>org.tiny</groupId><artifactId>tiny</artifactId><version>0.1</version></project>`)
	writeSourcesJar(t, java.ArtifactPath(repository, "org.lib", "lib", "2.0", ""), map[string]string{"org/lib/Lib.class": "x"})
	writeSourcesJar(t, java.ArtifactPath(repository, "org.lib", "lib", "2.0", "sources"), map[string]string{"org/lib/Lib.java": "package org.lib;\npublic class Lib {}\n"})

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
	found := map[string]java.Library{}
	for _, library := range result.Libraries {
		found[library.Coordinate()] = library
	}
	lib, ok := found["org.lib:lib:2.0"]
	if !ok || !lib.Direct || !lib.Downloaded || !lib.Sources || len(lib.Modules) != 2 {
		t.Fatalf("lib = %+v (all: %+v, warnings %v)", lib, result.Libraries, result.Warnings)
	}
	if _, own := found["com.acme:core:1"]; own {
		t.Fatal("a module of the project is not an external library")
	}
	if tiny, ok := found["org.tiny:tiny:0.1"]; !ok || tiny.Direct || tiny.Downloaded {
		t.Fatalf("the transitive dependency is missing or wrong: %+v", result.Libraries)
	}

	source, err := service.JavaLibrarySource(string(session.ID), "org.lib", "lib", "2.0")
	if err != nil {
		t.Fatal(err)
	}
	if !source.Downloaded || source.EntryPath != "org/lib/Lib.java" || source.Kind != "maven-sources" {
		t.Fatalf("source = %+v", source)
	}
	entries, err := service.ListExternalDirectory(string(session.ID), filepath.Join(source.Directory, "org", "lib"))
	if err != nil || len(entries) != 1 || entries[0].Name != "Lib.java" {
		t.Fatalf("the extracted sources are not browsable: %+v %v", entries, err)
	}
	missing, err := service.JavaLibrarySource(string(session.ID), "org.tiny", "tiny", "0.1")
	if err != nil || missing.Downloaded || missing.Reason == "" {
		t.Fatalf("a library without sources must say so: %+v %v", missing, err)
	}
	if _, err := service.JavaLibrarySource(string(session.ID), "../x", "lib", "2.0"); err == nil {
		t.Fatal("an invalid coordinate must be rejected")
	}
	if err := service.DownloadJavaLibrarySources(string(session.ID), "org.tiny", "tiny", "0.1"); err == nil {
		t.Fatal("an untrusted project must not run Maven")
	}
}

// Un progetto Gradle non autorizzato: External Libraries legge i build script e la cache Gradle, senza
// eseguire gradlew (il marker non deve comparire), e apre i sorgenti già in cache.
func TestJavaLibrariesReadsGradleCacheWithoutRunningGradle(t *testing.T) {
	root, gradleHome, marker := t.TempDir(), t.TempDir(), filepath.Join(t.TempDir(), "gradle-ran")
	t.Setenv("GRADLE_USER_HOME", gradleHome)
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	writeTestFile(t, filepath.Join(root, "settings.gradle"), "rootProject.name = 'demo'\n")
	writeTestFile(t, filepath.Join(root, "build.gradle"), `
dependencies {
    implementation 'org.lib:lib:2.0'
    testImplementation 'org.unversioned:other'
}
`)
	writeGradleWrapper(t, root, marker, nil)
	writeGradleCacheJar(t, gradleHome, "org.lib", "lib", "2.0", "")
	writeGradleCacheJar(t, gradleHome, "org.lib", "lib", "2.0", "sources")

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
	if len(result.Libraries) != 1 {
		t.Fatalf("libraries = %+v (warnings %v)", result.Libraries, result.Warnings)
	}
	lib := result.Libraries[0]
	if lib.Coordinate() != "org.lib:lib:2.0" || !lib.Direct || !lib.Downloaded || !lib.Sources || lib.Scope != "compile" {
		t.Fatalf("library = %+v", lib)
	}
	if fileExists(marker) {
		t.Fatal("an unauthorized project must not run Gradle")
	}
	source, err := service.JavaLibrarySource(string(session.ID), "org.lib", "lib", "2.0")
	if err != nil || !source.Downloaded || source.Kind != "maven-sources" {
		t.Fatalf("source = %+v (%v)", source, err)
	}
}

// Con il progetto autorizzato la lista arriva dal task Gradle (qui uno stub che stampa il formato reale):
// transitive comprese, e il download dei sorgenti usa lo stesso task.
func TestJavaLibrariesRunsGradleWhenAuthorized(t *testing.T) {
	root, gradleHome := t.TempDir(), t.TempDir()
	t.Setenv("GRADLE_USER_HOME", gradleHome)
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	writeTestFile(t, filepath.Join(root, "settings.gradle"), "rootProject.name = 'demo'\n")
	writeTestFile(t, filepath.Join(root, "build.gradle"), "dependencies { implementation 'org.lib:lib:2.0' }\n")
	writeGradleWrapper(t, root, filepath.Join(t.TempDir(), "gradle-ran"), []string{
		"ADOMNIA|LIB|" + "PROJECT_DIR" + "|compileClasspath|org.lib|lib|2.0|true",
		"ADOMNIA|LIB|" + "PROJECT_DIR" + "|runtimeClasspath|org.tiny|tiny|0.1|false",
	})
	writeGradleCacheJar(t, gradleHome, "org.lib", "lib", "2.0", "")
	writeGradleCacheJar(t, gradleHome, "org.lib", "lib", "2.0", "sources")
	writeGradleCacheJar(t, gradleHome, "org.tiny", "tiny", "0.1", "")

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
	found := map[string]java.Library{}
	for _, library := range result.Libraries {
		found[library.Coordinate()] = library
	}
	lib, ok := found["org.lib:lib:2.0"]
	if !ok || !lib.Direct || !lib.Downloaded || !lib.Sources {
		t.Fatalf("direct library = %+v (all: %+v, warnings %v)", lib, result.Libraries, result.Warnings)
	}
	if tiny, ok := found["org.tiny:tiny:0.1"]; !ok || tiny.Direct {
		t.Fatalf("transitive library = %+v (all: %+v)", tiny, result.Libraries)
	}
	if err := service.DownloadJavaLibrarySources(string(session.ID), "org.lib", "lib", "2.0"); err != nil {
		t.Fatalf("Gradle sources download: %v", err)
	}
	source, err := service.JavaLibrarySource(string(session.ID), "org.lib", "lib", "2.0")
	if err != nil || !source.Downloaded || source.Kind != "maven-sources" {
		t.Fatalf("source = %+v (%v)", source, err)
	}
}

// writeGradleWrapper crea un wrapper valido per BuildToolOf e uno stub che stampa le righe date (o tocca
// marker e non stampa nulla). PROJECT_DIR viene sostituito con la cartella di lavoro.
func writeGradleWrapper(t *testing.T, root, marker string, lines []string) {
	t.Helper()
	writeTestFile(t, filepath.Join(root, "gradle", "wrapper", "gradle-wrapper.properties"), "distributionUrl=file:stub\n")
	if runtime.GOOS == "windows" {
		writeTestFile(t, filepath.Join(root, "gradlew.bat"), "@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0adomnia-gradle-stub.ps1\" %*\r\n")
		script := fmt.Sprintf("Set-Content -Path '%s' -Value 'ran'\r\n", marker)
		for _, line := range lines {
			script += fmt.Sprintf("Write-Output \"%s\"\r\n", strings.ReplaceAll(line, "PROJECT_DIR", "$PWD"))
		}
		writeTestFile(t, filepath.Join(root, "adomnia-gradle-stub.ps1"), script)
		return
	}
	script := "#!/bin/sh\n: > \"" + marker + "\"\n"
	for _, line := range lines {
		script += "echo \"" + strings.ReplaceAll(line, "PROJECT_DIR", "$PWD") + "\"\n"
	}
	path := filepath.Join(root, "gradlew")
	writeTestFile(t, path, script)
	if err := os.Chmod(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

// writeGradleCacheJar scrive un artefatto nel layout reale della cache Gradle (sottocartella con hash).
func writeGradleCacheJar(t *testing.T, gradleHome, groupID, artifactID, version, classifier string) {
	t.Helper()
	name := artifactID + "-" + version
	if classifier != "" {
		name += "-" + classifier
	}
	path := filepath.Join(gradleHome, "caches", "modules-2", "files-2.1", groupID, artifactID, version, "0123456789abcdef", name+".jar")
	if classifier == "sources" {
		writeSourcesJar(t, path, map[string]string{artifactID + "/Entry.java": "package " + artifactID + ";\npublic class Entry {}\n"})
		return
	}
	writeSourcesJar(t, path, map[string]string{artifactID + "/Entry.class": "x"})
}
