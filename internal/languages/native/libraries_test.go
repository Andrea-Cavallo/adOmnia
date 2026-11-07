package native

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeNativeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func byName(declarations []Declaration) map[string]Declaration {
	result := map[string]Declaration{}
	for _, declaration := range declarations {
		result[strings.ToLower(declaration.Name)] = declaration
	}
	return result
}

func TestCMakeDeclarationsAndFetchContentSource(t *testing.T) {
	root := t.TempDir()
	writeNativeTestFile(t, filepath.Join(root, "CMakeLists.txt"), `
cmake_minimum_required(VERSION 3.20)
find_package(ZLIB 1.2.13 REQUIRED)
pkg_check_modules(GLIB REQUIRED glib-2.0>=2.40 gobject-2.0)
FetchContent_Declare(fmt GIT_REPOSITORY https://github.com/fmtlib/fmt GIT_TAG 10.2.1)
FetchContent_MakeAvailable(fmt)
CPMAddPackage(NAME spdlog VERSION 1.13.0 GITHUB_REPOSITORY gabime/spdlog)
`)
	writeNativeTestFile(t, filepath.Join(root, "build", "_deps", "fmt-src", "CMakeLists.txt"), "")
	writeNativeTestFile(t, filepath.Join(root, "vcpkg_installed", "x64-windows", "share", "zlib", "vcpkg.spdx.json"), `{"packages":[{"name":"zlib","versionInfo":"1.2.13"}]}`)

	declarations := byName(Declarations(root))
	zlib, ok := declarations["zlib"]
	if !ok || zlib.Version != "1.2.13" || zlib.Kind != "cmake" {
		t.Fatalf("zlib = %+v (all %+v)", zlib, declarations)
	}
	if zlib.Directory == "" {
		t.Fatal("the vcpkg share directory of zlib must be browsable")
	}
	glib, ok := declarations["glib-2.0"]
	if !ok || glib.Version != ">=2.40" || glib.Kind != "pkgconfig" {
		t.Fatalf("glib = %+v", glib)
	}
	if _, ok := declarations["gobject-2.0"]; !ok {
		t.Fatalf("pkg_check_modules must list every module: %+v", declarations)
	}
	fmt, ok := declarations["fmt"]
	if !ok || fmt.Version != "10.2.1" || fmt.Kind != "fetchcontent" || fmt.Directory == "" {
		t.Fatalf("fmt = %+v", fmt)
	}
	spdlog, ok := declarations["spdlog"]
	if !ok || spdlog.Version != "1.13.0" || spdlog.Kind != "cpm" {
		t.Fatalf("spdlog = %+v", spdlog)
	}
}

func TestManifestsVcpkgConanAndMeson(t *testing.T) {
	root := t.TempDir()
	writeNativeTestFile(t, filepath.Join(root, "vcpkg.json"), `{"name":"demo","dependencies":["fmt",{"name":"boost","version>=":"1.83"}]}`)
	writeNativeTestFile(t, filepath.Join(root, "conanfile.txt"), "[requires]\nzlib/1.2.13\nopenssl/3.2.0@user/stable\n")
	writeNativeTestFile(t, filepath.Join(root, "meson.build"), "cc = meson.get_compiler('c')\nglib = dependency('glib-2.0', version: '>=2.40')\n")
	declarations := byName(Declarations(root))
	if fmtLib, ok := declarations["fmt"]; !ok || fmtLib.Kind != "vcpkg" {
		t.Fatalf("vcpkg fmt = %+v", fmtLib)
	}
	if boost, ok := declarations["boost"]; !ok || boost.Version != "1.83" {
		t.Fatalf("vcpkg boost = %+v", boost)
	}
	if zlib, ok := declarations["zlib"]; !ok || zlib.Version != "1.2.13" || zlib.Kind != "conan" {
		t.Fatalf("conan zlib = %+v", zlib)
	}
	if openssl, ok := declarations["openssl"]; !ok || openssl.Version != "3.2.0" {
		t.Fatalf("conan openssl = %+v", openssl)
	}
	if glib, ok := declarations["glib-2.0"]; !ok || glib.Version != ">=2.40" || glib.Kind != "meson" {
		t.Fatalf("meson glib = %+v", glib)
	}
}

func TestSourceDirectoryFindsTheCheckedOutDependency(t *testing.T) {
	root := t.TempDir()
	writeNativeTestFile(t, filepath.Join(root, "build", "_deps", "mylib-src", "include", "mylib.h"), "")
	if got := SourceDirectory(root, "MyLib"); got != filepath.Join(root, "build", "_deps", "mylib-src") {
		t.Fatalf("source = %q", got)
	}
	if got := SourceDirectory(root, "missing"); got != "" {
		t.Fatalf("missing source = %q", got)
	}
}
