package python

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// venvInterpreter è il percorso dell'interprete dentro un ambiente, come lo crea la piattaforma.
var venvInterpreter = func() string {
	if runtime.GOOS == "windows" {
		return filepath.Join("Scripts", "python.exe")
	}
	return filepath.Join("bin", "python")
}()

func TestDetectEnvironmentManagerReadsOnlyManifests(t *testing.T) {
	for _, test := range []struct {
		name    string
		files   map[string]string
		manager string
		lock    string
	}{
		{name: "uv", files: map[string]string{"uv.lock": "", "pyproject.toml": "[project]\nname='a'\n"}, manager: ManagerUV, lock: "uv.lock"},
		{name: "poetry lock", files: map[string]string{"poetry.lock": ""}, manager: ManagerPoetry, lock: "poetry.lock"},
		{name: "poetry table", files: map[string]string{"pyproject.toml": "[tool.poetry]\nname='a'\n"}, manager: ManagerPoetry},
		{name: "pip project", files: map[string]string{"pyproject.toml": "[project]\nname='a'\n"}, manager: ManagerPip},
		{name: "requirements", files: map[string]string{"requirements.txt": "pytest\n"}, manager: ManagerPip},
		{name: "nothing", files: map[string]string{"app.py": ""}, manager: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			for name, text := range test.files {
				writeFile(t, root, name, text)
			}
			manager, lock := DetectEnvironmentManager(root)
			if manager != test.manager || lock != test.lock {
				t.Fatalf("manager=%q lock=%q, want %q %q", manager, lock, test.manager, test.lock)
			}
		})
	}
}

func TestEnvironmentPlanCreatesAndInstallsWithVisibleCommands(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "requirements.txt", "pytest==9.1.1\n")
	interpreter := writeFile(t, root, "python.exe", "")
	env := filepath.Join(root, ".venv")
	writeFile(t, root, filepath.Join(".venv", venvInterpreter), "")

	plan := PlanEnvironment(root, root, interpreter)
	if !plan.Exists || plan.Environment != env {
		t.Fatalf("an existing environment must be reported: %+v", plan)
	}
	if plan.Create.Available || plan.Create.Reason == "" {
		t.Fatalf("creating a second environment must be refused with a reason: %+v", plan.Create)
	}
	if !plan.Install.Available || !strings.Contains(plan.Install.Command, "-m pip install -r requirements.txt") {
		t.Fatalf("install command %+v", plan.Install)
	}
	if plan.Install.Executable != filepath.Join(env, venvInterpreter) {
		t.Fatalf("install must use the environment interpreter: %+v", plan.Install)
	}
}

func TestEnvironmentPlanRefusesToCreateFromItsOwnEnvironment(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "pyproject.toml", "[project]\nname='a'\n")
	inside := writeFile(t, root, filepath.Join(".venv", "Random", "python.exe"), "")
	plan := PlanEnvironment(root, root, inside)
	if plan.Create.Available || !strings.Contains(plan.Create.Reason, "outside the project environment") {
		t.Fatalf("plan %+v", plan.Create)
	}

	outside := writeFile(t, root, "python.exe", "")
	plan = PlanEnvironment(root, root, outside)
	if !plan.Create.Available || plan.Create.Command != "python.exe -m venv .venv" {
		t.Fatalf("plan %+v", plan.Create)
	}
}

func TestEnvironmentPlanInstallsEditableProjectAndExplainsMissingFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "pyproject.toml", "[project]\nname='a'\n")
	writeFile(t, root, filepath.Join(".venv", venvInterpreter), "")
	plan := PlanEnvironment(root, root, "")
	if !plan.Install.Available || !strings.Contains(plan.Install.Command, "pip install -e .") {
		t.Fatalf("plan %+v", plan.Install)
	}

	empty := t.TempDir()
	writeFile(t, empty, filepath.Join(".venv", venvInterpreter), "")
	plan = PlanEnvironment(empty, empty, "")
	if plan.Install.Available || !strings.Contains(plan.Install.Reason, "no requirements") {
		t.Fatalf("plan %+v", plan.Install)
	}
}

func TestEnvironmentPlanReportsUnitConstraints(t *testing.T) {
	root := t.TempDir()
	unit := filepath.Join(root, "ml")
	writeFile(t, unit, "pyproject.toml", "[project]\nname='ml'\nrequires-python = '>=3.11'\n")
	writeFile(t, unit, ".python-version", "# chosen version\n3.12.1\n")
	plan := PlanEnvironment(root, unit, "")
	if plan.Root != "ml" || plan.RequiresPython != ">=3.11" || plan.PythonVersion != "3.12.1" {
		t.Fatalf("plan %+v", plan)
	}
	if plan.Create.Available || !strings.Contains(plan.Create.Reason, "interpreter") {
		t.Fatalf("without an interpreter the creation is not proposed: %+v", plan.Create)
	}
}
