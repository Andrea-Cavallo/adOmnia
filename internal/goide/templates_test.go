package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func stubCustomTemplatesRoot(t *testing.T, root string) {
	previous := customTemplatesRoot
	customTemplatesRoot = func() (string, error) { return root, nil }
	t.Cleanup(func() { customTemplatesRoot = previous })
}

func TestPackageNameFor(t *testing.T) {
	cases := map[string]string{"example.com/hello-lib": "hellolib", "x/123": "lib123", "Foo": "foo", "a/-": "lib"}
	for input, want := range cases {
		if got := packageNameFor(input); got != want {
			t.Errorf("packageNameFor(%q) = %q, want %q", input, got, want)
		}
	}
}

// Ogni template integrato deve produrre un modulo che compila e passa i propri test.
func TestBuiltinTemplatesBuildAndTest(t *testing.T) {
	binary, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go non disponibile")
	}
	stubCustomTemplatesRoot(t, t.TempDir())
	for _, template := range builtinTemplates {
		t.Run(template.ID, func(t *testing.T) {
			parent := t.TempDir()
			result, err := NewService(&memoryStore{}, nil).CreateProject(CreateProjectRequest{ParentPath: parent, Name: "demo-" + template.ID, ModulePath: "example.com/demo-" + template.ID, Template: template.ID, Confirmed: true})
			if err != nil {
				t.Fatal(err)
			}
			if result.Warning != "" {
				t.Skipf("dipendenze non risolte (offline?): %s", result.Warning)
			}
			dir := filepath.Join(parent, "demo-"+template.ID)
			if template.ID == emptyProjectTemplate {
				return
			}
			if _, err := os.Stat(filepath.Join(dir, ".gitignore")); err != nil {
				t.Fatalf(".gitignore comune mancante: %v", err)
			}
			for _, args := range [][]string{{"vet", "./..."}, {"test", "./..."}} {
				if err := runGoCommand(binary, dir, templateTidyTimeout, args...); err != nil {
					t.Fatal(err)
				}
			}
			data, _ := os.ReadFile(filepath.Join(dir, "go.mod"))
			for _, requirement := range template.Requires {
				if !strings.Contains(string(data), strings.Split(requirement, "@")[0]) {
					t.Fatalf("go.mod senza %s:\n%s", requirement, data)
				}
			}
		})
	}
}

func TestCustomTemplateReplacesPlaceholdersAndSkipsGit(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go non disponibile")
	}
	root := t.TempDir()
	stubCustomTemplatesRoot(t, root)
	custom := filepath.Join(root, "mine")
	for name, content := range map[string]string{
		"cmd/__NAME__/main.go": "package main\n\nimport _ \"__MODULE__/internal/x\"\n\nfunc main() {}\n",
		"internal/x/x.go":      "package x\n",
		".git/config":          "secret",
	} {
		path := filepath.Join(custom, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(&memoryStore{}, nil)
	list, err := service.ListProjectTemplates()
	if err != nil || list.CustomDirectory != root || list.Templates[len(list.Templates)-1].ID != "custom:mine" {
		t.Fatalf("custom template non elencato: %+v %v", list, err)
	}
	parent := t.TempDir()
	if _, err := service.CreateProject(CreateProjectRequest{ParentPath: parent, Name: "app", ModulePath: "example.com/app", Template: "custom:mine", Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(parent, "app", "cmd", "app", "main.go"))
	if err != nil || !strings.Contains(string(data), `"example.com/app/internal/x"`) {
		t.Fatalf("segnaposto non sostituiti: %s %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(parent, "app", ".git")); !os.IsNotExist(err) {
		t.Fatal(".git del template non deve essere copiata")
	}
	if _, err := service.CreateProject(CreateProjectRequest{ParentPath: parent, Name: "bad", ModulePath: "example.com/bad", Template: "custom:../x", Confirmed: true}); err == nil {
		t.Fatal("template con percorso esterno accettato")
	}
	if _, err := os.Stat(filepath.Join(parent, "bad")); !os.IsNotExist(err) {
		t.Fatal("cartella creata nonostante il template non valido")
	}
}
