// Package database backs adOmnia's database client: connection lifecycle, query execution, local SQLite files and sealed credential references.
package database

import (
	"context"
	"database/sql"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
	_ "modernc.org/sqlite"
)

type dbConnectionRequest struct {
	IdleTimeoutMinutes int    `json:"idleTimeoutMinutes,omitzero"`
	ID                 string `json:"id"`
	Variables          string `json:"variables,omitempty"`
	Driver             string `json:"driver"`
	DSN                string `json:"dsn"`
	Host               string `json:"host"`
	Port               int    `json:"port"`
	Database           string `json:"database"`
	Collection         string `json:"collection"`
	User               string `json:"user"`
	Password           string `json:"password"`
	SSLMode            string `json:"sslMode"`
	SQLitePath         string `json:"sqlitePath"`
	// MongoDB only: SRV lookup (mongodb+srv://) and extra URI options such as
	// "authSource=admin&tls=true&replicaSet=rs0".
	SRV     bool   `json:"srv"`
	Options string `json:"options"`
}

type dbQueryRequest struct {
	ConnectionID string            `json:"connectionId"`
	Variables    map[string]string `json:"variables"`
	handle       *connectionHandle
	Connection   dbConnectionRequest `json:"connection"`
	Query        string              `json:"query"`
	Limit        int                 `json:"limit"`
	Confirm      bool                `json:"confirm"`
	Explain      bool                `json:"explain"`
	Analyze      bool                `json:"analyze"`
	TimeoutMS    int                 `json:"timeoutMs"`
}

type dbQueryResponse struct {
	Columns       []string         `json:"columns"`
	Rows          []map[string]any `json:"rows"`
	RowsAffected  int64            `json:"rowsAffected"`
	DurationMS    int64            `json:"durationMs"`
	Driver        string           `json:"driver"`
	Limited       bool             `json:"limited"`
	Destructive   bool             `json:"destructive"`
	StatementType string           `json:"statementType"`
	// Explain is "plan" or "analyze" when the rows are an execution plan.
	Explain string `json:"explain,omitempty"`
	Warning string `json:"warning,omitempty"`
	// Documents holds ordered canonical Extended JSON when a Mongo command sets
	// canonical: true, so the document view keeps field order and BSON types.
	Documents []jsonv1.RawMessage `json:"documents,omitempty"`
}

var limitRe = regexp.MustCompile(`(?i)\blimit\s+\d+|\bfetch\s+first\s+\d+\s+rows\s+only`)
var localDatabaseNameRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

type createLocalSQLiteRequest struct {
	Name string `json:"name"`
}

func databaseTestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req dbConnectionRequest
	if err := json.UnmarshalRead(r.Body, &req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.ID != "" && req.Driver == "" {
		var err error
		req, err = savedConfig(req.ID)
		if err != nil {
			http.Error(w, "saved connection not found", 400)
			return
		}
	}
	var credentialErr error
	req, credentialErr = resolveCredentials(req)
	if credentialErr != nil {
		http.Error(w, credentialErr.Error(), 400)
		return
	}
	if isMongoDriver(req.Driver) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		start := time.Now()
		client, _, err := openMongoDatabase(ctx, req)
		if err != nil {
			http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
			return
		}
		defer client.Disconnect(context.Background())
		if err := client.Ping(ctx, readpref.Primary()); err != nil {
			http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
			return
		}
		dbWriteJSON(w, map[string]any{"ok": true, "driver": "mongodb", "durationMs": time.Since(start).Milliseconds()})
		return
	}
	if strings.EqualFold(req.Driver, "redis") {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		start := time.Now()
		client, err := openRedisDatabase(req)
		if err != nil {
			http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
			return
		}
		defer client.Close()
		if err := client.Ping(ctx).Err(); err != nil {
			http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
			return
		}
		dbWriteJSON(w, map[string]any{"ok": true, "driver": "redis", "durationMs": time.Since(start).Milliseconds()})
		return
	}
	db, driver, err := openDatabase(req)
	if err != nil {
		http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
		return
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	start := time.Now()
	if err := db.PingContext(ctx); err != nil {
		http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
		return
	}
	dbWriteJSON(w, map[string]any{"ok": true, "driver": driver, "durationMs": time.Since(start).Milliseconds()})
}

func databaseQueryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req dbQueryRequest
	if err := json.UnmarshalRead(r.Body, &req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	query := strings.TrimSpace(req.Query)
	if query == "" {
		http.Error(w, "query is empty", http.StatusBadRequest)
		return
	}
	if req.Limit <= 0 {
		req.Limit = 200
	}
	if req.Limit > 5000 {
		req.Limit = 5000
	}
	if req.ConnectionID != "" {
		var err error
		req.Connection, err = savedConfig(req.ConnectionID)
		if err != nil {
			http.Error(w, "saved connection not found", 400)
			return
		}
	}
	if len(req.Variables) > 0 {
		data, _ := jsonutil.Marshal(req.Variables)
		req.Connection.Variables = string(data)
	}
	if req.Connection.ID != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		h, release, err := connections.acquire(ctx, req.Connection)
		cancel()
		if err != nil {
			http.Error(w, safeDatabaseError(err), 400)
			return
		}
		defer release()
		req.handle = h
	} else {
		var err error
		req.Connection, err = resolveCredentials(req.Connection)
		if err != nil {
			http.Error(w, safeDatabaseError(err), 400)
			return
		}
	}
	if strings.EqualFold(req.Connection.Driver, "redis") {
		resp, err := runRedisQuery(r.Context(), req)
		if err != nil {
			status := http.StatusBadRequest
			if strings.Contains(err.Error(), "requires confirmation") {
				status = http.StatusConflict
			}
			http.Error(w, safeDatabaseError(err), status)
			return
		}
		dbWriteJSON(w, resp)
		return
	}
	if isMongoDriver(req.Connection.Driver) {
		resp, err := runMongoQuery(r.Context(), req)
		if err != nil {
			status := http.StatusBadRequest
			if strings.Contains(err.Error(), "requires confirmation") {
				status = http.StatusConflict
			}
			http.Error(w, safeDatabaseError(err), status)
			return
		}
		dbWriteJSON(w, resp)
		return
	}
	destructive, strict := destructiveQuery(req.Connection.Driver, query)
	if strict && !req.Confirm {
		http.Error(w, "dangerous query requires confirmation", http.StatusConflict)
		return
	}
	var db *sql.DB
	var driver string
	var err error
	if req.handle != nil {
		db, driver = req.handle.sql, req.handle.driver
	} else {
		db, driver, err = openDatabase(req.Connection)
	}
	if err != nil {
		http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
		return
	}
	if req.handle == nil {
		defer db.Close()
	}
	explainMode := ""
	if req.Explain || req.Analyze {
		explained, err := explainQuery(driver, query, req.Analyze)
		if err != nil {
			http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
			return
		}
		query = explained
		explainMode = "plan"
		if req.Analyze {
			explainMode = "analyze"
		}
	}
	stmtType := statementType(query)
	limitedQuery, limited := applyLimit(driver, query, req.Limit)
	timeout := time.Duration(req.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	start := time.Now()
	resp := dbQueryResponse{Driver: driver, Limited: limited, Destructive: destructive, StatementType: stmtType, Explain: explainMode}
	if isResultQuery(limitedQuery) {
		cols, rows, err := runRows(ctx, db, limitedQuery) // NOSONAR -- this is the SQL console: the statement the user typed is meant to run verbatim on their own connection; the sidecar is loopback-only and applyLimit only appends a numeric LIMIT
		if err != nil {
			http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
			return
		}
		resp.Columns = cols
		resp.Rows = rows
	} else {
		res, err := db.ExecContext(ctx, limitedQuery) // NOSONAR -- same as above: user-authored SQL executed by design in the database console
		if err != nil {
			http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
			return
		}
		resp.RowsAffected, _ = res.RowsAffected()
	}
	resp.DurationMS = time.Since(start).Milliseconds()
	dbWriteJSON(w, resp)
}

func databaseCreateLocalSQLiteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req createLocalSQLiteRequest
	if err := json.UnmarshalRead(r.Body, &req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		http.Error(w, "could not resolve the local application data directory", http.StatusInternalServerError)
		return
	}
	path, err := createLocalSQLite(filepath.Join(configDir, "adomnia", "databases"), req.Name)
	if err != nil {
		http.Error(w, safeDatabaseError(err), http.StatusBadRequest)
		return
	}
	dbWriteJSON(w, map[string]any{"ok": true, "path": path})
}

