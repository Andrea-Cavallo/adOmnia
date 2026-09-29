package store

import "os"

func open(db DB) {
	_ = os.Getenv("DATABASE_URL")
	db.Query("SELECT id, amount FROM payments WHERE id = $1")
}
