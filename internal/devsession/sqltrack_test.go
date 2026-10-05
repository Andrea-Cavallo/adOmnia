package devsession

import (
	"encoding/binary"
	"testing"
	"time"
)

type fakeClock struct{ at time.Time }

func (c *fakeClock) now() time.Time { return c.at }
func (c *fakeClock) advance(d time.Duration) {
	c.at = c.at.Add(d)
}

func newTestTracker() (*statementTracker, *fakeClock, *[]Statement) {
	clock := &fakeClock{at: time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)}
	var recorded []Statement
	tracker := newStatementTracker(func(statement Statement) { recorded = append(recorded, statement) })
	tracker.now = clock.now
	return tracker, clock, &recorded
}

func TestPostgresTrackerPairsStatementsWithResponses(t *testing.T) {
	tracker, clock, recorded := newTestTracker()
	// Query semplice con righe.
	tracker.pgClientMessage('Q', []byte("SELECT * FROM orders\x00"))
	clock.advance(12 * time.Millisecond)
	tracker.pgServerMessage('T', nil)
	tracker.pgServerMessage('D', nil)
	tracker.pgServerMessage('C', []byte("SELECT 3\x00"))
	tracker.pgServerMessage('Z', []byte{'I'})
	// Protocollo esteso con statement preparato in cache (pgx): Parse una volta, poi solo Bind/Execute.
	tracker.pgClientMessage('P', []byte("stmtcache_1\x00UPDATE orders SET paid = true WHERE id = $1\x00\x00\x00"))
	tracker.pgClientMessage('B', []byte("\x00stmtcache_1\x00\x00\x00"))
	tracker.pgClientMessage('E', []byte("\x00\x00\x00\x00\x00"))
	tracker.pgClientMessage('S', nil)
	clock.advance(3 * time.Millisecond)
	tracker.pgServerMessage('1', nil)
	tracker.pgServerMessage('2', nil)
	tracker.pgServerMessage('C', []byte("UPDATE 2\x00"))
	tracker.pgServerMessage('Z', []byte{'I'})
	tracker.pgClientMessage('B', []byte("\x00stmtcache_1\x00\x00\x00"))
	tracker.pgClientMessage('E', []byte("\x00\x00\x00\x00\x00"))
	tracker.pgServerMessage('C', []byte("UPDATE 1\x00"))
	tracker.pgServerMessage('Z', []byte{'I'})

	if len(*recorded) != 3 {
		t.Fatalf("recorded %+v", *recorded)
	}
	first, second, third := (*recorded)[0], (*recorded)[1], (*recorded)[2]
	if first.SQL != "SELECT * FROM orders" || first.Rows != 3 || first.Duration != 12*time.Millisecond || !first.Completed {
		t.Fatalf("simple query: %+v", first)
	}
	if second.SQL != "UPDATE orders SET paid = true WHERE id = $1" || second.Rows != 2 || second.Duration != 3*time.Millisecond {
		t.Fatalf("extended query: %+v", second)
	}
	if third.SQL != second.SQL || third.Rows != 1 {
		t.Fatalf("cached statement: %+v", third)
	}
}

func TestPostgresTrackerErrorsAndTransactions(t *testing.T) {
	tracker, clock, recorded := newTestTracker()
	tracker.pgClientMessage('Q', []byte("BEGIN\x00"))
	tracker.pgServerMessage('C', []byte("BEGIN\x00"))
	tracker.pgServerMessage('Z', []byte{'T'})
	clock.advance(40 * time.Millisecond)
	tracker.pgClientMessage('Q', []byte("INSERT INTO users (email) VALUES ('a@b.c')\x00"))
	tracker.pgServerMessage('E', []byte("SERROR\x00C23505\x00Mduplicate key value violates unique constraint\x00\x00"))
	tracker.pgServerMessage('Z', []byte{'E'})
	clock.advance(10 * time.Millisecond)
	tracker.pgClientMessage('Q', []byte("ROLLBACK\x00"))
	tracker.pgServerMessage('C', []byte("ROLLBACK\x00"))
	tracker.pgServerMessage('Z', []byte{'I'})

	if len(*recorded) != 4 {
		t.Fatalf("recorded %+v", *recorded)
	}
	failed := (*recorded)[1]
	if failed.Error != "duplicate key value violates unique constraint" || failed.Code != "23505" || failed.Rows != -1 {
		t.Fatalf("error: %+v", failed)
	}
	transaction := (*recorded)[3]
	if transaction.Kind != "transaction" || transaction.Duration != 50*time.Millisecond || transaction.Error == "" {
		t.Fatalf("transaction: %+v", transaction)
	}
	// Un'istruzione senza risposta (connessione chiusa) viene registrata come non completata.
	tracker.pgClientMessage('Q', []byte("SELECT pg_sleep(10)\x00"))
	tracker.flush()
	if last := (*recorded)[len(*recorded)-1]; last.Completed || last.SQL != "SELECT pg_sleep(10)" {
		t.Fatalf("flushed: %+v", last)
	}
}

