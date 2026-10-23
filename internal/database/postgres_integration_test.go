package database

import (
	"adomnia/internal/jsonutil"
	"adomnia/internal/procutil"
	"adomnia/internal/storage"
	"adomnia/internal/vault"
	"bytes"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Explicit opt-in; connects only to the disposable PostgreSQL supplied by the
// developer. No credentials are printed or copied to persistent test fixtures.
func TestPostgresCredentialPersistence(t *testing.T) {
	dsn := os.Getenv("ADOMNIA_DB2_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("disposable PostgreSQL not configured")
	}
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	cfg := dbConnectionRequest{ID: "db2-postgres-validation", Driver: "postgres", DSN: dsn}
	raw, _ := jsonutil.Marshal(cfg)
	w := httptest.NewRecorder()
	databaseSealHandler(w, httptest.NewRequest(http.MethodPost, "/database/seal", bytes.NewReader(raw)))
	if w.Code != 200 {
		t.Fatalf("seal HTTP %d", w.Code)
	}
	if strings.Contains(w.Body.String(), dsn) {
		t.Fatal("seal returned plaintext DSN")
	}
	var response struct {
		Connection dbConnectionRequest `json:"connection"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	cfg = response.Connection
	sealed, _ := jsonutil.Marshal([]dbConnectionRequest{cfg})
	if err := storage.Put("database", "connections", sealed); err != nil {
		t.Fatal(err)
	}
	defer connections.disconnect(cfg.ID)
	query := func() dbQueryResponse {
		t.Helper()
		body, _ := jsonutil.Marshal(dbQueryRequest{ConnectionID: cfg.ID, Query: "SELECT pg_backend_pid() AS pid, current_user AS username", Limit: 1})
		out := httptest.NewRecorder()
		databaseQueryHandler(out, httptest.NewRequest(http.MethodPost, "/database/query", bytes.NewReader(body)))
		if out.Code != 200 {
			t.Fatalf("query HTTP %d: %s", out.Code, out.Body.String())
		}
		var result dbQueryResponse
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	first := query()
	second := query()
	if first.Rows[0]["pid"] != second.Rows[0]["pid"] {
		t.Fatal("query opened another server connection")
	}
	mux := http.NewServeMux()
	vault.RegisterHandlers(mux)
	mux.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/vault/lock", nil))
	query()
	connections.disconnect(cfg.ID)
	query()
	// A separate native process must read the OS key and open the saved seal.
	fixture := filepath.Join(t.TempDir(), "sealed.json")
	encoded, _ := jsonutil.Marshal(cfg)
	if err := os.WriteFile(fixture, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := procutil.Command(binary, "-test.run=^TestPostgresCredentialChild$")
	cmd.Env = append(os.Environ(), "ADOMNIA_DB2_CHILD_FIXTURE="+fixture)
	if _, err = cmd.CombinedOutput(); err != nil {
		t.Fatal("separate native process could not query with persisted sealed credentials")
	}
}

func TestPostgresCredentialChild(t *testing.T) {
	path := os.Getenv("ADOMNIA_DB2_CHILD_FIXTURE")
	if path == "" {
		t.Skip("native child only")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var cfg dbConnectionRequest
	if json.Unmarshal(raw, &cfg) != nil {
		t.Fatal("invalid fixture")
	}
	body, _ := jsonutil.Marshal(dbQueryRequest{Connection: cfg, Query: "SELECT 1 AS ok", Limit: 1})
	out := httptest.NewRecorder()
	databaseQueryHandler(out, httptest.NewRequest(http.MethodPost, "/database/query", bytes.NewReader(body)))
	if out.Code != 200 {
		t.Fatalf("child query HTTP %d", out.Code)
	}
	connections.disconnect(cfg.ID)
}
