package devcontext

import "testing"

// I riferimenti a database Rust devono arrivare al Developer Context come entità table e
// datasource, nella stessa forma di quelle Go e delle migration SQL.
func TestDetectRustDatabaseFindsSqlxTables(t *testing.T) {
	src := []byte(`let rows = sqlx::query!("SELECT * FROM users WHERE id = $1").fetch_all(&pool).await?;
let orders = sqlx::query_as!(Order, "SELECT o.id FROM orders o JOIN items i ON i.order_id = o.id").fetch_all(&pool).await?;
`)
	entities := detectRustDatabase("src/main.rs", src)
	tables := map[string]bool{}
	for _, e := range entities {
		if e.Kind == "table" {
			tables[e.ID] = true
		}
	}
	for _, want := range []string{"table:users", "table:orders", "table:items"} {
		if !tables[want] {
			t.Fatalf("missing %s in %+v", want, entities)
		}
	}
}

func TestDetectRustDatabaseConnectionStringBecomesDatasource(t *testing.T) {
	src := []byte(`let pool = PgPoolOptions::new().connect("postgres://app:secret@db:5432/payments").await?;
`)
	entities := detectRustDatabase("src/main.rs", src)
	var ds Entity
	for _, e := range entities {
		if e.Kind == "datasource" {
			ds = e
		}
	}
	if ds.ID != "datasource:postgres@db:5432/payments" || ds.Attrs["type"] != "postgres" {
		t.Fatalf("datasource = %+v", ds)
	}
	if ds.Attrs["user"] != "app" || ds.Attrs["password"] != "" {
		t.Fatalf("datasource must carry the user and never the password: %+v", ds.Attrs)
	}
}

func TestDetectCargoConfigEnvDatasource(t *testing.T) {
	src := []byte(`[env]
DATABASE_URL = "postgres://app@localhost:5432/shop"
PORT = "8080"
`)
	entities := detectCargoConfig(".cargo/config.toml", src)
	if len(entities) != 1 || entities[0].ID != "datasource:postgres@localhost:5432/shop" {
		t.Fatalf("entities = %+v", entities)
	}
}

func TestDetectFileRoutesAndDatabaseTogether(t *testing.T) {
	src := []byte(`#[get("/health")]
async fn health() -> impl Responder { "ok" }

let rows = sqlx::query!("SELECT * FROM users").fetch_all(&pool).await?;
`)
	entities, warnings := detectFile("src/main.rs", src, nil, AdapterHints{})
	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}
	kinds := map[string]bool{}
	for _, e := range entities {
		kinds[e.Kind] = true
	}
	if !kinds["route"] || !kinds["table"] {
		t.Fatalf("a Rust file must yield routes and tables: %+v", kinds)
	}
}

func TestInterestingReadsCargoConfigOnly(t *testing.T) {
	if !interesting(".cargo/config.toml") {
		t.Fatal(".cargo/config.toml must be readable")
	}
	if interesting(".cargo/registry/something") || interesting("other/config.toml") {
		t.Fatal("only .cargo/config.toml is readable, not other config.toml or .cargo internals")
	}
}
