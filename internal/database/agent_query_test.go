package database

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
)

func TestAgentQueryIsBoundedAndReadOnly(t *testing.T) {
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	config := dbConnectionRequest{ID: "agent-test", Driver: "sqlite", SQLitePath: filepath.Join(t.TempDir(), "test.db")}
	db, _, err := openDatabase(config)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec("CREATE TABLE demo (value TEXT); INSERT INTO demo VALUES ('one'), ('two'), ('three')"); err != nil {
		t.Fatal(err)
	}
	raw, _ := jsonutil.Marshal([]dbConnectionRequest{config})
	if err = storage.Put("database", "connections", raw); err != nil {
		t.Fatal(err)
	}
	result, err := AgentQuery(context.Background(), config.ID, "SELECT value FROM demo", 2)
	if err != nil {
		t.Fatal(err)
	}
	response := result.(map[string]any)
	if len(response["rows"].([]map[string]any)) != 2 || response["limited"] != true {
		t.Fatal(response)
	}
	for _, query := range []string{"DELETE FROM demo", "INSERT INTO demo VALUES ('bad')", "DROP TABLE demo", "WITH x AS (SELECT 1) DELETE FROM demo", "PRAGMA query_only = OFF; DELETE FROM demo", "SELECT * INTO new_table FROM demo", "SELECT 1; DELETE FROM demo"} {
		if _, err = AgentQuery(context.Background(), config.ID, query, 200); err == nil {
			t.Fatalf("agent write allowed: %s", query)
		}
	}
	var count int
	if err = db.QueryRow("SELECT count(*) FROM demo").Scan(&count); err != nil || count != 3 {
		t.Fatalf("data changed: %d %v", count, err)
	}
}
