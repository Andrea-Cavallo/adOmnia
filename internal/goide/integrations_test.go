package goide

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestDetectProjectServicesUsesDirectDependenciesOnly(t *testing.T) {
	services := detectProjectServices([]GoDependency{
		{Path: "github.com/jackc/pgx/v5"},
		{Path: "github.com/lib/pq"},
		{Path: "github.com/redis/go-redis/v9"},
		{Path: "github.com/segmentio/kafka-go", Indirect: true},
		{Path: "github.com/jackc/pgxpool"},
	})
	want := []ProjectService{
		{ID: "postgres", Name: "PostgreSQL", Kind: "database", Modules: []string{"github.com/jackc/pgx/v5", "github.com/lib/pq"}},
		{ID: "redis", Name: "Redis", Kind: "cache", Modules: []string{"github.com/redis/go-redis/v9"}},
	}
	if !reflect.DeepEqual(services, want) {
		t.Fatalf("services = %#v, want %#v", services, want)
	}
}

func TestProjectServicesReadsEveryModule(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "go.mod"), "module example.com/api\n\ngo 1.22\n\nrequire go.mongodb.org/mongo-driver v1.17.0\n")
	writeFile(t, filepath.Join(root, "main.go"), "package main\n\nfunc main() {}\n")
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = service.CloseSession(string(session.ID)) }()
	services, err := service.ProjectServices(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(services) != 1 || services[0].ID != "mongodb" {
		t.Fatalf("services = %#v", services)
	}
}

func TestPluginEventForExposesOnlyTheContract(t *testing.T) {
	exitCode := 1
	cases := []struct {
		event EventEnvelope
		name  string
		field string
		value any
	}{
		{EventEnvelope{Type: "session.opened", SessionID: "s1", Payload: Session{ID: "s1", Project: Project{Name: "api", RootPath: "/p"}}}, PluginEventProjectOpen, "projectName", "api"},
		{EventEnvelope{Type: "session.closed", SessionID: "s1"}, PluginEventProjectClose, "sessionId", "s1"},
		{EventEnvelope{Type: "document.saved", SessionID: "s1", Payload: Document{RelativePath: "main.go", Language: "go"}}, PluginEventSave, "relativePath", "main.go"},
		{EventEnvelope{Type: "run.finished", SessionID: "s1", Payload: Execution{SessionID: "s1", Kind: "test", Status: "failed", ExitCode: &exitCode}}, PluginEventRunFinished, "exitCode", 1},
	}
	for _, testCase := range cases {
		name, payload, ok := PluginEventFor(testCase.event)
		if !ok || name != testCase.name || payload[testCase.field] != testCase.value || payload["contract"] != PluginContractVersion {
			t.Fatalf("%s: got %q %#v %v", testCase.event.Type, name, payload, ok)
		}
		if _, leaked := payload["content"]; leaked {
			t.Fatalf("%s: payload leaks file content", testCase.event.Type)
		}
	}
	for _, ignored := range []EventEnvelope{
		{Type: "run.output"},
		{Type: "document.saved", Payload: Document{External: true}},
		{Type: "lsp.diagnostics"},
	} {
		if _, _, ok := PluginEventFor(ignored); ok {
			t.Fatalf("%s should not reach plugins", ignored.Type)
		}
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