// RegisterHandlers registers Database Studio endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/database/seal", databaseSealHandler)
	for _, action := range []string{"connect", "disconnect", "status"} {
		mux.HandleFunc("/database/"+action, databaseConnectionHandler(action))
	}
	mux.HandleFunc("/database/test", databaseTestHandler)
	mux.HandleFunc("/database/query", databaseQueryHandler)
	mux.HandleFunc("/database/sqlite/create-local", databaseCreateLocalSQLiteHandler)
}

func createLocalSQLite(baseDir, rawName string) (string, error) {
	name := strings.TrimSpace(rawName)
	if name == "" {
		name = "adomnia-local"
	}
	if !localDatabaseNameRe.MatchString(name) {
		return "", fmt.Errorf("database name may contain only letters, numbers, hyphens and underscores")
	}
	if err := os.MkdirAll(baseDir, 0o700); err != nil {
		return "", fmt.Errorf("create database directory: %w", err)
	}
	path := filepath.Join(baseDir, name+".db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return "", fmt.Errorf("create SQLite database: %w", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		return "", fmt.Errorf("open SQLite database: %w", err)
	}
	_ = os.Chmod(path, 0o600)
	return filepath.Clean(path), nil
}

func openDatabase(c dbConnectionRequest) (*sql.DB, string, error) {
	driver := strings.ToLower(strings.TrimSpace(c.Driver))
	switch driver {
	case "sqlite", "sqlite3":
		path := strings.TrimSpace(c.SQLitePath)
		if path == "" {
			path = strings.TrimSpace(c.DSN)
		}
		safePath, err := SanitizeSQLitePath(path)
		if err != nil {
			return nil, "", err
		}
		db, err := sql.Open("sqlite", safePath)
		return db, "sqlite", err
	case "postgres", "postgresql", "pg":
		dsn := strings.TrimSpace(c.DSN)
		if dsn == "" {
			ssl := c.SSLMode
			if ssl == "" {
				ssl = "disable"
			}
			port := c.Port
			if port == 0 {
				port = 5432
			}
			u := &url.URL{Scheme: "postgres", Host: fmt.Sprintf("%s:%d", c.Host, port), Path: c.Database}
			if c.User != "" {
				u.User = url.UserPassword(c.User, c.Password)
			}
			q := u.Query()
			q.Set("sslmode", ssl)
			u.RawQuery = q.Encode()
			dsn = u.String()
		}
		db, err := sql.Open("pgx", dsn)
		return db, "postgres", err
	case "mysql", "mariadb":
		dsn := strings.TrimSpace(c.DSN)
		if dsn == "" {
			port := c.Port
			if port == 0 {
				port = 3306
			}
			dsn = fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&multiStatements=false", c.User, c.Password, c.Host, port, c.Database)
		}
		db, err := sql.Open("mysql", dsn)
		return db, "mysql", err
	case "db2", "ibmdb2":
		return nil, "", fmt.Errorf("IBM Db2 selected: Db2 requires IBM CLI/ODBC client libraries and is not bundled in this portable build yet")
	case "mongodb", "mongo":
		return nil, "", fmt.Errorf("MongoDB is handled by the document query runner")
	default:
		return nil, "", fmt.Errorf("unsupported database driver: %s", c.Driver)
	}
}

// SanitizeSQLitePath validates local SQLite targets before opening a database.
func SanitizeSQLitePath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", fmt.Errorf("SQLite path is required")
	}
	if path == ":memory:" {
		return path, nil
	}
	if strings.ContainsRune(path, 0) {
		return "", fmt.Errorf("SQLite path contains an invalid character")
	}
	lower := strings.ToLower(path)
	if strings.HasPrefix(lower, "file:") {
		return "", fmt.Errorf("SQLite URI DSNs are not allowed; select or enter an absolute .db file path")
	}
	cleaned := filepath.Clean(path)
	if !filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("SQLite path must be absolute")
	}
	return cleaned, nil
}

