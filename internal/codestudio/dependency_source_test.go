package codestudio

import (
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/project"
	golang "adomnia/internal/languages/golang"
)

// TestResolveDependencySourceLocalReplace: una replace locale punta al codice giusto, dentro o
// fuori dal progetto, e i file navigabili arrivano dalla cartella scelta.
func TestResolveDependencySourceLocalReplace(t *testing.T) {
	workspace := t.TempDir()
	app := filepath.Join(workspace, "app")
	lib := filepath.Join(workspace, "lib")
	writeFixtureFile(t, app, "go.mod", "module example.com/app\n\ngo 1.22\n\nrequire example.com/lib v1.0.0\n\nreplace example.com/lib => ../lib\n")
	writeFixtureFile(t, lib, "go.mod", "module example.com/lib\n\ngo 1.22\n")
	writeFixtureFile(t, lib, "doc.go", "package lib\n\nconst Version = \"dev\"\n")
	writeFixtureFile(t, lib, "lib.go", "package lib\n\nfunc Hello() string { return \"hi\" }\n")

	source, err := resolveDependencySource(testSession(app).Project, "", "example.com/lib", "")
	if err != nil {
		t.Fatal(err)
	}
	if !source.Found || !source.Replaced || source.Kind != "local" {
		t.Fatalf("replace locale non riconosciuta: %#v", source)
	}
	resolved, _ := filepath.EvalSymlinks(lib)
	if source.Directory != resolved {
		t.Fatalf("cartella sorgente %q, attesa %q", source.Directory, resolved)
	}
	if source.EntryFile != filepath.Join(resolved, "doc.go") {
		t.Fatalf("file di ingresso %q", source.EntryFile)
	}
	if source.RelativeDir != "" || source.EntryRelative != "" {
		t.Fatalf("il sorgente è fuori dal progetto, relativi inattesi: %#v", source)
	}
	if !source.Downloaded || len(source.Files) < 3 {
		t.Fatalf("file del modulo incompleti: %#v", source.Files)
	}
	if source.Files[0].Name != "doc.go" {
		t.Fatalf("file ordinati dalla radice: %#v", source.Files)
	}
}

// TestResolveDependencySourceInsideProject: un modulo del progetto si apre come codice proprio.
func TestResolveDependencySourceInsideProject(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/app\n\ngo 1.22\n\nrequire example.com/lib v1.0.0\n")
	writeFixtureFile(t, root, "lib/go.mod", "module example.com/lib\n\ngo 1.22\n")
	writeFixtureFile(t, root, "lib/lib.go", "package lib\n\nfunc Hello() string { return \"hi\" }\n")
	session := testSession(root)
	session.Project.Units = []project.Unit{
		{Language: golang.ID, Kind: golang.UnitModule, Root: root, Name: "example.com/app", Manifest: filepath.Join(root, "go.mod")},
		{Language: golang.ID, Kind: golang.UnitModule, Root: filepath.Join(root, "lib"), Name: "example.com/lib", Manifest: filepath.Join(root, "lib", "go.mod")},
	}

	source, err := resolveDependencySource(session.Project, "", "example.com/lib", "")
	if err != nil {
		t.Fatal(err)
	}
	if !source.Found || source.Kind != "project" || source.RelativeDir != "lib" {
		t.Fatalf("modulo del progetto non riconosciuto: %#v", source)
	}
	if source.EntryRelative != "lib/lib.go" {
		t.Fatalf("file di ingresso relativo %q, atteso lib/lib.go", source.EntryRelative)
	}
}

