package database

import (
	"context"
	"database/sql"
	"encoding/json/v2"
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
	"regexp"
	"strings"
	"time"
)

var agentSQLWrite = regexp.MustCompile(`(?i)\b(INTO|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|GRANT|REVOKE|COPY|CALL|EXEC|EXECUTE|DO|SET|PRAGMA|ATTACH|DETACH|LOCK|UNLOCK)\b`)

func validateAgentReadQuery(driver, query string) error {
	code := strings.TrimSpace(maskSQLNonCode(query, backslashEscapesStrings(driver)))
	code = strings.TrimSpace(strings.TrimSuffix(code, ";"))
	fields := strings.Fields(strings.ToUpper(code))
	if len(fields) == 0 || (fields[0] != "SELECT" && fields[0] != "WITH" && fields[0] != "EXPLAIN") || strings.Contains(code, ";") || agentSQLWrite.MatchString(code) {
		return fmt.Errorf("agent queries support one read-only SELECT, WITH or EXPLAIN statement")
	}
	return nil
}

// AgentQuery uses a saved connection; credentials are never part of the agent contract.
// The database transaction enforces read-only execution, including SQL functions and CTEs.
func AgentQuery(parent context.Context, connectionID, query string, limit int) (any, error) {
	if strings.TrimSpace(connectionID) == "" || strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("connectionId and query are required")
	}
	config, err := savedConfig(connectionID)
	if err != nil {
		return nil, fmt.Errorf("saved connection not found")
	}
	config, err = resolveCredentials(config)
	if err != nil {
		return nil, fmt.Errorf("%s", safeDatabaseError(err))
	}
	db, driver, err := openDatabase(config)
	if err != nil {
		return nil, fmt.Errorf("%s", safeDatabaseError(err))
	}
	defer db.Close()
	if err := validateAgentReadQuery(driver, query); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("%s", safeDatabaseError(err))
	}
	defer conn.Close()
	if driver == "sqlite" || driver == "sqlite3" {
		if _, err = conn.ExecContext(ctx, "PRAGMA query_only = ON"); err != nil {
			return nil, err
		}
	}
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("%s", safeDatabaseError(err))
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("%s", safeDatabaseError(err))
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	result := []map[string]any{}
	for rows.Next() {
		if len(result) == limit {
			return map[string]any{"columns": columns, "rows": result, "limited": true}, nil
		}
		values := make([]any, len(columns))
		dest := make([]any, len(columns))
		for i := range dest {
			dest[i] = &values[i]
		}
		if err = rows.Scan(dest...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, key := range columns {
			if value, ok := values[i].([]byte); ok {
				row[key] = string(value)
			} else {
				row[key] = values[i]
			}
		}
		result = append(result, row)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("%s", safeDatabaseError(err))
	}
	return map[string]any{"columns": columns, "rows": result, "limited": false}, nil
}

// AgentConnections returns identifiers and driver names, never connection strings or credentials.
func AgentConnections() (any, error) {
	raw, err := storage.Get("database", "connections")
	if err != nil {
		return nil, err
	}
	var configs []dbConnectionRequest
	if err = json.Unmarshal(raw, &configs); err != nil {
		return nil, fmt.Errorf("saved connections unavailable")
	}
	result := []map[string]string{}
	for _, config := range configs {
		switch strings.ToLower(config.Driver) {
		case "sqlite", "sqlite3", "postgres", "postgresql", "pgx", "mysql":
			result = append(result, map[string]string{"id": config.ID, "driver": config.Driver})
		}
	}
	return result, nil
}
