package database

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// StatementMarks is a cursor over the statements a PostgreSQL database has run:
// pg_stat_statements calls per query id when it was taken.
type StatementMarks map[string]int64

// ObservedStatement is a normalized statement ($1 placeholders, no literal values) that ran
// after the marks, with how many times.
type ObservedStatement struct {
	Query string `json:"query"`
	Calls int64  `json:"calls"`
}

// ErrStatementsUnavailable means the database cannot report its statements: not PostgreSQL,
// or pg_stat_statements is not enabled. It is "not collected", never "no queries".
var ErrStatementsUnavailable = errors.New("only PostgreSQL with the pg_stat_statements extension reports its queries")

// ponytail: pg_stat_statements is server-wide; every client of the same database shows up, not only the
// service under test. A wire proxy in front of the database is the upgrade if that matters.
const statementsQuery = `SELECT queryid::text, calls, query FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query NOT LIKE '%pg_stat_statements%'`

type statementRow struct {
	id    string
	calls int64
	query string
}

func readStatements(ctx context.Context, connectionID string) ([]statementRow, error) {
	cfg, err := savedConfig(connectionID)
	if err != nil {
		return nil, err
	}
	h, release, err := connections.acquire(ctx, cfg)
	if err != nil {
		return nil, errors.New(safeDatabaseError(err))
	}
	defer release()
	if h.sql == nil || h.driver != "postgres" {
		return nil, ErrStatementsUnavailable
	}
	rows, err := h.sql.QueryContext(ctx, statementsQuery)
	if err != nil {
		if strings.Contains(err.Error(), "pg_stat_statements") {
			return nil, ErrStatementsUnavailable
		}
		return nil, errors.New(safeDatabaseError(err))
	}
	defer rows.Close()
	var list []statementRow
	for rows.Next() {
		var row statementRow
		if err := rows.Scan(&row.id, &row.calls, &row.query); err != nil {
			return nil, fmt.Errorf("read pg_stat_statements: %w", err)
		}
		list = append(list, row)
	}
	return list, rows.Err()
}

// MarkStatements records how many times each statement has run on the saved connection so far.
func MarkStatements(ctx context.Context, connectionID string) (StatementMarks, error) {
	rows, err := readStatements(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	marks := make(StatementMarks, len(rows))
	for _, row := range rows {
		marks[row.id] = row.calls
	}
	return marks, nil
}

// StatementsSince returns the statements that ran after marks, most called first, at most limit.
func StatementsSince(ctx context.Context, connectionID string, marks StatementMarks, limit int) ([]ObservedStatement, int, error) {
	rows, err := readStatements(ctx, connectionID)
	if err != nil {
		return nil, 0, err
	}
	statements, dropped := newStatements(marks, rows, limit)
	return statements, dropped, nil
}

func newStatements(marks StatementMarks, rows []statementRow, limit int) ([]ObservedStatement, int) {
	var statements []ObservedStatement
	for _, row := range rows {
		if calls := row.calls - marks[row.id]; calls > 0 {
			statements = append(statements, ObservedStatement{Query: row.query, Calls: calls})
		}
	}
	slices.SortFunc(statements, func(a, b ObservedStatement) int {
		if a.Calls != b.Calls {
			return int(b.Calls - a.Calls)
		}
		return strings.Compare(a.Query, b.Query)
	})
	if len(statements) > limit {
		return statements[:limit], len(statements) - limit
	}
	return statements, 0
}
