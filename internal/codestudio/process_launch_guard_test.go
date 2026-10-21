package codestudio

import (
	"encoding/json"
	"strings"
	"testing"
)

// No provider (Go, web, Java, Python, generic command, compound) may start a process before the user
// authorized the tooling of the project: every launch path goes through the trust gate.
func TestNoLaunchWithoutToolAuthorization(t *testing.T) {
	project := t.TempDir()
	writeFixtureFiles(t, project, map[string]string{
		"orders/go.mod":    "module example.com/orders\n\ngo 1.26\n",
		"web/package.json": `{"name":"web","scripts":{"dev":"vite"}}`,
		"billing/pom.xml":  "<project><modelVersion>4.0.0</modelVersion><groupId>x</groupId><artifactId>b</artifactId><version>1</version></project>",
		"ml/pyproject.toml": "[project]\nname = 'ml'\n",
		"ml/app.py":        "print('hi')\n",
	})
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	configs := []RunConfiguration{
		{Name: "go", Kind: RunKindGoTool, Target: "version", WorkingDirectory: "orders"},
		{Name: "node", Language: "typescript", Kind: RunKindCommand, Target: "pnpm", ProgramArguments: []string{"run", "dev"}, WorkingDirectory: "web"},
		{Name: "java", Language: "java", Kind: RunKindCommand, Target: "mvn", ProgramArguments: []string{"-v"}, WorkingDirectory: "billing"},
		{Name: "script", Kind: RunKindCommand, Target: "bash", ProgramArguments: []string{"scripts/up.sh"}},
		{Name: "py-script", Language: "python", Kind: "script", WorkingDirectory: "ml", LanguageOptions: json.RawMessage(`{"script":"app.py"}`)},
		{Name: "py-module", Language: "python", Kind: "module", WorkingDirectory: "ml", LanguageOptions: json.RawMessage(`{"module":"app"}`)},
	}
	var ids []string
	for _, config := range configs {
		saved, err := service.SaveRunConfiguration(id, config)
		if err != nil {
			t.Fatalf("save %s: %v", config.Name, err)
		}
		ids = append(ids, saved.ID)
	}
	compound, err := service.SaveRunConfiguration(id, RunConfiguration{Name: "all", Kind: RunKindCompound, Compound: ids[:2]})
	if err != nil {
		t.Fatal(err)
	}
	for _, configID := range append(ids, compound.ID) {
		_, err := service.StartConfiguredRun(id, configID, nil)
		if err == nil || !strings.Contains(err.Error(), "authorize") {
			t.Errorf("configuration %s started without authorization: %v", configID, err)
		}
	}
	// Anche test strutturati e debug Python passano dalla stessa autorizzazione.
	if _, err := service.StartTests(TestRunRequest{SessionID: session.ID, Language: "python", WorkingDirectory: "ml"}); err == nil || !strings.Contains(err.Error(), "authorize") {
		t.Errorf("python tests started without authorization: %v", err)
	}
	if _, err := service.StartPythonDebug(PythonDebugRequest{SessionID: session.ID, Kind: "script", Script: "app.py", WorkingDirectory: "ml"}); err == nil || !strings.Contains(err.Error(), "authorize") {
		t.Errorf("python debug started without authorization: %v", err)
	}
	runs, _ := service.ListRuns(id)
	if len(runs) != 0 {
		t.Fatalf("no process may exist before authorization: %#v", runs)
	}
}
