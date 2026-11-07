package java

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeZip(t *testing.T, path string, files map[string]string) {
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

func TestMergeLibrariesDedupesSkipsOwnModulesAndReadsTheRepository(t *testing.T) {
	repository := t.TempDir()
	writeZip(t, ArtifactPath(repository, "com.google.guava", "guava", "33.0", ""), map[string]string{"a.class": ""})
	writeZip(t, ArtifactPath(repository, "com.google.guava", "guava", "33.0", "sources"), map[string]string{"A.java": ""})
	refs := []LibraryRef{
		{GroupID: "org.slf4j", ArtifactID: "slf4j-api", Version: "2.0", Module: "core"},
		{GroupID: "com.google.guava", ArtifactID: "guava", Version: "33.0", Direct: true, Module: "core"},
		{GroupID: "com.google.guava", ArtifactID: "guava", Version: "33.0", Module: "web"},
		{GroupID: "com.acme", ArtifactID: "core", Version: "1.0", Direct: true, Module: "web"},
		{GroupID: "", ArtifactID: "broken", Version: "1"},
	}
	libraries := MergeLibraries(refs, map[string]bool{"com.acme:core": true}, repository)
	if len(libraries) != 2 {
		t.Fatalf("libraries = %+v", libraries)
	}
	guava := libraries[0]
	if guava.ArtifactID != "guava" || !guava.Direct || !guava.Downloaded || !guava.Sources || strings.Join(guava.Modules, ",") != "core,web" {
		t.Fatalf("guava = %+v", guava)
	}
	if slf4j := libraries[1]; slf4j.Direct || slf4j.Downloaded || slf4j.Sources {
		t.Fatalf("slf4j = %+v", slf4j)
	}
}

func TestExtractSourcesKeepsOnlyTextAndMarksTheFolderReady(t *testing.T) {
	jar := filepath.Join(t.TempDir(), "lib-1.0-sources.jar")
	writeZip(t, jar, map[string]string{
		"com/acme/Lib.java":        "package com.acme;",
		"com/acme/lib.properties":  "a=1",
		"META-INF/MANIFEST.MF":     "Manifest-Version: 1.0",
		"com/acme/Lib.class":       "binary",
		"com/acme/images/logo.png": "png",
	})
	directory := SourcesDirectory(t.TempDir(), "com.acme", "lib", "1.0")
	if SourcesExtracted(directory) {
		t.Fatal("nothing extracted yet")
	}
	if err := ExtractSources(jar, directory); err != nil {
		t.Fatal(err)
	}
	if !SourcesExtracted(directory) {
		t.Fatal("the folder is not marked ready")
	}
	for name, want := range map[string]bool{"com/acme/Lib.java": true, "com/acme/lib.properties": true, "META-INF/MANIFEST.MF": false, "com/acme/Lib.class": false, "com/acme/images/logo.png": false} {
		if got := isFile(filepath.Join(directory, filepath.FromSlash(name))); got != want {
			t.Errorf("%s extracted = %v, want %v", name, got, want)
		}
	}
	// Una seconda chiamata non rifà nulla.
	if err := ExtractSources(filepath.Join(t.TempDir(), "missing.jar"), directory); err != nil {
		t.Fatal(err)
	}
}

func TestExtractSourcesRejectsPathsThatLeaveTheFolder(t *testing.T) {
	jar := filepath.Join(t.TempDir(), "evil-sources.jar")
	writeZip(t, jar, map[string]string{"../../escape.java": "x"})
	directory := filepath.Join(t.TempDir(), "out")
	if err := ExtractSources(jar, directory); err == nil {
		t.Fatal("an escaping path must fail")
	}
	if SourcesExtracted(directory) || isFile(filepath.Join(filepath.Dir(directory), "escape.java")) {
		t.Fatal("nothing may be written")
	}
}

func TestProjectCoordinateUsesTheParentGroup(t *testing.T) {
	pom := filepath.Join(t.TempDir(), "pom.xml")
	if err := os.WriteFile(pom, []byte(`<project><parent><groupId>com.acme</groupId><artifactId>parent</artifactId></parent><artifactId>web</artifactId></project>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ProjectCoordinate(pom); got != "com.acme:web" {
		t.Fatalf("coordinate = %q", got)
	}
}

func TestLibraryCoordinateValid(t *testing.T) {
	if !LibraryCoordinateValid("org.slf4j", "slf4j-api", "2.0.9") {
		t.Fatal("a normal coordinate is valid")
	}
	for _, bad := range [][3]string{{"..", "a", "1"}, {"g", "a/b", "1"}, {"g", "a", "-Dx"}, {"g", "", "1"}} {
		if LibraryCoordinateValid(bad[0], bad[1], bad[2]) {
			t.Errorf("%v must be invalid", bad)
		}
	}
}

func TestReactorPomsFollowsModulesInsideTheProject(t *testing.T) {
	root := t.TempDir()
	write := func(name, content string) {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("pom.xml", `<project><modules><module>api</module><module>services/pom.xml</module><module>../outside</module><module>missing</module></modules></project>`)
	write("api/pom.xml", `<project/>`)
	write("services/pom.xml", `<project><modules><module>billing</module><module>..</module></modules></project>`)
	write("services/billing/pom.xml", `<project/>`)
	var got []string
	for _, pom := range ReactorPoms(filepath.Join(root, "pom.xml"), root) {
		relative, _ := filepath.Rel(root, pom)
		got = append(got, filepath.ToSlash(relative))
	}
	if strings.Join(got, ",") != "pom.xml,api/pom.xml,services/pom.xml,services/billing/pom.xml" {
		t.Fatalf("reactor = %v", got)
	}
}
