package pypi

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"adomnia/internal/securityintel"
)

// I requirements dichiarano versioni in molti modi: solo `==` è una versione risolta, e un
// intervallo non deve diventare un numero inventato.
func TestParseRequirementsKeepsOnlyExactPins(t *testing.T) {
	text := `# commento
flask==3.0.3
Django >=4.2,<5
requests[socks]==2.32.3  # client HTTP
uvicorn
-r other.txt
-e ./local
pkg-from-git @ git+https://example.com/repo.git
urllib3==2.2.2 ; python_version >= "3.9"
`
	requirements, warnings := parseRequirements(text, securityintel.ScopeCompile)
	want := []declaredRequirement{
		{name: "flask", version: "3.0.3", scope: securityintel.ScopeCompile},
		{name: "django", scope: securityintel.ScopeCompile},
		{name: "requests", version: "2.32.3", scope: securityintel.ScopeCompile},
		{name: "uvicorn", scope: securityintel.ScopeCompile},
		{name: "urllib3", version: "2.2.2", scope: securityintel.ScopeCompile},
	}
	if !reflect.DeepEqual(requirements, want) {
		t.Fatalf("requirements = %#v, want %#v", requirements, want)
	}
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	if scope := requirementsScope("requirements-dev.txt"); scope != securityintel.ScopeTest {
		t.Fatalf("requirements-dev.txt scope = %s", scope)
	}
	if scope := requirementsScope("requirements.txt"); scope != securityintel.ScopeCompile {
		t.Fatalf("requirements.txt scope = %s", scope)
	}
}

func TestParsePyprojectReadsPEP621(t *testing.T) {
	text := `[project]
name = "shop-api"
dependencies = [
  "fastapi==0.115.0",
  "pydantic>=2.8",
]

[project.optional-dependencies]
aws = ["boto3==1.35.0"]

[dependency-groups]
dev = ["pytest==8.3.0", "ruff"]
`
	requirements, _ := parsePyproject(text)
	want := []declaredRequirement{
		{name: "fastapi", version: "0.115.0", scope: securityintel.ScopeCompile},
		{name: "pydantic", scope: securityintel.ScopeCompile},
		{name: "boto3", version: "1.35.0", scope: securityintel.ScopeCompile},
		{name: "pytest", version: "8.3.0", scope: securityintel.ScopeTest},
		{name: "ruff", scope: securityintel.ScopeTest},
	}
	if !reflect.DeepEqual(requirements, want) {
		t.Fatalf("requirements = %#v, want %#v", requirements, want)
	}
	if name := pyprojectName(text); name != "shop-api" {
		t.Fatalf("project name = %q", name)
	}
}

func TestParsePyprojectReadsPoetryTables(t *testing.T) {
	text := `[tool.poetry]
name = "billing"
[tool.poetry.dependencies]
python = "^3.11"
requests = "2.32.3"
sqlalchemy = { version = "2.0.32", extras = ["asyncio"] }
celery = "^5.4"
[tool.poetry.group.dev.dependencies]
pytest = "8.3.0"
`
	requirements, _ := parsePyproject(text)
	want := []declaredRequirement{
		{name: "requests", version: "2.32.3", scope: securityintel.ScopeCompile},
		{name: "sqlalchemy", version: "2.0.32", scope: securityintel.ScopeCompile},
		{name: "celery", scope: securityintel.ScopeCompile},
		{name: "pytest", version: "8.3.0", scope: securityintel.ScopeTest},
	}
	if !reflect.DeepEqual(requirements, want) {
		t.Fatalf("requirements = %#v, want %#v", requirements, want)
	}
	if name := pyprojectName(text); name != "billing" {
		t.Fatalf("poetry project name = %q", name)
	}
}

// Il lockfile è la verità sulle versioni installate: gruppi dev e il progetto stesso (uv.lock) non
// diventano dipendenze.
func TestParseLockfileReadsPoetryAndUV(t *testing.T) {
	poetry := `[[package]]
name = "fastapi"
version = "0.115.0"
description = "web"
optional = false
category = "main"

[package.dependencies]
starlette = ">=0.37.2"

[[package]]
name = "pytest"
version = "8.3.0"
category = "dev"

[metadata]
lock-version = "2.0"
`
	packages, warnings := parseLockfile(poetry)
	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}
	want := []lockedPackage{{name: "fastapi", version: "0.115.0"}, {name: "pytest", version: "8.3.0", testScope: true}}
	if !reflect.DeepEqual(packages, want) {
		t.Fatalf("packages = %#v, want %#v", packages, want)
	}

	uv := `version = 1

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
`
	packages, warnings = parseLockfile(uv)
	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}
	if len(packages) != 2 || packages[0].name != "redis" || packages[1].name != "requests" {
		t.Fatalf("uv packages = %#v", packages)
	}
}

