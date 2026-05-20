package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
	_ "modernc.org/sqlite"
)

type dbConnectionRequest struct {
	Driver     string `json:"driver"`
	DSN        string `json:"dsn"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Database   string `json:"database"`
	Collection string `json:"collection"`
	User       string `json:"user"`
	Password   string `json:"password"`
	SSLMode    string `json:"sslMode"`
	SQLitePath string `json:"sqlitePath"`
}

type dbQueryRequest struct {
	Connection dbConnectionRequest `json:"connection"`
	Query      string              `json:"query"`
	Limit      int                 `json:"limit"`
	Confirm    bool                `json:"confirm"`
	Explain    bool                `json:"explain"`
	TimeoutMS  int                 `json:"timeoutMs"`
}

type dbQueryResponse struct {
	Columns       []string                 `json:"columns"`
	Rows          []map[string]interface{} `json:"rows"`
	RowsAffected  int64                    `json:"rowsAffected"`
	DurationMS    int64                    `json:"durationMs"`
	Driver        string                   `json:"driver"`
	Limited       bool                     `json:"limited"`
	Destructive   bool                     `json:"destructive"`
	StatementType string                   `json:"statementType"`
	Warning       string                   `json:"warning,omitempty"`
}

var limitRe = regexp.MustCompile(`(?i)\blimit\s+\d+|\bfetch\s+first\s+\d+\s+rows\s+only`)

func databaseTestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req dbConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if isMongoDriver(req.Driver) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		start := time.Now()
		client, _, err := openMongoDatabase(ctx, req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		defer client.Disconnect(context.Background())
		if err := client.Ping(ctx, readpref.Primary()); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		dbWriteJSON(w, map[string]interface{}{"ok": true, "driver": "mongodb", "durationMs": time.Since(start).Milliseconds()})
		return
	}
	db, driver, err := openDatabase(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	start := time.Now()
	if err := db.PingContext(ctx); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	dbWriteJSON(w, map[string]interface{}{"ok": true, "driver": driver, "durationMs": time.Since(start).Milliseconds()})
}

func databaseQueryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req dbQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
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
	if isMongoDriver(req.Connection.Driver) {
		resp, err := runMongoQuery(r.Context(), req)
		if err != nil {
			status := http.StatusBadRequest
			if strings.Contains(err.Error(), "requires confirmation") {
				status = http.StatusConflict
			}
			http.Error(w, err.Error(), status)
			return
		}
		dbWriteJSON(w, resp)
		return
	}
	destructive, strict := destructiveQuery(query)
	if strict && !req.Confirm {
		http.Error(w, "dangerous query requires confirmation", http.StatusConflict)
		return
	}
	db, driver, err := openDatabase(req.Connection)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer db.Close()
	if req.Explain {
		query = explainQuery(driver, query)
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
	resp := dbQueryResponse{Driver: driver, Limited: limited, Destructive: destructive, StatementType: stmtType}
	if isResultQuery(limitedQuery) {
		cols, rows, err := runRows(ctx, db, limitedQuery)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		resp.Columns = cols
		resp.Rows = rows
	} else {
		res, err := db.ExecContext(ctx, limitedQuery)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		resp.RowsAffected, _ = res.RowsAffected()
	}
	resp.DurationMS = time.Since(start).Milliseconds()
	dbWriteJSON(w, resp)
}

func openDatabase(c dbConnectionRequest) (*sql.DB, string, error) {
	driver := strings.ToLower(strings.TrimSpace(c.Driver))
	switch driver {
	case "sqlite", "sqlite3":
		path := strings.TrimSpace(c.SQLitePath)
		if path == "" {
			path = strings.TrimSpace(c.DSN)
		}
		if path == "" {
			return nil, "", fmt.Errorf("SQLite path is required")
		}
		db, err := sql.Open("sqlite", path)
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

type mongoQueryCommand struct {
	Operation  string            `json:"operation"`
	Collection string            `json:"collection"`
	Filter     json.RawMessage   `json:"filter"`
	Projection json.RawMessage   `json:"projection"`
	Sort       json.RawMessage   `json:"sort"`
	Pipeline   []json.RawMessage `json:"pipeline"`
	Document   json.RawMessage   `json:"document"`
	Documents  []json.RawMessage `json:"documents"`
	Update     json.RawMessage   `json:"update"`
	Command    json.RawMessage   `json:"command"`
	Limit      int64             `json:"limit"`
	Upsert     bool              `json:"upsert"`
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
		u := &url.URL{Scheme: "mongodb", Host: fmt.Sprintf("%s:%d", host, port)}
		if c.User != "" {
			u.User = url.UserPassword(c.User, c.Password)
		}
		uri = u.String()
	}
	opts := options.Client().
		ApplyURI(uri).
		SetServerSelectionTimeout(5 * time.Second)
	client, err := mongo.Connect(opts)
	if err != nil {
		return nil, nil, err
	}
	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, nil, err
	}
	dbName := strings.TrimSpace(c.Database)
	if dbName == "" {
		dbName = "admin"
	}
	return client, client.Database(dbName), nil
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
	client, db, err := openMongoDatabase(ctx, req.Connection)
	if err != nil {
		return dbQueryResponse{}, err
	}
	defer client.Disconnect(context.Background())
	resp := dbQueryResponse{
		Driver:        "mongodb",
		Destructive:   destructive,
		StatementType: "MONGO " + strings.ToUpper(op),
	}
	collectionName := strings.TrimSpace(cmd.Collection)
	if collectionName == "" {
		collectionName = strings.TrimSpace(req.Connection.Collection)
	}
	collection := func() (*mongo.Collection, error) {
		if collectionName == "" {
			return nil, fmt.Errorf("MongoDB operation %q requires collection", op)
		}
		return db.Collection(collectionName), nil
	}
	limit := int64(req.Limit)
	if cmd.Limit > 0 {
		limit = cmd.Limit
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}

	switch op {
	case "find":
		coll, err := collection()
		if err != nil {
			return resp, err
		}
		filter, err := mongoRawDoc(cmd.Filter, bson.D{})
		if err != nil {
			return resp, fmt.Errorf("invalid filter: %w", err)
		}
		findOpts := options.Find().SetLimit(limit)
		if len(cmd.Projection) > 0 {
			projection, err := mongoRawDoc(cmd.Projection, nil)
			if err != nil {
				return resp, fmt.Errorf("invalid projection: %w", err)
			}
			findOpts.SetProjection(projection)
		}
		if len(cmd.Sort) > 0 {
			sortDoc, err := mongoRawDoc(cmd.Sort, nil)
			if err != nil {
				return resp, fmt.Errorf("invalid sort: %w", err)
			}
			findOpts.SetSort(sortDoc)
		}
		cursor, err := coll.Find(ctx, filter, findOpts)
		if err != nil {
			return resp, err
		}
		rows, err := mongoCursorRows(ctx, cursor)
		if err != nil {
			return resp, err
		}
		resp.Rows = rows
		resp.Columns = columnsFromRows(rows)
		resp.Limited = true
	case "aggregate":
		coll, err := collection()
		if err != nil {
			return resp, err
		}
		pipeline, err := mongoRawPipeline(cmd.Pipeline)
		if err != nil {
			return resp, err
		}
		cursor, err := coll.Aggregate(ctx, pipeline)
		if err != nil {
			return resp, err
		}
		rows, err := mongoCursorRows(ctx, cursor)
		if err != nil {
			return resp, err
		}
		resp.Rows = rows
		resp.Columns = columnsFromRows(rows)
	case "insertone":
		coll, err := collection()
		if err != nil {
			return resp, err
		}
		doc, err := mongoRawDoc(cmd.Document, nil)
		if err != nil {
			return resp, fmt.Errorf("invalid document: %w", err)
		}
		result, err := coll.InsertOne(ctx, doc)
		if err != nil {
			return resp, err
		}
		resp.RowsAffected = 1
		resp.Columns = []string{"insertedId"}
		resp.Rows = []map[string]interface{}{{"insertedId": mongoValue(result.InsertedID)}}
	case "insertmany":
		coll, err := collection()
		if err != nil {
			return resp, err
		}
		docs, err := mongoRawDocuments(cmd.Documents)
		if err != nil {
			return resp, err
		}
		result, err := coll.InsertMany(ctx, docs)
		if err != nil {
			return resp, err
		}
		resp.RowsAffected = int64(len(result.InsertedIDs))
		resp.Columns = []string{"insertedIds"}
		resp.Rows = []map[string]interface{}{{"insertedIds": mongoValue(result.InsertedIDs)}}
	case "updateone", "updatemany":
		coll, err := collection()
		if err != nil {
			return resp, err
		}
		filter, err := mongoRawDoc(cmd.Filter, bson.D{})
		if err != nil {
			return resp, fmt.Errorf("invalid filter: %w", err)
		}
		update, err := mongoRawDoc(cmd.Update, nil)
		if err != nil {
			return resp, fmt.Errorf("invalid update: %w", err)
		}
		if op == "updateone" {
			result, err := coll.UpdateOne(ctx, filter, update, options.UpdateOne().SetUpsert(cmd.Upsert))
			if err != nil {
				return resp, err
			}
			resp.RowsAffected = result.ModifiedCount
			resp.Columns = []string{"matched", "modified", "upsertedId"}
			resp.Rows = []map[string]interface{}{{"matched": result.MatchedCount, "modified": result.ModifiedCount, "upsertedId": mongoValue(result.UpsertedID)}}
		} else {
			result, err := coll.UpdateMany(ctx, filter, update, options.UpdateMany().SetUpsert(cmd.Upsert))
			if err != nil {
				return resp, err
			}
			resp.RowsAffected = result.ModifiedCount
			resp.Columns = []string{"matched", "modified", "upsertedId"}
			resp.Rows = []map[string]interface{}{{"matched": result.MatchedCount, "modified": result.ModifiedCount, "upsertedId": mongoValue(result.UpsertedID)}}
		}
	case "deleteone", "deletemany":
		coll, err := collection()
		if err != nil {
			return resp, err
		}
		filter, err := mongoRawDoc(cmd.Filter, bson.D{})
		if err != nil {
			return resp, fmt.Errorf("invalid filter: %w", err)
		}
		if op == "deleteone" {
			result, err := coll.DeleteOne(ctx, filter)
			if err != nil {
				return resp, err
			}
			resp.RowsAffected = result.DeletedCount
		} else {
			result, err := coll.DeleteMany(ctx, filter)
			if err != nil {
				return resp, err
			}
			resp.RowsAffected = result.DeletedCount
		}
	case "count", "countdocuments":
		coll, err := collection()
		if err != nil {
			return resp, err
		}
		filter, err := mongoRawDoc(cmd.Filter, bson.D{})
		if err != nil {
			return resp, fmt.Errorf("invalid filter: %w", err)
		}
		count, err := coll.CountDocuments(ctx, filter)
		if err != nil {
			return resp, err
		}
		resp.Columns = []string{"count"}
		resp.Rows = []map[string]interface{}{{"count": count}}
	case "listcollections":
		names, err := db.ListCollectionNames(ctx, bson.D{})
		if err != nil {
			return resp, err
		}
		resp.Columns = []string{"collection"}
		resp.Rows = make([]map[string]interface{}, 0, len(names))
		for _, name := range names {
			resp.Rows = append(resp.Rows, map[string]interface{}{"collection": name})
		}
	case "listdatabases":
		names, err := client.ListDatabaseNames(ctx, bson.D{})
		if err != nil {
			return resp, err
		}
		resp.Columns = []string{"database"}
		resp.Rows = make([]map[string]interface{}, 0, len(names))
		for _, name := range names {
			resp.Rows = append(resp.Rows, map[string]interface{}{"database": name})
		}
	case "createcollection":
		if collectionName == "" {
			return resp, fmt.Errorf("createCollection requires collection")
		}
		if err := db.CreateCollection(ctx, collectionName); err != nil {
			return resp, err
		}
		resp.RowsAffected = 1
	case "dropcollection":
		coll, err := collection()
		if err != nil {
			return resp, err
		}
		if err := coll.Drop(ctx); err != nil {
			return resp, err
		}
		resp.RowsAffected = 1
	case "dropdatabase":
		if err := db.Drop(ctx); err != nil {
			return resp, err
		}
		resp.RowsAffected = 1
	case "runcommand":
		command, err := mongoRawDoc(cmd.Command, nil)
		if err != nil {
			return resp, fmt.Errorf("invalid command: %w", err)
		}
		var out bson.M
		if err := db.RunCommand(ctx, command).Decode(&out); err != nil {
			return resp, err
		}
		row := mongoDocToMap(out)
		resp.Columns = columnsFromRows([]map[string]interface{}{row})
		resp.Rows = []map[string]interface{}{row}
	default:
		return resp, fmt.Errorf("unsupported MongoDB operation %q", cmd.Operation)
	}
	resp.DurationMS = time.Since(start).Milliseconds()
	return resp, nil
}

func mongoDestructiveOperation(op string) (bool, bool) {
	switch op {
	case "insertone", "insertmany", "updateone", "updatemany", "deleteone", "deletemany":
		return true, op == "updatemany" || op == "deletemany"
	case "dropcollection", "dropdatabase":
		return true, true
	default:
		return false, false
	}
}

func mongoRawDoc(raw json.RawMessage, fallback interface{}) (interface{}, error) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" {
		return fallback, nil
	}
	var doc interface{}
	if err := bson.UnmarshalExtJSON(raw, true, &doc); err != nil {
		return nil, err
	}
	return doc, nil
}

func mongoRawDocuments(rawDocs []json.RawMessage) ([]interface{}, error) {
	if len(rawDocs) == 0 {
		return nil, fmt.Errorf("documents array is required")
	}
	docs := make([]interface{}, 0, len(rawDocs))
	for _, raw := range rawDocs {
		doc, err := mongoRawDoc(raw, nil)
		if err != nil {
			return nil, err
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

func mongoRawPipeline(rawStages []json.RawMessage) ([]interface{}, error) {
	if len(rawStages) == 0 {
		return nil, fmt.Errorf("pipeline array is required")
	}
	pipeline := make([]interface{}, 0, len(rawStages))
	for _, raw := range rawStages {
		stage, err := mongoRawDoc(raw, nil)
		if err != nil {
			return nil, err
		}
		pipeline = append(pipeline, stage)
	}
	return pipeline, nil
}

func mongoCursorRows(ctx context.Context, cursor *mongo.Cursor) ([]map[string]interface{}, error) {
	defer cursor.Close(ctx)
	var docs []bson.M
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	rows := make([]map[string]interface{}, 0, len(docs))
	for _, doc := range docs {
		rows = append(rows, mongoDocToMap(doc))
	}
	return rows, nil
}

func mongoDocToMap(doc interface{}) map[string]interface{} {
	bytes, err := bson.MarshalExtJSON(doc, false, false)
	if err != nil {
		return map[string]interface{}{"value": fmt.Sprint(doc)}
	}
	var row map[string]interface{}
	if err := json.Unmarshal(bytes, &row); err != nil {
		return map[string]interface{}{"value": string(bytes)}
	}
	return row
}

func mongoValue(value interface{}) interface{} {
	bytes, err := bson.MarshalExtJSON(bson.M{"value": value}, false, false)
	if err != nil {
		return fmt.Sprint(value)
	}
	var row map[string]interface{}
	if err := json.Unmarshal(bytes, &row); err != nil {
		return string(bytes)
	}
	return row["value"]
}

func columnsFromRows(rows []map[string]interface{}) []string {
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

func dbWriteJSON(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
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

func explainQuery(driver, query string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(query), ";")
	switch driver {
	case "mysql":
		return "EXPLAIN " + trimmed
	case "sqlite":
		return "EXPLAIN QUERY PLAN " + trimmed
	default:
		return "EXPLAIN " + trimmed
	}
}

func destructiveQuery(query string) (bool, bool) {
	upper := strings.ToUpper(strings.TrimSpace(query))
	destructive := strings.HasPrefix(upper, "DROP ") || strings.HasPrefix(upper, "DELETE ") || strings.HasPrefix(upper, "TRUNCATE ") || strings.HasPrefix(upper, "ALTER ") || strings.HasPrefix(upper, "UPDATE ")
	strict := strings.HasPrefix(upper, "DROP ") || strings.HasPrefix(upper, "TRUNCATE ") || (strings.HasPrefix(upper, "DELETE ") && !strings.Contains(upper, " WHERE ")) || (strings.HasPrefix(upper, "UPDATE ") && !strings.Contains(upper, " WHERE "))
	return destructive, strict
}

func runRows(ctx context.Context, db *sql.DB, query string) ([]string, []map[string]interface{}, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	out := make([]map[string]interface{}, 0)
	for rows.Next() {
		values := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		row := map[string]interface{}{}
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