func lengthEncodedInt(value int) []byte {
	return []byte{byte(value)}
}

func TestMySQLTrackerResultSetsOKAndErrors(t *testing.T) {
	for _, deprecateEOF := range []bool{false, true} {
		tracker, clock, recorded := newTestTracker()
		if deprecateEOF {
			tracker.mysqlCapabilities(mysqlDeprecateEOF, mysqlDeprecateEOF)
		}
		responses := &mysqlResponses{tracker: tracker}
		eof := []byte{0xfe, 0, 0, 2, 0}
		tracker.mysqlCommand(append([]byte{mysqlComQuery}, "SELECT id, name FROM users"...))
		clock.advance(5 * time.Millisecond)
		responses.packet(lengthEncodedInt(2))
		responses.packet([]byte("\x03defcol1"))
		responses.packet([]byte("\x03defcol2"))
		if !deprecateEOF {
			responses.packet(eof)
		}
		for range 3 {
			responses.packet([]byte("\x011\x03ann"))
		}
		responses.packet(eof)
		// Un risultato vuoto: dopo le colonne arriva subito il terminatore.
		tracker.mysqlCommand(append([]byte{mysqlComQuery}, "SELECT id FROM users WHERE 1 = 0"...))
		responses.packet(lengthEncodedInt(1))
		responses.packet([]byte("\x03defcol1"))
		if !deprecateEOF {
			responses.packet(eof)
		}
		responses.packet(eof)
		tracker.mysqlCommand(append([]byte{mysqlComQuery}, "UPDATE users SET name = 'x'"...))
		responses.packet([]byte{0x00, 4, 0, 2, 0, 0, 0})
		tracker.mysqlCommand([]byte{0x0e}) // COM_PING: risposta OK, nessuna istruzione
		responses.packet([]byte{0x00, 0, 0, 2, 0, 0, 0})
		tracker.mysqlCommand(append([]byte{mysqlComQuery}, "SELECT * FROM missing"...))
		responses.packet(append([]byte{0xff, 0x7a, 0x04, '#', '4', '2', 'S', '0', '2'}, "Table 'shop.missing' doesn't exist"...))

		got := *recorded
		if len(got) != 4 {
			t.Fatalf("deprecateEOF=%v recorded %+v", deprecateEOF, got)
		}
		if got[0].Rows != 3 || got[0].Duration != 5*time.Millisecond || got[1].Rows != 0 || got[2].Rows != 4 {
			t.Fatalf("deprecateEOF=%v rows: %+v", deprecateEOF, got)
		}
		if got[3].Code != "1146" || got[3].Error != "Table 'shop.missing' doesn't exist" {
			t.Fatalf("error: %+v", got[3])
		}
	}
}

func TestMySQLTrackerPreparedStatements(t *testing.T) {
	tracker, _, recorded := newTestTracker()
	responses := &mysqlResponses{tracker: tracker}
	eof := []byte{0xfe, 0, 0, 2, 0}
	tracker.mysqlCommand(append([]byte{mysqlComStmtPrepare}, "SELECT name FROM users WHERE id = ?"...))
	prepareOK := []byte{0x00, 7, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0}
	responses.packet(prepareOK)
	responses.packet([]byte("\x03defparam"))
	responses.packet(eof)
	responses.packet([]byte("\x03defcol"))
	responses.packet(eof)
	execute := make([]byte, 10)
	execute[0] = mysqlComStmtExecute
	binary.LittleEndian.PutUint32(execute[1:], 7)
	tracker.mysqlCommand(execute)
	responses.packet(lengthEncodedInt(1))
	responses.packet([]byte("\x03defcol"))
	responses.packet(eof)
	responses.packet([]byte{0x00, 0x00, 0x03, 'a', 'n', 'n'})
	responses.packet(eof)
	if len(*recorded) != 1 || (*recorded)[0].SQL != "SELECT name FROM users WHERE id = ?" || (*recorded)[0].Rows != 1 {
		t.Fatalf("prepared: %+v", *recorded)
	}
}
