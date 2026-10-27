package codestudio

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

func TestDetectProjectServicesUsesDirectDependenciesOnly(t *testing.T) {
	services := detectProjectServices([]ServiceDependency{
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

func TestAttachConfiguredDatabasesMergesTheSameDriverOnlyOnce(t *testing.T) {
	services := detectProjectServices([]ServiceDependency{{Path: "github.com/jackc/pgx/v5"}})
	databases := []language.ConfiguredDatabase{
		{Name: "PostgreSQL · orders", Driver: "postgres", Host: "db", Port: 5432, Database: "orders"},
		{Name: "PostgreSQL · billing (prod)", Driver: "postgres", Host: "db", Port: 5432, Database: "billing", Profile: "prod"},
		{Name: "Microsoft SQL Server · warehouse", Vendor: "sqlserver", Host: "sql", Port: 1433, Database: "warehouse"},
	}
	merged := attachConfiguredDatabases(services, databases)
	if len(merged) != 2 {
		t.Fatalf("services = %#v", merged)
	}
	if merged[0].ID != "postgres" || len(merged[0].Databases) != 2 || merged[0].Modules == nil {
		t.Fatalf("postgres row = %#v", merged[0])
	}
	if merged[1].ID != "sqlserver" || merged[1].Kind != "database" || merged[1].Name != "Microsoft SQL Server · warehouse" {
		t.Fatalf("unsupported vendor row = %#v", merged[1])
	}
	if merged[1].Databases[0].Driver != "" {
		t.Fatalf("unsupported vendor must not get a driver: %#v", merged[1])
	}
}

func TestAttachConfiguredDatabasesCreatesARowWithoutDependencies(t *testing.T) {
	merged := attachConfiguredDatabases(nil, []language.ConfiguredDatabase{
		{Name: "PostgreSQL · orders", Driver: "postgres", Host: "db", Port: 5432, Database: "orders"},
	})
	want := []ProjectService{{
		ID: "postgres", Name: "PostgreSQL", Kind: "database",
		Databases: []language.ConfiguredDatabase{{Name: "PostgreSQL · orders", Driver: "postgres", Host: "db", Port: 5432, Database: "orders"}},
	}}
	if !reflect.DeepEqual(merged, want) {
		t.Fatalf("merged = %#v, want %#v", merged, want)
	}
}

func TestProjectServicesReadsTheSpringDatasource(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "pom.xml"), `<project><modelVersion>4.0.0</modelVersion><groupId>com.acme</groupId><artifactId>orders</artifactId><version>1.0.0</version></project>`)
	writeUnitDir(t, root, "src/main/resources")
	writeFile(t, filepath.Join(root, "src", "main", "resources", "application.properties"), "spring.datasource.url=jdbc:postgresql://localhost:5432/orders\nspring.datasource.username=app\nspring.datasource.password=secret\n")
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
	if len(services) != 1 || services[0].ID != "postgres" || services[0].Kind != "database" {
		t.Fatalf("services = %#v", services)
	}
	database := services[0].Databases
	if len(database) != 1 || database[0].Host != "localhost" || database[0].Port != 5432 || database[0].Database != "orders" || database[0].User != "app" {
		t.Fatalf("databases = %#v", database)
	}
	if !database[0].PasswordConfigured {
		t.Fatalf("password presence lost: %#v", database[0])
	}
	encoded, err := jsonutil.Marshal(services)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret") {
		t.Fatalf("password leaked into the binding payload: %s", encoded)
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

// Un progetto Python dichiara i servizi che usa nei manifest dell'unità: Project Services deve
// aprirli come per i moduli Go, senza sapere nulla dei formati Python.
func TestProjectServicesReadsPythonUnits(t *testing.T) {
	root := t.TempDir()
	writeUnitDir(t, root, "api")
	writeFile(t, filepath.Join(root, "api", "requirements.txt"), "fastapi==0.115.0\npsycopg[binary]==3.2.1\nPyMySQL>=1.1\nredis==5.0.8\npytest==8.3.0\n")
	writeFile(t, filepath.Join(root, "api", "main.py"), "from fastapi import FastAPI\n\napp = FastAPI()\n")
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
	want := []ProjectService{
		{ID: "postgres", Name: "PostgreSQL", Kind: "database", Modules: []string{"psycopg"}},
		{ID: "mysql", Name: "MySQL", Kind: "database", Modules: []string{"pymysql"}},
		{ID: "redis", Name: "Redis", Kind: "cache", Modules: []string{"redis"}},
	}
	if !reflect.DeepEqual(services, want) {
		t.Fatalf("services = %#v, want %#v", services, want)
	}
}

// Le dipendenze di sviluppo non descrivono i servizi che il programma usa a runtime.
func TestProjectServicesIgnoresPythonDevDependencies(t *testing.T) {
	root := t.TempDir()
	writeUnitDir(t, root, "app")
	writeFile(t, filepath.Join(root, "app", "pyproject.toml"), "[project]\nname = \"app\"\ndependencies = [\"asyncpg>=0.29\"]\n\n[dependency-groups]\ndev = [\"redis>=5\"]\n")
	writeFile(t, filepath.Join(root, "app", "main.py"), "print(1)\n")
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
	if len(services) != 1 || services[0].ID != "postgres" {
		t.Fatalf("services = %#v, want only postgres from runtime dependencies", services)
	}
}

// writeUnitDir crea la cartella di un'unità del progetto sotto root.
func writeUnitDir(t *testing.T, root, name string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, name), 0o755); err != nil {
		t.Fatal(err)
	}
}
