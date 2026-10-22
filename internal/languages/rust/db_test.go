package rust

import "testing"

func refsOf(t *testing.T, source string) []DatabaseRef {
	t.Helper()
	return DatabasesInFile("src/main.rs", []byte(source))
}

func TestSqlxTablesFromMacros(t *testing.T) {
	got := refsOf(t, `let rows = sqlx::query!("SELECT * FROM users WHERE id = $1").fetch_all(&pool).await?;
let orders = sqlx::query_as!(Order, "SELECT o.id FROM orders o JOIN items i ON i.order_id = o.id").fetch_all(&pool).await?;
`)
	names := map[string]bool{}
	for _, r := range got {
		names[r.Name] = true
	}
	for _, want := range []string{"users", "orders", "items"} {
		if !names[want] {
			t.Fatalf("missing table %q in %+v", want, got)
		}
	}
}

func TestDieselAndSeaOrmTables(t *testing.T) {
	diesel := refsOf(t, `table! {
    users (id) {
        id -> Integer,
        name -> Text,
    }
}`)
	if len(diesel) != 1 || diesel[0].Kind != "table" || diesel[0].Name != "users" {
		t.Fatalf("diesel = %+v", diesel)
	}

	sea := refsOf(t, `#[derive(DeriveEntityModel)]
#[sea_orm(table_name = "orders")]
pub struct Model { id: i32 }
`)
	if len(sea) != 1 || sea[0].Name != "orders" {
		t.Fatalf("sea-orm = %+v", sea)
	}
}

func TestConnectionStringsBecomeDatasources(t *testing.T) {
	got := refsOf(t, `let client = Client::with_uri_str("mongodb://localhost:27017").await?;
let pool = PgPoolOptions::new().connect("postgres://app:secret@db:5432/payments").await?;
`)
	var dsns []string
	for _, r := range got {
		if r.Kind == "datasource" {
			dsns = append(dsns, r.Name)
		}
	}
	if len(dsns) != 2 || dsns[0] != "mongodb://localhost:27017" || dsns[1] != "postgres://app:secret@db:5432/payments" {
		t.Fatalf("dsns = %#v", dsns)
	}
}

func TestLineNumbersAreOneBased(t *testing.T) {
	got := refsOf(t, "use sqlx;\n\nsqlx::query!(\"SELECT * FROM users\");\n")
	if len(got) != 1 || got[0].Line != 3 {
		t.Fatalf("line = %+v", got)
	}
}

func TestNoDatabaseRefsWithoutMarkers(t *testing.T) {
	got := refsOf(t, "fn main() { let x = \"SELECT is not sql here\"; }\n")
	if len(got) != 0 {
		t.Fatalf("a bare SELECT string without SQL shape must not yield tables: %+v", got)
	}
}
