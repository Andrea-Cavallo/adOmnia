package declared

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

func nativeAdapterFor(t *testing.T, id string) nativeAdapter {
	t.Helper()
	for _, language := range Languages() {
		if language.ID() == id {
			adapter, ok := language.(nativeAdapter)
			if !ok {
				t.Fatalf("%s is not a native adapter", id)
			}
			return adapter
		}
	}
	t.Fatalf("language %s not registered", id)
	return nativeAdapter{}
}

func fakeToolchain(t *testing.T, tools ...string) {
	t.Helper()
	t.Cleanup(func() { lookPath = defaultLookPath })
	available := map[string]bool{}
	for _, tool := range tools {
		available[tool] = true
	}
	lookPath = func(name string) (string, error) {
		if available[name] {
			return "/usr/bin/" + name, nil
		}
		return "", errors.New("not found")
	}
}

func TestBuildRunCompilesLegacyCAndRunsIt(t *testing.T) {
	fakeToolchain(t, "clang", "make")
	root := t.TempDir()
	writeProjectFile(t, root, "hello.c", "main() { return 0; }\n")

	spec, err := nativeAdapterFor(t, "cpp").CommandSpec(run.Request{
		Kind: KindBuildRun, Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"source":"hello.c"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Executable != "/usr/bin/make" || len(spec.Arguments) != 3 || spec.Arguments[0] != "-f" || spec.Arguments[2] != "run" {
		t.Fatalf("make command = %+v", spec)
	}
	if !strings.Contains(spec.DisplayCommand, "/usr/bin/clang") || !strings.Contains(spec.DisplayCommand, "&&") {
		t.Fatalf("display command = %q", spec.DisplayCommand)
	}
	content, err := os.ReadFile(spec.Arguments[1])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "-Wno-implicit-int") {
		t.Fatalf("legacy C needs -Wno-implicit-int:\n%s", content)
	}
	if strings.Count(string(content), "\n\t") != 2 {
		t.Fatalf("make must compile and then run:\n%s", content)
	}
	if strings.Count(string(content), "\n\t@") != 2 {
		t.Fatalf("generated recipes must not echo commands already shown in execution details:\n%s", content)
	}
}

func TestBuildRunGathersTheFolderSourcesOfACppProgram(t *testing.T) {
	fakeToolchain(t, "g++", "make")
	root := t.TempDir()
	writeProjectFile(t, root, "main.cpp", "int main() { return 0; }\n")
	writeProjectFile(t, root, "stock.cpp", "int stock() { return 1; }\n")
	writeProjectFile(t, root, "notes.txt", "not a source\n")

	spec, err := nativeAdapterFor(t, "cpp").CommandSpec(run.Request{
		Kind: KindBuildRun, Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"source":"main.cpp"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(spec.Arguments[1])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "main.cpp") || !strings.Contains(string(content), "stock.cpp") || strings.Contains(string(content), "notes.txt") {
		t.Fatalf("sources = %s", content)
	}
	if strings.Contains(string(content), "-Wno-implicit-int") {
		t.Fatalf("C++ must not get the C flag:\n%s", content)
	}
}

func TestBuildRunKeepsSeparateProgramsApart(t *testing.T) {
	fakeToolchain(t, "g++", "make")
	root := t.TempDir()
	writeProjectFile(t, root, "one.cpp", "int main() { return 0; }\n")
	writeProjectFile(t, root, "two.cpp", "int main() { return 1; }\n")

	spec, err := nativeAdapterFor(t, "cpp").CommandSpec(run.Request{
		Kind: KindBuildRun, Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"source":"one.cpp"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(spec.Arguments[1])
	if strings.Contains(string(content), "two.cpp") {
		t.Fatalf("two programs in one folder must not be compiled together:\n%s", content)
	}
}

func TestBuildRunNeedsMakeAndASource(t *testing.T) {
	fakeToolchain(t, "clang")
	root := t.TempDir()
	writeProjectFile(t, root, "hello.c", "main() { return 0; }\n")
	adapter := nativeAdapterFor(t, "cpp")

	if _, err := adapter.CommandSpec(run.Request{Kind: KindBuildRun, Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"source":"hello.c"}`)}); err == nil || !strings.Contains(err.Error(), "make") {
		t.Fatalf("missing make must be explained: %v", err)
	}
	if _, err := adapter.CommandSpec(run.Request{Kind: KindBuildRun, Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{}`)}); err == nil {
		t.Fatal("empty source must be refused")
	}
}