func TestDiscoverFindsPythonManifestsAndSkipsEnvironments(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "api", "requirements.txt"), "fastapi==0.115.0\n")
	writeFile(t, filepath.Join(root, "worker", "pyproject.toml"), "[project]\nname = \"worker\"\ndependencies = [\"celery==5.4.0\"]\n")
	writeFile(t, filepath.Join(root, "empty", "pyproject.toml"), "[build-system]\nrequires = [\"setuptools\"]\n")
	writeFile(t, filepath.Join(root, ".venv", "lib", "requirements.txt"), "anything==1.0\n")
	writeFile(t, filepath.Join(root, "node_modules", "pkg", "requirements.txt"), "anything==1.0\n")

	targets, err := New().Discover(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	var manifests []string
	for _, target := range targets {
		if target.Ecosystem != securityintel.EcosystemPyPI {
			t.Fatalf("ecosystem = %s", target.Ecosystem)
		}
		manifests = append(manifests, filepath.ToSlash(strings.TrimPrefix(target.Manifest, root)))
	}
	want := []string{"/api/requirements.txt", "/worker/pyproject.toml"}
	if !reflect.DeepEqual(manifests, want) {
		t.Fatalf("manifests = %v, want %v", manifests, want)
	}
	if targets[1].Name != "worker" {
		t.Fatalf("unit name = %q", targets[1].Name)
	}
}

// Con un lockfile si analizzano le versioni risolte, dipendenze transitive comprese, e le dirette
// arrivano dal manifest con il loro scope.
func TestResolveUsesTheResolvedLockfile(t *testing.T) {
	root := t.TempDir()
	manifest := filepath.Join(root, "pyproject.toml")
	writeFile(t, manifest, `[project]
name = "shop-api"
dependencies = ["fastapi==0.115.0"]
[dependency-groups]
dev = ["pytest==8.3.0"]
`)
	writeFile(t, filepath.Join(root, "poetry.lock"), `[[package]]
name = "fastapi"
version = "0.115.0"

[[package]]
name = "starlette"
version = "0.38.2"

[[package]]
name = "pytest"
version = "8.3.0"
groups = ["dev"]
`)
	target := securityintel.Target{Ecosystem: securityintel.EcosystemPyPI, Root: root, Manifest: manifest}
	resolution, err := New().Resolve(context.Background(), target, securityintel.DefaultResolveOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(resolution.Warnings) != 0 {
		t.Fatalf("warnings: %v", resolution.Warnings)
	}
	byName := map[string]securityintel.Component{}
	for _, component := range resolution.Components {
		byName[component.Name] = component
	}
	fastapi := byName["fastapi"]
	if !fastapi.Direct || fastapi.Origin != securityintel.OriginDeclared || fastapi.Scope != securityintel.ScopeCompile {
		t.Fatalf("fastapi component = %+v", fastapi)
	}
	starlette := byName["starlette"]
	if starlette.Direct || starlette.Origin != securityintel.OriginTransitive || starlette.Version != "0.38.2" {
		t.Fatalf("starlette component = %+v", starlette)
	}
	pytest := byName["pytest"]
	if pytest.Scope != securityintel.ScopeTest || !pytest.Direct {
		t.Fatalf("pytest component = %+v", pytest)
	}
	if purl := securityintel.PackageURL(starlette); purl != "pkg:pypi/starlette@0.38.2" {
		t.Fatalf("purl = %s", purl)
	}
}

// Senza lockfile si analizzano solo le versioni fissate, e il warning dice cosa manca invece di
// interrogare OSV per tutte le versioni.
func TestResolveWithoutLockfileWarnsAboutUnpinnedDependencies(t *testing.T) {
	root := t.TempDir()
	manifest := filepath.Join(root, "requirements.txt")
	writeFile(t, manifest, "fastapi==0.115.0\nuvicorn>=0.30\ncelery\n")
	target := securityintel.Target{Ecosystem: securityintel.EcosystemPyPI, Root: root, Manifest: manifest}
	resolution, err := New().Resolve(context.Background(), target, securityintel.DefaultResolveOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(resolution.Components) != 1 || resolution.Components[0].Name != "fastapi" || resolution.Components[0].Version != "0.115.0" {
		t.Fatalf("components = %#v", resolution.Components)
	}
	joined := strings.Join(resolution.Warnings, "\n")
	if !strings.Contains(joined, "2 dependencies are not pinned") || !strings.Contains(joined, "celery") || !strings.Contains(joined, "uvicorn") {
		t.Fatalf("warnings = %v", resolution.Warnings)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
