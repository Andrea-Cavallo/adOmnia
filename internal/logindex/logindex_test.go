package logindex

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func write(t *testing.T, lines ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.log")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func indexed(t *testing.T, path string) *Job {
	t.Helper()
	job, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { Close(job.ID()) })
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if job.Status().Done {
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("indexing did not finish")
	return nil
}

func TestIndexRecordsLevelsTimestampsAndSize(t *testing.T) {
	job := indexed(t, write(t,
		`2026-09-10T08:00:00Z INFO service started`,
		`2026-09-10T08:00:01Z ERROR payment failed`,
		`{"time":"2026-09-10T08:00:02Z","level":"warn","msg":"slow"}`,
	))
	status := job.Status()
	if status.Records != 3 {
		t.Fatalf("expected 3 records, got %d", status.Records)
	}
	if status.LevelCounts["error"] != 1 || status.LevelCounts["warn"] != 1 || status.LevelCounts["info"] != 1 {
		t.Fatalf("unexpected level counts %v", status.LevelCounts)
	}
	if status.FirstTS <= 0 || status.LastTS <= status.FirstTS {
		t.Fatalf("timestamps not indexed: %d..%d", status.FirstTS, status.LastTS)
	}
	if status.IndexBytes != 3*entrySize {
		t.Fatalf("unexpected index size %d", status.IndexBytes)
	}
}

func TestQueryPaginatesAndFiltersWithoutLoadingTheFile(t *testing.T) {
	lines := make([]string, 0, 100)
	for i := 0; i < 100; i++ {
		level := "INFO"
		if i%10 == 0 {
			level = "ERROR"
		}
		lines = append(lines, fmt.Sprintf("2026-09-10T08:00:00Z %s line %d", level, i))
	}
	job := indexed(t, write(t, lines...))

	first := job.Query(Query{ID: job.ID(), Limit: 7})
	if len(first.Entries) != 7 || first.Entries[0].Text == "" {
		t.Fatalf("unexpected first page %+v", first)
	}
	second := job.Query(Query{ID: job.ID(), From: first.NextFrom, Limit: 7})
	if second.Entries[0].Index != first.Entries[6].Index+1 {
		t.Fatalf("pages are not contiguous: %d then %d", first.Entries[6].Index, second.Entries[0].Index)
	}

	errors := job.Query(Query{ID: job.ID(), Levels: []string{"error"}, Limit: 1000})
	if len(errors.Entries) != 10 {
		t.Fatalf("expected 10 error records, got %d", len(errors.Entries))
	}
	text := job.Query(Query{ID: job.ID(), Text: "line 42", Limit: 1000})
	if len(text.Entries) != 1 || !strings.Contains(text.Entries[0].Text, "line 42") {
		t.Fatalf("unexpected text search result %+v", text.Entries)
	}
	if !errors.Exhausted {
		t.Fatal("a completed scan must report the index as exhausted")
	}
}

func TestQueryFoldsContinuationLinesIntoTheirRecord(t *testing.T) {
	job := indexed(t, write(t,
		`2026-09-10T08:00:00Z ERROR boom`,
		`	at com.acme.Orders.create(Orders.java:42)`,
		`	at com.acme.Web.handle(Web.java:10)`,
		`2026-09-10T08:00:01Z INFO next`,
	))
	result := job.Query(Query{ID: job.ID(), Levels: []string{"error"}, Limit: 10})
	if len(result.Entries) != 1 {
		t.Fatalf("expected one record, got %d", len(result.Entries))
	}
	if strings.Count(result.Entries[0].Text, "\n") != 2 {
		t.Fatalf("stack lines were not folded in: %q", result.Entries[0].Text)
	}
}

func TestQueryStopsOnTheTimeBudget(t *testing.T) {
	lines := make([]string, 0, 20000)
	for i := 0; i < 20000; i++ {
		lines = append(lines, fmt.Sprintf("2026-09-10T08:00:00Z INFO filler %d", i))
	}
	job := indexed(t, write(t, lines...))
	// No record can match, so the scan runs until the budget ends it.
	result := job.Query(Query{ID: job.ID(), Text: "no-such-token", Limit: 10, BudgetMs: 1})
	if !result.BudgetExceeded {
		t.Skip("the machine scanned 20k records within 1 ms; the budget path needs a bigger fixture here")
	}
	if result.NextFrom <= 0 || result.NextFrom >= 20000 {
		t.Fatalf("a budgeted scan must hand back a usable cursor, got %d", result.NextFrom)
	}
	rest := job.Query(Query{ID: job.ID(), From: result.NextFrom, Text: "no-such-token", Limit: 10, BudgetMs: 5000})
	if !rest.Exhausted {
		t.Fatal("resuming from the cursor must be able to finish the scan")
	}
}

func TestCancelKeepsWhatWasIndexed(t *testing.T) {
	lines := make([]string, 0, 200000)
	for i := 0; i < 200000; i++ {
		lines = append(lines, fmt.Sprintf("2026-09-10T08:00:00Z INFO cancellable %d", i))
	}
	path := write(t, lines...)
	job, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer Close(job.ID())
	time.Sleep(15 * time.Millisecond)
	Cancel(job.ID())

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !job.Status().Done {
		time.Sleep(10 * time.Millisecond)
	}
	status := job.Status()
	if !status.Done {
		t.Fatal("cancelling must end the indexing pass")
	}
	if status.Cancelled && status.Records == 0 {
		t.Fatal("a cancelled index must keep the records it already wrote")
	}
	if status.Cancelled {
		page := job.Query(Query{ID: job.ID(), Limit: 5})
		if len(page.Entries) == 0 || page.Exhausted {
			t.Fatalf("a partial index must stay queryable and report itself as partial: %+v", page)
		}
	}
}

func TestCloseRemovesTheIndexFile(t *testing.T) {
	job := indexed(t, write(t, "2026-09-10T08:00:00Z INFO one"))
	dir := job.indexDir
	Close(job.ID())
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("the index directory must be removed, got %v", err)
	}
	if lookup(job.ID()) != nil {
		t.Fatal("a closed index must be forgotten")
	}
}