type mongoQueryCommand struct {
	Operation  string              `json:"operation"`
	Database   string              `json:"database"`
	Collection string              `json:"collection"`
	Filter     jsonv1.RawMessage   `json:"filter"`
	Projection jsonv1.RawMessage   `json:"projection"`
	Sort       jsonv1.RawMessage   `json:"sort"`
	Pipeline   []jsonv1.RawMessage `json:"pipeline"`
	Document   jsonv1.RawMessage   `json:"document"`
	Documents  []jsonv1.RawMessage `json:"documents"`
	Update     jsonv1.RawMessage   `json:"update"`
	Command    jsonv1.RawMessage   `json:"command"`
	Limit      int64               `json:"limit"`
	Skip       int64               `json:"skip"`
	Upsert     bool                `json:"upsert"`
	Canonical  bool                `json:"canonical"`
}

func isMongoDriver(driver string) bool {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "mongodb", "mongo":
		return true
	default:
		return false
	}
}

func openMongoDatabase(ctx context.Context, c dbConnectionRequest) (*mongo.Client, *mongo.Database, error) {
	uri := strings.TrimSpace(c.DSN)
	if uri == "" {
		host := strings.TrimSpace(c.Host)
		if host == "" {
			host = "127.0.0.1"
		}
		port := c.Port
		if port == 0 {
			port = 27017
		}
		u := &url.URL{Scheme: "mongodb", Host: fmt.Sprintf("%s:%d", host, port), Path: "/"}
		if c.SRV {
			// SRV records resolve hosts and ports; a port in the URI is rejected.
			u.Scheme = "mongodb+srv"
			u.Host = host
		}
		if c.User != "" {
			u.User = url.UserPassword(c.User, c.Password)
		}
		if opts := strings.TrimPrefix(strings.TrimSpace(c.Options), "?"); opts != "" {
			if _, err := url.ParseQuery(opts); err != nil {
				return nil, nil, fmt.Errorf("invalid connection options: %w", err)
			}
			u.RawQuery = opts
		}
		uri = u.String()
	}
	opts := options.Client().
		ApplyURI(uri).
		SetServerSelectionTimeout(5 * time.Second)
	client, err := connectMongo(ctx, opts)
	if isScramSHA1Unavailable(err) && opts.Auth != nil && opts.Auth.AuthMechanism == "" {
		// The driver falls back to SCRAM-SHA-1 when the server does not list the
		// user's mechanisms (user missing from authSource, or SHA-1 disabled).
		// Retry with SCRAM-SHA-256, which every MongoDB >= 4.0 supports.
		cred := *opts.Auth
		cred.AuthMechanism = "SCRAM-SHA-256"
		client, err = connectMongo(ctx, opts.SetAuth(cred))
	}
	if err != nil && strings.Contains(err.Error(), "Authentication failed") && strings.TrimSpace(c.DSN) == "" &&
		!strings.Contains(strings.ToLower(c.Options), "authsource") &&
		opts.Auth != nil && c.Database != "" && c.Database != "admin" {
		// Field-based connections have no URI path, so authSource defaults to
		// "admin"; users created inside the selected database live there instead.
		cred := *opts.Auth
		cred.AuthSource = c.Database
		if retry, retryErr := connectMongo(ctx, opts.SetAuth(cred)); retryErr == nil {
			client, err = retry, nil
		}
	}
	if err != nil {
		if strings.Contains(err.Error(), "Authentication failed") {
			return nil, nil, fmt.Errorf("%w (check credentials and authSource: the user must exist in the authSource database, default \"admin\"; add ?authSource=<db> to the connection string if it was created elsewhere)", err)
		}
		return nil, nil, err
	}
	dbName := strings.TrimSpace(c.Database)
	if dbName == "" {
		dbName = "admin"
	}
	return client, client.Database(dbName), nil
}

func connectMongo(ctx context.Context, opts *options.ClientOptions) (*mongo.Client, error) {
	client, err := mongo.Connect(opts)
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, err
	}
	return client, nil
}

func isScramSHA1Unavailable(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "SCRAM-SHA-1") && strings.Contains(msg, "MechanismUnavailable")
}

