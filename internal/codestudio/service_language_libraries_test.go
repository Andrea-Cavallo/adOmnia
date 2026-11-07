package codestudio

import (
	"path/filepath"
	"runtime"
	"testing"
)

// Un progetto Python con un ambiente del progetto: External Libraries legge site-packages, marca le
// dichiarate e le transitive, mostra le dichiarate non installate e apre il codice senza processi.
func TestPythonLibrariesReadSitePackages(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "pyproject.toml"), `[project]
name = "demo"
dependencies = ["requests==2.31.0", "flask>=3"]
`)
	interpreter := filepath.Join(root, ".venv", "bin", "python")
	site := filepath.Join(root, ".venv", "lib", "python3.12", "site-packages")
	if runtime.GOOS == "windows" {
		interpreter = filepath.Join(root, ".venv", "Scripts", "python.exe")
		site = filepath.Join(root, ".venv", "Lib", "site-packages")
	}
	writeTestFile(t, interpreter, "")
	writeTestFile(t, filepath.Join(site, "requests-2.31.0.dist-info", "METADATA"), "Name: requests\nVersion: 2.31.0\n\n")
	writeTestFile(t, filepath.Join(site, "requests-2.31.0.dist-info", "top_level.txt"), "requests\n")
	writeTestFile(t, filepath.Join(site, "requests", "__init__.py"), "")
	writeTestFile(t, filepath.Join(site, "urllib3-2.0.7.dist-info", "METADATA"), "Name: urllib3\nVersion: 2.0.7\n\n")
	writeTestFile(t, filepath.Join(site, "urllib3", "__init__.py"), "")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.PythonLibraries(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]LanguageLibrary{}
	for _, library := range result.Libraries {
		found[library.Name] = library
	}
	requests, ok := found["requests"]
	if !ok || !requests.Direct || !requests.Available || requests.Version != "2.31.0" || requests.Kind != "site-packages" {
		t.Fatalf("requests = %+v (all %+v, warnings %v)", requests, result.Libraries, result.Warnings)
	}
	if urllib3, ok := found["urllib3"]; !ok || urllib3.Direct || !urllib3.Available {
		t.Fatalf("urllib3 = %+v", urllib3)
	}
	if flask, ok := found["flask"]; !ok || flask.Available || flask.Note == "" {
		t.Fatalf("a declared but uninstalled package must be visible with a note: %+v", flask)
	}

	source, err := service.PythonLibrarySource(string(session.ID), "requests")
	if err != nil || !source.Found || source.Kind != "python-site-packages" || source.EntryPath != "__init__.py" {
		t.Fatalf("source = %+v (%v)", source, err)
	}
	entries, err := service.ListExternalDirectory(string(session.ID), filepath.Join(site, "requests"))
	if err != nil || len(entries) != 1 || entries[0].Name != "__init__.py" {
		t.Fatalf("entries = %+v (%v)", entries, err)
	}
	if missing, err := service.PythonLibrarySource(string(session.ID), "flask"); err != nil || missing.Found {
		t.Fatalf("flask source = %+v (%v)", missing, err)
	}
}

// Un progetto C/C++ con FetchContent e una libreria di sistema: la dipendenza scaricata si sfoglia,
// quella di sistema resta la sola dichiarazione.
func TestNativeLibrariesReadFetchContent(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "CMakeLists.txt"), `
cmake_minimum_required(VERSION 3.20)
project(demo CXX)
find_package(ZLIB REQUIRED)
FetchContent_Declare(fmt GIT_REPOSITORY https://github.com/fmtlib/fmt GIT_TAG 10.2.1)
FetchContent_MakeAvailable(fmt)
`)
	writeTestFile(t, filepath.Join(root, "build", "_deps", "fmt-src", "src", "format.h"), "#pragma once\n")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.NativeLibraries(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]LanguageLibrary{}
	for _, library := range result.Libraries {
		found[library.Name] = library
	}
	fmtLib, ok := found["fmt"]
	if !ok || !fmtLib.Available || fmtLib.Directory == "" || fmtLib.Version != "10.2.1" || fmtLib.Kind != "fetchcontent" {
		t.Fatalf("fmt = %+v (all %+v)", fmtLib, result.Libraries)
	}
	if zlib, ok := found["ZLIB"]; !ok || zlib.Available || zlib.Note == "" {
		t.Fatalf("a system package must be declared without source: %+v", zlib)
	}
	source, err := service.NativeLibrarySource(string(session.ID), "fmt", "")
	if err != nil || !source.Found || source.Kind != "native-dependency" || source.Directory == "" || source.EntryPath == "" {
		t.Fatalf("source = %+v (%v)", source, err)
	}
	entries, err := service.ListExternalDirectory(string(session.ID), filepath.Join(source.Directory, "src"))
	if err != nil || len(entries) != 1 || entries[0].Name != "format.h" {
		t.Fatalf("entries = %+v (%v)", entries, err)
	}
	if missing, err := service.NativeLibrarySource(string(session.ID), "ZLIB", ""); err != nil || missing.Found {
		t.Fatalf("ZLIB source = %+v (%v)", missing, err)
	}
}
