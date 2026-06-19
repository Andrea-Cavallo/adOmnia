package database

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestSanitizeSQLitePathRejectsRelativeTraversal(t *testing.T) {
	if _, err := SanitizeSQLitePath(filepath.Join("..", "..", "etc", "hosts")); err == nil {
		t.Fatal("expected relative traversal path to be rejected")
	}
}

func TestSanitizeSQLitePathRejectsURI(t *testing.T) {
	if _, err := SanitizeSQLitePath("file:../../etc/hosts?mode=ro"); err == nil {
		t.Fatal("expected SQLite URI DSN to be rejected")
	}
}

func TestSanitizeSQLitePathAllowsAbsolutePath(t *testing.T) {
	input := filepath.Join(t.TempDir(), "app.db")
	got, err := SanitizeSQLitePath(input)
	if err != nil {
		t.Fatalf("expected absolute path to be accepted: %v", err)
	}
	if got != filepath.Clean(input) {
		t.Fatalf("expected cleaned path %q, got %q", filepath.Clean(input), got)
	}
}

func TestSanitizeSQLitePathAllowsInMemory(t *testing.T) {
	got, err := SanitizeSQLitePath(":memory:")
	if err != nil {
		t.Fatalf("expected :memory: to be accepted: %v", err)
	}
	if got != ":memory:" {
		t.Fatalf("expected :memory:, got %q", got)
	}
}

func TestCreateLocalSQLiteCreatesPersistentDatabase(t *testing.T) {
	path, err := createLocalSQLite(t.TempDir(), "project-data")
	if err != nil {
		t.Fatalf("create local SQLite: %v", err)
	}
	if filepath.Base(path) != "project-data.db" {
		t.Fatalf("unexpected database path %q", path)
	}
	db, _, err := openDatabase(dbConnectionRequest{Driver: "sqlite", SQLitePath: path})
	if err != nil {
		t.Fatalf("created database should be openable: %v", err)
	}
	_ = db.Close()
}

func TestCreateLocalSQLiteRejectsUnsafeName(t *testing.T) {
	if _, err := createLocalSQLite(t.TempDir(), "../outside"); err == nil {
		t.Fatal("expected unsafe database name to be rejected")
	}
}

func TestSQLiteQueryHandlerEndToEnd(t *testing.T) {
	path := filepath.Join(t.TempDir(), "studio.db")
	connection := dbConnectionRequest{Driver: "sqlite", SQLitePath: path}

	run := func(query string, limit int) dbQueryResponse {
		t.Helper()
		body, err := json.Marshal(dbQueryRequest{Connection: connection, Query: query, Limit: limit, TimeoutMS: 5000, Confirm: true})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/database/query", bytes.NewReader(body))
		res := httptest.NewRecorder()
		databaseQueryHandler(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("query %q failed: %s", query, res.Body.String())
		}
		var result dbQueryResponse
		if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}

	run(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`, 200)
	run(`INSERT INTO users (name) VALUES ('Lorem'), ('Ipsum')`, 200)
	result := run(`SELECT id, name FROM users ORDER BY id`, 1)
	if len(result.Rows) != 1 || result.Rows[0]["name"] != "Lorem" {
		t.Fatalf("expected one limited row, got %#v", result.Rows)
	}
	if !result.Limited {
		t.Fatal("expected auto limit to be reported")
	}
}
