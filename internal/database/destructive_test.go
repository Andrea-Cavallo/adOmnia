package database

import (
	"context"
	"strings"
	"testing"
)

func TestDestructiveQuery(t *testing.T) {
	cases := []struct {
		name        string
		query       string
		destructive bool
		strict      bool
	}{
		{"select", "SELECT * FROM users", false, false},
		{"update with where", "UPDATE users SET a = 1 WHERE id = 2", true, false},
		{"update where on next line", "UPDATE users SET a = 1\nWHERE id = 2", true, false},
		{"update where at end of line", "DELETE FROM users WHERE\n id = 2", true, false},
		{"update without where", "UPDATE users SET a = 1", true, true},
		{"delete without where", "DELETE FROM users", true, true},
		{"where only inside a string", "UPDATE users SET a = 'x WHERE y'", true, true},
		{"where only inside a comment", "DELETE FROM users -- WHERE id = 1", true, true},
		{"leading comment cannot hide a delete", "-- harmless\nDELETE FROM users", true, true},
		{"leading block comment", "/* x */ TRUNCATE users", true, true},
		{"second statement is destructive", "SELECT 1; DROP TABLE users", true, true},
		{"semicolon in string is not a split", "SELECT 'a;DROP TABLE x'", false, false},
		{"alter needs a flag but not strict", "ALTER TABLE users ADD c int", true, false},
		{"cte delete without where", "WITH x AS (SELECT 1) DELETE FROM users", true, true},
		{"dollar quoted body", "SELECT $$DROP TABLE x$$", false, false},
	}
	for _, tc := range cases {
		for _, driver := range []string{"postgres", "mysql", "sqlite"} {
			t.Run(driver+"/"+tc.name, func(t *testing.T) {
				destructive, strict := destructiveQuery(driver, tc.query)
				if destructive != tc.destructive || strict != tc.strict {
					t.Fatalf("destructiveQuery(%s, %q) = (%v, %v), want (%v, %v)", driver, tc.query, destructive, strict, tc.destructive, tc.strict)
				}
			})
		}
	}
}

func TestDestructiveQueryBackslashEscapesOnlyOnMySQL(t *testing.T) {
	// A backslash before the quote ends the string on PostgreSQL/SQLite, so the DELETE after it is real code.
	query := `SELECT '\'; DELETE FROM users; SELECT 'x'`
	for _, driver := range []string{"postgres", "sqlite"} {
		if _, strict := destructiveQuery(driver, query); !strict {
			t.Errorf("%s: DELETE after a literal backslash string must be strict", driver)
		}
	}
	// On MySQL the backslash escapes the quote, so the same text is one long string.
	if destructive, _ := destructiveQuery("mysql", query); destructive {
		t.Errorf("mysql: the text after an escaped quote is still inside the string")
	}
}

func TestMongoRunCommandAlwaysNeedsConfirmation(t *testing.T) {
	// Review di sicurezza DB-2: `runcommand` esegue comandi arbitrari (dropDatabase,
	// write massive, drop) e non è classificabile dal nome: sempre distruttivo e strict.
	destructive, strict := mongoDestructiveOperation("runcommand")
	if !destructive || !strict {
		t.Fatalf("mongoDestructiveOperation(runcommand) = (%v, %v), want (true, true)", destructive, strict)
	}
	_, err := runMongoQuery(context.Background(), dbQueryRequest{Query: `{"operation":"runcommand","command":{"dropDatabase":1}}`})
	if err == nil || !strings.Contains(err.Error(), "confirmation") {
		t.Fatalf("runcommand without confirm = %v, want a confirmation error", err)
	}
}

func TestDestructiveQueryCoversSideEffectStatements(t *testing.T) {
	// Review di sicurezza DB-2: CALL/DO/COPY/MERGE/REPLACE/LOAD/GRANT/REVOKE non erano
	// marcati e giravano senza conferma: possono cambiare dati o privilegi.
	for _, query := range []string{
		"CALL cleanup()",
		"DO $$ BEGIN NULL; END $$",
		"COPY users FROM '/tmp/x.csv'",
		"MERGE INTO users USING staging ON users.id = staging.id",
		"REPLACE INTO users VALUES (1, 'x')",
		"LOAD DATA INFILE 'x' INTO TABLE users",
		"GRANT SELECT ON users TO reader",
		"REVOKE SELECT ON users FROM reader",
	} {
		if destructive, strict := destructiveQuery("postgres", query); !destructive || !strict {
			t.Errorf("destructiveQuery(%q) = (%v, %v), want (true, true)", query, destructive, strict)
		}
	}
	// REPLACE usata come funzione dentro una SELECT resta una lettura.
	if destructive, strict := destructiveQuery("postgres", `SELECT REPLACE(name, 'a', 'b') FROM users`); destructive || strict {
		t.Fatalf("SELECT REPLACE() = (%v, %v), want (false, false)", destructive, strict)
	}
}
