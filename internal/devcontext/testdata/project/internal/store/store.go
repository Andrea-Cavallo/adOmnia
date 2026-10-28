package store

import "os"

func open(db DB) {
	_ = os.Getenv("DATABASE_URL")
	db.Query("SELECT id, amount FROM payments WHERE id = $1")
}

// DB is the minimal surface the fixture needs to compile in an editor.
type DB interface {
	Query(query string, args ...any)
}
