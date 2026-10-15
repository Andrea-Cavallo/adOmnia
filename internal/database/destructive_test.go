package database

import "testing"

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