// TestResolveDependencySourceModuleCache: il modulo remoto risolve nella module cache, e senza
// download dichiara cosa manca invece di fallire.
func TestResolveDependencySourceModuleCache(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/app\n\ngo 1.22\n\nrequire example.com/direct v1.2.3\n\nrequire example.com/missing v0.9.0 // indirect\n")
	modCache := t.TempDir()
	cached := filepath.Join(modCache, "example.com", "direct@v1.2.3")
	writeFixtureFile(t, cached, "go.mod", "module example.com/direct\n\ngo 1.22\n")
	writeFixtureFile(t, cached, "direct.go", "package direct\n\nconst Name = \"direct\"\n")
	session := testSession(root)

	source, err := resolveDependencySource(session.Project, "", "example.com/direct", modCache)
	if err != nil {
		t.Fatal(err)
	}
	if !source.Found || !source.Downloaded || source.Kind != "module-cache" || source.Version != "v1.2.3" {
		t.Fatalf("modulo in cache non risolto: %#v", source)
	}
	if source.EntryFile != filepath.Join(cached, "direct.go") || len(source.Files) != 2 {
		t.Fatalf("contenuto cache inatteso: %#v", source)
	}

	missing, err := resolveDependencySource(session.Project, "", "example.com/missing", modCache)
	if err != nil {
		t.Fatal(err)
	}
	if !missing.Found || missing.Downloaded || !strings.Contains(missing.Reason, "download") {
		t.Fatalf("modulo non scaricato: %#v", missing)
	}

	unknown, err := resolveDependencySource(session.Project, "", "example.com/unknown", modCache)
	if err != nil {
		t.Fatal(err)
	}
	if unknown.Found {
		t.Fatalf("modulo assente dal go.mod: %#v", unknown)
	}
}

// TestDependencySourceActions: il download riguarda il singolo modulo da leggere.
func TestDependencySourceActions(t *testing.T) {
	arguments, err := dependencyArguments(DependencyActionRequest{Action: "download", ModulePath: "example.com/direct"}, t.TempDir())
	if err != nil || strings.Join(arguments, " ") != "mod download example.com/direct" {
		t.Fatalf("download singolo modulo: %v %v", arguments, err)
	}
	arguments, err = dependencyArguments(DependencyActionRequest{Action: "download"}, t.TempDir())
	if err != nil || strings.Join(arguments, " ") != "mod download" {
		t.Fatalf("download del modulo: %v %v", arguments, err)
	}
}

// TestLocalDependencyRoots: le replace locali aprono in sola lettura come la module cache.
func TestLocalDependencyRoots(t *testing.T) {	workspace := t.TempDir()
	app := filepath.Join(workspace, "app")
	lib := filepath.Join(workspace, "lib")
	writeFixtureFile(t, app, "go.mod", "module example.com/app\n\ngo 1.22\n\nrequire example.com/lib v1.0.0\n\nreplace example.com/lib => ../lib\n")
	writeFixtureFile(t, lib, "go.mod", "module example.com/lib\n\ngo 1.22\n")

	roots := localDependencyRoots(testSession(app).Project)
	resolved, _ := filepath.EvalSymlinks(lib)
	if len(roots) != 1 || roots[0] != resolved {
		t.Fatalf("radici locali %v, attesa %q", roots, resolved)
	}
}

// TestResolveDependencySourceGoWork: un modulo `use` dal go.work, anche fuori dal progetto, ha il
// suo sorgente locale come il workspace che lo compila.
func TestResolveDependencySourceGoWork(t *testing.T) {
	workspace := t.TempDir()
	app := filepath.Join(workspace, "app")
	lib := filepath.Join(workspace, "lib")
	writeFixtureFile(t, app, "go.mod", "module example.com/app\n\ngo 1.22\n\nrequire example.com/lib v1.0.0\n")
	writeFixtureFile(t, app, "go.work", "go 1.22\n\nuse ../lib\n")
	writeFixtureFile(t, lib, "go.mod", "module example.com/lib\n\ngo 1.22\n")
	writeFixtureFile(t, lib, "lib.go", "package lib\n\nfunc Hello() string { return \"hi\" }\n")

	source, err := resolveDependencySource(testSession(app).Project, "", "example.com/lib", "")
	if err != nil {
		t.Fatal(err)
	}
	resolved, _ := filepath.EvalSymlinks(lib)
	if !source.Found || source.Directory != resolved || source.EntryRelative != "" {
		t.Fatalf("modulo del go.work non risolto: %#v", source)
	}
	roots := localDependencyRoots(testSession(app).Project)
	if len(roots) != 1 || roots[0] != resolved {
		t.Fatalf("radici locali %v, attesa %q", roots, resolved)
	}
}
