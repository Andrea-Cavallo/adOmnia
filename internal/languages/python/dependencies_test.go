package python

import (
	"os"
	"path/filepath"
	"testing"
)

func writeDependencyFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// La vista delle dipendenze legge i manifest come li legge l'adapter: vincolo dichiarato, versione
// esatta solo con `==`, riga per aprire il file, gruppi di sviluppo marcati.
func TestDeclaredDependenciesReadsRequirements(t *testing.T) {
	root := t.TempDir()
	writeDependencyFile(t, filepath.Join(root, "requirements.txt"), "# runtime\nfastapi==0.115.0\nuvicorn>=0.30\nrequests[socks]==2.32.3  # client\n")
	writeDependencyFile(t, filepath.Join(root, "requirements-dev.txt"), "pytest==8.3.0\n")

	dependencies := DeclaredDependencies(root)
	byName := map[string]DeclaredDependency{}
	for _, dependency := range dependencies {
		byName[dependency.Name] = dependency
	}
	if got := byName["fastapi"]; got.Version != "0.115.0" || got.Spec != "==0.115.0" || got.Line != 2 || got.Source != "requirements.txt" {
		t.Fatalf("fastapi = %+v", got)
	}
	if got := byName["uvicorn"]; got.Version != "" || got.Spec != ">=0.30" {
		t.Fatalf("uvicorn must stay unpinned: %+v", got)
	}
	if got := byName["requests"]; got.Version != "2.32.3" {
		t.Fatalf("requests = %+v", got)
	}
	if got := byName["pytest"]; !got.Dev || got.Source != "requirements-dev.txt" {
		t.Fatalf("pytest must be a dev dependency: %+v", got)
	}
	if len(dependencies) != 4 {
		t.Fatalf("dependencies = %#v", dependencies)
	}
}

func TestDeclaredDependenciesReadsPyprojectAndLockfile(t *testing.T) {
	root := t.TempDir()
	writeDependencyFile(t, filepath.Join(root, "pyproject.toml"), `[project]
name = "shop-api"
dependencies = [
  "fastapi==0.115.0",
  "pydantic>=2.8",
]

[dependency-groups]
dev = ["pytest==8.3.0"]

[tool.poetry.dependencies]
celery = "5.4.0"
`)
	writeDependencyFile(t, filepath.Join(root, "poetry.lock"), `[[package]]
name = "fastapi"
version = "0.115.1"

[[package]]
name = "pytest"
version = "8.3.1"

[[package]]
name = "starlette"
version = "0.38.2"
`)
	dependencies := DeclaredDependencies(root)
	byName := map[string]DeclaredDependency{}
	for _, dependency := range dependencies {
		byName[dependency.Name] = dependency
	}
	if got := byName["fastapi"]; got.Version != "0.115.0" || got.Resolved != "0.115.1" || got.Line != 4 {
		t.Fatalf("fastapi = %+v", got)
	}
	if got := byName["pydantic"]; got.Version != "" || got.Line != 5 {
		t.Fatalf("pydantic = %+v", got)
	}
	if got := byName["pytest"]; !got.Dev || got.Resolved != "8.3.1" {
		t.Fatalf("pytest = %+v", got)
	}
	if got := byName["celery"]; got.Version != "5.4.0" || got.Source != "pyproject.toml" {
		t.Fatalf("celery = %+v", got)
	}
	// starlette è solo nel lockfile: la vista mostra ciò che il progetto dichiara.
	if _, ok := byName["starlette"]; ok {
		t.Fatal("lockfile-only packages must not appear as declared dependencies")
	}
}

func TestLockedVersionsReadsUVLockAndSkipsTheProject(t *testing.T) {
	root := t.TempDir()
	writeDependencyFile(t, filepath.Join(root, "uv.lock"), `version = 1

[[package]]
name = "shop-api"
version = "0.1.0"
source = { editable = "." }

[[package]]
name = "Redis"
version = "5.0.8"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "requests"
version = "2.32.3"
source = { registry = "https://pypi.org/simple" }
`)
	versions := LockedVersions(root)
	if versions["redis"] != "5.0.8" || versions["requests"] != "2.32.3" {
		t.Fatalf("versions = %#v", versions)
	}
	if _, ok := versions["shop-api"]; ok {
		t.Fatal("the project itself must not be a locked dependency")
	}
}

func TestDeclaredDependenciesWithoutManifest(t *testing.T) {
	if got := DeclaredDependencies(t.TempDir()); len(got) != 0 {
		t.Fatalf("no manifest must give no dependencies: %#v", got)
	}
}