func runMongoQuery(parent context.Context, req dbQueryRequest) (dbQueryResponse, error) {
	var cmd mongoQueryCommand
	if err := json.Unmarshal([]byte(req.Query), &cmd); err != nil {
		return dbQueryResponse{}, fmt.Errorf("MongoDB query must be JSON with an operation field: %w", err)
	}
	op := strings.ToLower(strings.TrimSpace(cmd.Operation))
	if op == "" {
		return dbQueryResponse{}, fmt.Errorf("MongoDB query requires operation")
	}
	destructive, strict := mongoDestructiveOperation(op)
	if strict && !req.Confirm {
		return dbQueryResponse{}, fmt.Errorf("dangerous MongoDB operation requires confirmation")
	}
	timeout := time.Duration(req.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	start := time.Now()
	client, db, cleanup, err := mongoOpenTarget(ctx, req, cmd)
	if err != nil {
		return dbQueryResponse{}, err
	}
	defer cleanup()
	resp := dbQueryResponse{
		Driver:        "mongodb",
		Destructive:   destructive,
		StatementType: "MONGO " + strings.ToUpper(op),
	}
	collectionName := strings.TrimSpace(cmd.Collection)
	if collectionName == "" {
		collectionName = strings.TrimSpace(req.Connection.Collection)
	}
	handler, ok := mongoOpHandlers[op]
	if !ok {
		return resp, fmt.Errorf("unsupported MongoDB operation %q", cmd.Operation)
	}
	octx := &mongoOpCtx{
		ctx: ctx, client: client, db: db, cmd: cmd, op: op,
		collectionName: collectionName,
		limit:          mongoQueryLimit(req.Limit, cmd.Limit),
		resp:           &resp,
	}
	if err := handler(octx); err != nil {
		return resp, err
	}
	resp.DurationMS = time.Since(start).Milliseconds()
	return resp, nil
}

func mongoDestructiveOperation(op string) (bool, bool) {
	switch op {
	case "insertone", "insertmany", "updateone", "updatemany", "replaceone", "deleteone", "deletemany":
		// Le write mirate sono marcate come distruttive ma non bloccate: l'utente le ha
		// scritte per nome. Le versioni "many" senza filtro chiedono conferma.
		return true, op == "updatemany" || op == "deletemany"
	case "dropcollection", "dropdatabase":
		return true, true
	case "runcommand":
		// Comando arbitrario (dropDatabase, write massive, drop…): il payload non è
		// classificabile dal nome, quindi sempre distruttivo e strict (review DB-2).
		return true, true
	default:
		return false, false
	}
}

func mongoRawDoc(raw jsonv1.RawMessage, fallback any) (any, error) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" {
		return fallback, nil
	}
	var doc any
	// Relaxed mode also accepts canonical input, plus {"$date": "<ISO-8601>"}.
	if err := bson.UnmarshalExtJSON(raw, false, &doc); err != nil {
		return nil, err
	}
	return doc, nil
}

