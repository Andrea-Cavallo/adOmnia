package database

import "testing"

func TestNewStatementsKeepsOnlyWhatRanAfterTheMarks(t *testing.T) {
	marks := StatementMarks{"1": 10, "2": 3}
	rows := []statementRow{
		{id: "1", calls: 10, query: "SELECT 1"},                          // unchanged
		{id: "2", calls: 5, query: "UPDATE orders SET paid = $1"},        // ran twice
		{id: "3", calls: 1, query: "INSERT INTO orders VALUES ($1, $2)"}, // new
	}
	statements, dropped := newStatements(marks, rows, 10)
	if len(statements) != 2 || dropped != 0 || statements[0].Calls != 2 || statements[1].Query != "INSERT INTO orders VALUES ($1, $2)" {
		t.Fatalf("statements = %+v, dropped = %d", statements, dropped)
	}
	if limited, dropped := newStatements(marks, rows, 1); len(limited) != 1 || dropped != 1 {
		t.Fatalf("the limit must count what it drops: %+v, %d", limited, dropped)
	}
}
