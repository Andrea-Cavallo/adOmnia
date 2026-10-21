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