func mongoRawDocuments(rawDocs []jsonv1.RawMessage) ([]any, error) {
	if len(rawDocs) == 0 {
		return nil, fmt.Errorf("documents array is required")
	}
	docs := make([]any, 0, len(rawDocs))
	for _, raw := range rawDocs {
		doc, err := mongoRawDoc(raw, nil)
		if err != nil {
			return nil, err
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

func mongoRawPipeline(rawStages []jsonv1.RawMessage) ([]any, error) {
	if len(rawStages) == 0 {
		return nil, fmt.Errorf("pipeline array is required")
	}
	pipeline := make([]any, 0, len(rawStages))
	for _, raw := range rawStages {
		stage, err := mongoRawDoc(raw, nil)
		if err != nil {
			return nil, err
		}
		pipeline = append(pipeline, stage)
	}
	return pipeline, nil
}

func fillMongoResult(ctx context.Context, cursor *mongo.Cursor, canonical bool, resp *dbQueryResponse) error {
	if !canonical {
		rows, err := mongoCursorRows(ctx, cursor)
		if err != nil {
			return err
		}
		resp.Rows = rows
		resp.Columns = columnsFromRows(rows)
		return nil
	}
	docs, err := mongoCanonicalDocuments(ctx, cursor)
	if err != nil {
		return err
	}
	resp.Documents = docs
	resp.RowsAffected = int64(len(docs))
	return nil
}

// mongoCanonicalDocuments keeps each document as raw BSON so field order
// survives, then renders canonical Extended JSON (types stay explicit).
func mongoCanonicalDocuments(ctx context.Context, cursor *mongo.Cursor) ([]jsonv1.RawMessage, error) {
	defer cursor.Close(ctx)
	docs := make([]jsonv1.RawMessage, 0)
	for cursor.Next(ctx) {
		out, err := bson.MarshalExtJSON(cursor.Current, true, false)
		if err != nil {
			return nil, err
		}
		docs = append(docs, jsonv1.RawMessage(out))
	}
	return docs, cursor.Err()
}

func mongoCursorRows(ctx context.Context, cursor *mongo.Cursor) ([]map[string]any, error) {
	defer cursor.Close(ctx)
	var docs []bson.M
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(docs))
	for _, doc := range docs {
		rows = append(rows, mongoDocToMap(doc))
	}
	return rows, nil
}

func mongoDocToMap(doc any) map[string]any {
	bytes, err := bson.MarshalExtJSON(doc, false, false)
	if err != nil {
		return map[string]any{"value": fmt.Sprint(doc)}
	}
	var row map[string]any
	if err := json.Unmarshal(bytes, &row); err != nil {
		return map[string]any{"value": string(bytes)}
	}
	return row
}

func mongoValue(value any) any {
	bytes, err := bson.MarshalExtJSON(bson.M{"value": value}, false, false)
	if err != nil {
		return fmt.Sprint(value)
	}
	var row map[string]any
	if err := json.Unmarshal(bytes, &row); err != nil {
		return string(bytes)
	}
	return row["value"]
}

func columnsFromRows(rows []map[string]any) []string {
	seen := map[string]bool{}
	cols := make([]string, 0)
	for _, row := range rows {
		for col := range row {
			if !seen[col] {
				seen[col] = true
				cols = append(cols, col)
			}
		}
	}
	return cols
}

func dbWriteJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = jsonutil.MarshalWrite(w, value)
}

func statementType(query string) string {
	fields := strings.Fields(strings.TrimSpace(query))
	if len(fields) == 0 {
		return ""
	}
	return strings.ToUpper(fields[0])
}

func isResultQuery(query string) bool {
	t := statementType(query)
	return t == "SELECT" || t == "WITH" || t == "SHOW" || t == "DESCRIBE" || t == "EXPLAIN" || t == "PRAGMA"
}

func applyLimit(driver, query string, limit int) (string, bool) {
	if !isResultQuery(query) || statementType(query) == "EXPLAIN" || limitRe.MatchString(query) {
		return query, false
	}
	trimmed := strings.TrimRight(strings.TrimSpace(query), ";")
	if strings.EqualFold(driver, "db2") {
		return trimmed + " FETCH FIRST " + strconv.Itoa(limit) + " ROWS ONLY", true
	}
	return trimmed + " LIMIT " + strconv.Itoa(limit), true
}

// explainQuery wraps a statement in the driver's plan syntax. ANALYZE really
// executes the statement, so it is limited to read queries.
func explainQuery(driver, query string, analyze bool) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(query), ";")
	if analyze {
		if t := statementType(trimmed); t != "SELECT" && t != "WITH" {
			return "", errors.New("EXPLAIN ANALYZE executes the statement: only SELECT and WITH queries can be analyzed")
		}
	}
	switch driver {
	case "postgres":
		if analyze {
			return "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + trimmed, nil
		}
		return "EXPLAIN (FORMAT JSON) " + trimmed, nil
	case "mysql":
		if analyze {
			return "EXPLAIN ANALYZE " + trimmed, nil
		}
		return "EXPLAIN " + trimmed, nil
	case "sqlite":
		if analyze {
			return "", errors.New("SQLite has no EXPLAIN ANALYZE: use Explain for the query plan")
		}
		return "EXPLAIN QUERY PLAN " + trimmed, nil
	default:
		if analyze {
			return "", fmt.Errorf("EXPLAIN ANALYZE is not supported for %s", driver)
		}
		return "EXPLAIN " + trimmed, nil
	}
}

var (
	whereRe       = regexp.MustCompile(`(?i)\bwhere\b`)
	cteWriteRe    = regexp.MustCompile(`(?i)\b(delete|update)\b`)
	dollarQuoteRe = regexp.MustCompile(`^\$[A-Za-z_]*\$`)
)

