package java

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/project"
)

func TestDatasourcesFollowProfilesAndOverrides(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{
		"src/main/resources/application.properties": `spring.profiles.active=prod
spring.datasource.url=jdbc:postgresql://localhost:5432/orders
spring.datasource.username=app
spring.datasource.password=dev-secret
`,
		"src/main/resources/application-prod.properties": `spring.datasource.url=jdbc:postgresql://db.internal:5433/orders
spring.datasource.username=prod-app
`,
	})

	language := New()
	databases := language.ConfiguredDatabases(project.Unit{Root: root})
	if len(databases) != 2 {
		t.Fatalf("databases: %+v", databases)
	}

	base, prod := databases[0], databases[1]
	if base.Profile != "" || base.Active {
		t.Fatalf("base profile: %+v", base)
	}
	if base.Host != "localhost" || base.Port != 5432 || base.Database != "orders" {
		t.Fatalf("base target: %+v", base)
	}
	if prod.Profile != "prod" || !prod.Active {
		t.Fatalf("prod profile: %+v", prod)
	}
	if prod.Host != "db.internal" || prod.Port != 5433 || prod.User != "prod-app" {
		t.Fatalf("prod override: %+v", prod)
	}
	// La password del profilo base resta valida per il profilo che non la ridefinisce.
	if !prod.PasswordConfigured {
		t.Fatalf("prod should inherit the declared password presence: %+v", prod)
	}
	if prod.File != "src/main/resources/application-prod.properties" || prod.Line == 0 {
		t.Fatalf("prod source: %+v", prod)
	}
	if prod.Driver != "postgres" {
		t.Fatalf("driver: %+v", prod)
	}
	if prod.Name != "PostgreSQL · orders (prod)" {
		t.Fatalf("name: %q", prod.Name)
	}
}

func TestDatasourcesSeparateHostPortAndDriverClass(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{
		"src/main/resources/application.yml": `spring:
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    host: mysql
    port: 3307
    database: billing
    username: billing
`,
	})

	databases := New().ConfiguredDatabases(project.Unit{Root: root})
	if len(databases) != 1 {
		t.Fatalf("databases: %+v", databases)
	}
	database := databases[0]
	if database.Driver != "mysql" || database.Vendor != "mysql" {
		t.Fatalf("vendor from driver class: %+v", database)
	}
	if database.Host != "mysql" || database.Port != 3307 || database.Database != "billing" || database.User != "billing" {
		t.Fatalf("fields: %+v", database)
	}
}

func TestDatasourcesKeepPlaceholdersUnresolved(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{
		"src/main/resources/application.properties": `spring.datasource.url=jdbc:postgresql://${DB_HOST}:5432/orders
spring.datasource.username=${DB_USER}
spring.datasource.password=${DB_PASSWORD}
`,
	})

	databases := New().ConfiguredDatabases(project.Unit{Root: root})
	if len(databases) != 1 {
		t.Fatalf("databases: %+v", databases)
	}
	database := databases[0]
	if database.Host != "" || database.User != "" || database.Database != "" {
		t.Fatalf("placeholders must not become values: %+v", database)
	}
	if database.PasswordConfigured {
		t.Fatalf("unresolved password is not a usable credential: %+v", database)
	}
	want := []string{"url", "username", "password"}
	if strings.Join(database.Unresolved, ",") != strings.Join(want, ",") {
		t.Fatalf("unresolved = %v want %v", database.Unresolved, want)
	}
}

func TestDatasourcesNeverSerializeThePassword(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{
		"src/main/resources/application.properties": `spring.datasource.url=jdbc:mariadb://db:3306/shop
spring.datasource.password=super-secret-value
`,
	})

	databases := New().ConfiguredDatabases(project.Unit{Root: root})
	if len(databases) != 1 || !databases[0].PasswordConfigured {
		t.Fatalf("databases: %+v", databases)
	}
	if databases[0].Driver != "mysql" {
		t.Fatalf("mariadb uses the mysql driver: %+v", databases[0])
	}
	encoded, err := json.Marshal(databases)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "super-secret-value") {
		t.Fatalf("password leaked into JSON: %s", encoded)
	}
}

func TestDatasourcesReportUnsupportedVendorsWithoutADriver(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{
		"src/main/resources/application.properties": `spring.datasource.url=jdbc:sqlserver://sql:1433;databaseName=warehouse
`,
	})

	databases := New().ConfiguredDatabases(project.Unit{Root: root})
	if len(databases) != 1 {
		t.Fatalf("databases: %+v", databases)
	}
	database := databases[0]
	if database.Vendor != "sqlserver" || database.Driver != "" {
		t.Fatalf("unsupported vendor: %+v", database)
	}
	if database.Host != "sql" || database.Port != 1433 || database.Database != "warehouse" {
		t.Fatalf("sqlserver target: %+v", database)
	}
	if database.Name != "Microsoft SQL Server · warehouse" {
		t.Fatalf("name: %q", database.Name)
	}
}

func TestDatasourcesResolveSQLitePathsAgainstTheUnit(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{
		"src/main/resources/application.properties": `spring.datasource.url=jdbc:sqlite:./data/app.db
`,
	})

	databases := New().ConfiguredDatabases(project.Unit{Root: root})
	if len(databases) != 1 {
		t.Fatalf("databases: %+v", databases)
	}
	want := filepath.Join(root, "data", "app.db")
	if databases[0].Driver != "sqlite" || databases[0].Database != want {
		t.Fatalf("sqlite path: %+v want %s", databases[0], want)
	}
}

func TestDatasourcesIgnoreProjectsWithoutSpringDatasource(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{
		"src/main/resources/application.properties": `server.port=8080
spring.application.name=orders
`,
	})
	if databases := New().ConfiguredDatabases(project.Unit{Root: root}); len(databases) != 0 {
		t.Fatalf("databases: %+v", databases)
	}
}

func TestParseJdbcURLKeepsKnownTargets(t *testing.T) {
	cases := []struct {
		raw      string
		vendor   string
		host     string
		port     int
		database string
		sslMode  string
	}{
		{"jdbc:postgresql://db:5432/orders?sslmode=require", "postgresql", "db", 5432, "orders", "require"},
		{"jdbc:mysql://[::1]:3306/shop", "mysql", "::1", 3306, "shop", ""},
		{"jdbc:postgresql://db/orders", "postgresql", "db", 0, "orders", ""},
		{"jdbc:h2:mem:test", "h2", "", 0, "", ""},
		{"jdbc:sqlite::memory:", "sqlite", "", 0, ":memory:", ""},
	}
	for _, testCase := range cases {
		target, ok := parseJdbcURL(testCase.raw)
		if !ok {
			t.Fatalf("%s: not parsed", testCase.raw)
		}
		if target.vendor != testCase.vendor || target.host != testCase.host || target.port != testCase.port ||
			target.database != testCase.database || target.sslMode != testCase.sslMode {
			t.Fatalf("%s: %+v", testCase.raw, target)
		}
	}
	if _, ok := parseJdbcURL("not-a-jdbc-url"); ok {
		t.Fatal("a plain string must not be parsed as JDBC")
	}
}
