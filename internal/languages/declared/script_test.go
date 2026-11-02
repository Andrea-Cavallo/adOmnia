package declared

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

func byLanguage(t *testing.T, id string) language.Language {
	t.Helper()
	for _, l := range Languages() {
		if l.ID() == id {
			return l
		}
	}
	t.Fatalf("%s is not declared", id)
	return nil
}

func write(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestScriptRunUsesTheFirstInterpreterAndStaysInTheProject(t *testing.T) {
	t.Cleanup(func() { lookPath = defaultLookPath })
	lookPath = func(name string) (string, error) {
		if name == "powershell" || name == "dart" {
			return "/bin/" + name, nil
		}
		return "", errors.New("not found")
	}
	root := t.TempDir()
	write(t, filepath.Join(root, "tools", "seed.ps1"))
	write(t, filepath.Join(root, "bin", "main.dart"))

	ps := byLanguage(t, "powershell").(language.Runner)
	spec, err := ps.CommandSpec(run.Request{Kind: KindScript, Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"script":"tools/seed.ps1"}`), ProgramArguments: []string{"-Name", "a"}})
	if err != nil || spec.Executable != "/bin/powershell" || spec.Arguments[len(spec.Arguments)-3] != filepath.Join(root, "tools", "seed.ps1") || spec.Arguments[len(spec.Arguments)-1] != "a" {
		t.Fatalf("pwsh missing falls back to powershell: %+v %v", spec, err)
	}
	spec, err = byLanguage(t, "dart").(language.Runner).CommandSpec(run.Request{Kind: KindScript, Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"script":"bin/main.dart"}`)})
	if err != nil || spec.Arguments[0] != "run" {
		t.Fatalf("dart run: %+v %v", spec, err)
	}
	if _, err := byLanguage(t, "php").(language.Runner).CommandSpec(run.Request{Kind: KindScript, Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"script":"tools/seed.ps1"}`)}); err == nil {
		t.Fatal("a missing interpreter must be explained")
	}
	for _, options := range []string{`{"script":"../x.ps1"}`, `{"script":"tools"}`, `{}`, `{"script":"-c"}`} {
		if _, err := ps.CommandSpec(run.Request{Kind: KindScript, Root: root, WorkingDirectory: root, LanguageOptions: []byte(options)}); err == nil {
			t.Fatalf("%s must be refused", options)
		}
	}
}

func TestManifestsBecomeProjectUnits(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "native", "CMakeLists.txt"))
	write(t, filepath.Join(root, "native", "lib", "CMakeLists.txt")) // add_subdirectory: same project
	write(t, filepath.Join(root, "api", "Api.csproj"))
	write(t, filepath.Join(root, "web", "composer.json"))
	write(t, filepath.Join(root, "apps", "a", "mix.exs"))
	write(t, filepath.Join(root, "apps", "b", "mix.exs")) // umbrella apps: one unit each

	cases := map[string][]string{"cpp": {"native"}, "csharp": {"api"}, "php": {"web"}, "elixir": {filepath.Join("apps", "a"), filepath.Join("apps", "b")}, "yaml": nil}
	for id, want := range cases {
		units, err := byLanguage(t, id).(language.ProjectDetector).DetectUnits(context.Background(), root)
		if err != nil || len(units) != len(want) {
			t.Fatalf("%s: %+v %v", id, units, err)
		}
		for i, unit := range units {
			if unit.Root != filepath.Join(root, want[i]) || unit.Kind != UnitProject || unit.Language != id {
				t.Fatalf("%s: %+v", id, unit)
			}
		}
	}
	if _, ok := byLanguage(t, "cpp").(language.UnitScanner); !ok {
		t.Fatal("rows share the registry's single walk")
	}
	_ = project.Unit{}
}