// backslashEscapesStrings reports whether a backslash escapes the next character inside
// a '…' literal: true for MySQL/MariaDB only. PostgreSQL (standard_conforming_strings) and
// SQLite read it literally, so `'\'` is a complete string there.
func backslashEscapesStrings(driver string) bool {
	return strings.EqualFold(driver, "mysql") || strings.EqualFold(driver, "mariadb")
}

// maskSQLNonCode blanks string literals, quoted identifiers, comments and
// dollar-quoted bodies so keyword checks never match inside them. Length is kept.
func maskSQLNonCode(query string, backslashEscapes bool) string {
	out := []byte(query)
	n := len(query)
	blank := func(from, to int) {
		for i := from; i < to && i < n; i++ {
			if out[i] != '\n' {
				out[i] = ' '
			}
		}
	}
	for i := 0; i < n; {
		c := query[i]
		switch {
		case c == '-' && i+1 < n && query[i+1] == '-':
			j := i
			for j < n && query[j] != '\n' {
				j++
			}
			blank(i, j)
			i = j
		case c == '/' && i+1 < n && query[i+1] == '*':
			j := strings.Index(query[i+2:], "*/")
			if j < 0 {
				j = n
			} else {
				j += i + 4
			}
			blank(i, j)
			i = j
		case c == '\'' || c == '"' || c == '`':
			j := i + 1
			for j < n {
				if c == '\'' && backslashEscapes && query[j] == '\\' {
					j += 2
					continue
				}
				if query[j] == c {
					if j+1 < n && query[j+1] == c {
						j += 2
						continue
					}
					j++
					break
				}
				j++
			}
			blank(i, j)
			i = j
		case c == '$':
			tag := dollarQuoteRe.FindString(query[i:])
			if tag == "" {
				i++
				continue
			}
			j := strings.Index(query[i+len(tag):], tag)
			if j < 0 {
				j = n
			} else {
				j += i + 2*len(tag)
			}
			blank(i, j)
			i = j
		default:
			i++
		}
	}
	return string(out)
}

// destructiveQuery reports whether any statement of the script changes or drops
// data (destructive) and whether it needs an explicit confirmation (strict):
// DROP/TRUNCATE, or DELETE/UPDATE without a real WHERE clause. Strings and
// comments are ignored, so a WHERE on its own line counts and a leading comment
// cannot hide the statement.
func destructiveQuery(driver, query string) (bool, bool) {
	destructive, strict := false, false
	for stmt := range strings.SplitSeq(maskSQLNonCode(query, backslashEscapesStrings(driver)), ";") {
		fields := strings.Fields(strings.ToUpper(stmt))
		if len(fields) == 0 {
			continue
		}
		first := fields[0]
		if first == "WITH" && cteWriteRe.MatchString(stmt) {
			first = strings.ToUpper(cteWriteRe.FindString(stmt))
		}
		switch first {
		// DROP/TRUNCATE distruggono; CALL/DO/COPY/MERGE/REPLACE/LOAD/GRANT/REVOKE possono
		// cambiare dati, stato o privilegi senza che lo si veda dallo statement: sempre conferma
		// (review di sicurezza DB-2). Anche `COPY … TO` è una lettura, ma scrive su file.
		case "DROP", "TRUNCATE", "CALL", "DO", "COPY", "MERGE", "REPLACE", "LOAD", "GRANT", "REVOKE":
			destructive, strict = true, true
		case "ALTER":
			destructive = true
		case "DELETE", "UPDATE":
			destructive = true
			if !whereRe.MatchString(stmt) {
				strict = true
			}
		}
	}
	return destructive, strict
}

func runRows(ctx context.Context, db *sql.DB, query string) ([]string, []map[string]any, error) {
	rows, err := db.QueryContext(ctx, query) // NOSONAR -- query is the SQL the user typed in the console (see databaseQueryHandler); running it verbatim is the feature
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	out := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		row := map[string]any{}
		for i, col := range cols {
			switch v := values[i].(type) {
			case []byte:
				row[col] = string(v)
			case time.Time:
				row[col] = v.Format(time.RFC3339)
			default:
				row[col] = v
			}
		}
		out = append(out, row)
	}
	return cols, out, rows.Err()
}
