package codestudio

import (
	"encoding/json"
	"os/exec"
	"testing"

	"adomnia/internal/languages/python"
)

func TestPythonConfigurationUsesRegisteredAdapter(t *testing.T) {
	interpreter, err := exec.LookPath("python")
	if err != nil {
		t.Skip("Python unavailable")
	}
	root := t.TempDir()
	writeFixtureFiles(t, root, map[string]string{"app.py": "print('python host')\n"})
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	options, _ := json.Marshal(python.Options{Interpreter: interpreter, Script: "app.py"})
	saved, err := service.SaveRunConfiguration(string(session.ID), RunConfiguration{Name: "Python script", Language: python.ID, Kind: "script", LanguageOptions: options})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartConfiguredRun(string(session.ID), saved.ID, nil); err == nil {
		t.Fatal("untrusted project launched Python")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	spec, err := service.runCommandSpec(session.ID, "script", root, ".", RunRequest{Language: python.ID, LanguageOptions: saved.LanguageOptions})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Executable != interpreter || len(spec.Arguments) != 2 {
		t.Fatalf("unexpected Python command: %+v", spec)
	}
	if _, err := service.StartConfiguredRun(string(session.ID), saved.ID, nil); err != nil {
		t.Fatal(err)
	}
}

// TestPythonEnvironmentPlanIsReadOnly: la descrizione dell'ambiente è statica e le due azioni
// restano esplicite; senza conferma o con un ambiente già esistente non parte nessun processo.
func TestPythonEnvironmentPlanIsReadOnly(t *testing.T) {
	root := t.TempDir()
	writeFixtureFiles(t, root, map[string]string{
		"ml/pyproject.toml":           "[project]\nname = 'ml'\nrequires-python = '>=3.10'\n",
		"ml/requirements.txt":         "pytest==9.1.1\n",
		"ml/.venv/Scripts/python.exe": "",
		"ml/app.py":                   "print('hi')\n",
	})
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	plan, err := service.PythonEnvironment(string(session.ID), "ml")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Root != "ml" || !plan.Exists || plan.RequiresPython != ">=3.10" {
		t.Fatalf("plan %+v", plan)
	}
	if !plan.Install.Available || plan.Create.Available {
		t.Fatalf("plan %+v", plan)
	}
	if _, err := service.CreatePythonEnvironment(string(session.ID), "ml", "", false); err == nil {
		t.Fatal("creating an environment without confirmation must fail")
	}
	if runs, _ := service.ListRuns(string(session.ID)); len(runs) != 0 {
		t.Fatalf("no process may start here: %#v", runs)
	}
}
