package logindex

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// TestBenchmarkLargeFile measures what the acceptance criterion asks for:
// memory, time to the first event, filtering, cancellation and navigation on a
// log far larger than what the renderer could hold.
//
// It is opt-in because it writes a multi-gigabyte fixture:
//
//	ADOMNIA_LOGINDEX_BENCH_MB=1024 go test ./internal/logindex/ -run TestBenchmarkLargeFile -v -timeout 30m
//
// Set ADOMNIA_LOGINDEX_BENCH_DIR to place the fixture on a specific disk.
func TestBenchmarkLargeFile(t *testing.T) {
	raw := os.Getenv("ADOMNIA_LOGINDEX_BENCH_MB")
	if raw == "" {
		t.Skip("set ADOMNIA_LOGINDEX_BENCH_MB to run the large-file benchmark")
	}
	sizeMB, err := strconv.Atoi(raw)
	if err != nil || sizeMB <= 0 {
		t.Fatalf("ADOMNIA_LOGINDEX_BENCH_MB must be a positive number, got %q", raw)
	}

	dir := os.Getenv("ADOMNIA_LOGINDEX_BENCH_DIR")
	if dir == "" {
		dir = t.TempDir()
	}
	path := filepath.Join(dir, fmt.Sprintf("bench-%dmb.log", sizeMB))
	generated := generateFixture(t, path, int64(sizeMB)<<20)
	defer os.Remove(path)

	var before runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)

	openedAt := time.Now()
	job, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer Close(job.ID())

	// Time to the first usable page: the point at which the user sees data.
	var firstPage time.Duration
	for {
		if page := job.Query(Query{ID: job.ID(), Limit: 50, BudgetMs: 2000}); len(page.Entries) > 0 {
			firstPage = time.Since(openedAt)
			break
		}
		if job.Status().Done {
			t.Fatal("indexing finished without producing any record")
		}
		time.Sleep(2 * time.Millisecond)
	}

	for !job.Status().Done {
		time.Sleep(20 * time.Millisecond)
	}
	indexDuration := time.Since(openedAt)
	status := job.Status()

	var after runtime.MemStats
	runtime.ReadMemStats(&after)

	filterStart := time.Now()
	errorsPage := job.Query(Query{ID: job.ID(), Levels: []string{"error"}, Limit: 200, BudgetMs: 60_000})
	filterDuration := time.Since(filterStart)

	textStart := time.Now()
	textPage := job.Query(Query{ID: job.ID(), Text: "correlation-9999999", Limit: 50, BudgetMs: 60_000})
	textDuration := time.Since(textStart)

	// Navigation: jump to a page deep in the file, the worst case for paging.
	navStart := time.Now()
	deep := job.Query(Query{ID: job.ID(), From: status.Records - 200, Limit: 100, BudgetMs: 5000})
	navDuration := time.Since(navStart)
	if len(deep.Entries) == 0 {
		t.Fatal("navigating to the end of the index returned nothing")
	}

	budgetStart := time.Now()
	budgeted := job.Query(Query{ID: job.ID(), Text: "token-that-cannot-match", Limit: 10, BudgetMs: 200})
	budgetDuration := time.Since(budgetStart)

	cancelJob, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	cancelStart := time.Now()
	time.Sleep(50 * time.Millisecond)
	Cancel(cancelJob.ID())
	for !cancelJob.Status().Done {
		time.Sleep(2 * time.Millisecond)
	}
	cancelDuration := time.Since(cancelStart)
	cancelRecords := cancelJob.Status().Records
	Close(cancelJob.ID())

	t.Logf("host              : %s/%s, %d CPU, Go %s", runtime.GOOS, runtime.GOARCH, runtime.NumCPU(), runtime.Version())
	t.Logf("fixture           : %.2f GB, %d records", float64(generated)/(1<<30), status.Records)
	t.Logf("index             : %.2f s, %.1f MB/s, index file %.1f MB (%.2f%% of the log)",
		indexDuration.Seconds(),
		float64(generated)/(1<<20)/indexDuration.Seconds(),
		float64(status.IndexBytes)/(1<<20),
		100*float64(status.IndexBytes)/float64(generated))
	t.Logf("first page        : %.0f ms", float64(firstPage.Microseconds())/1000)
	t.Logf("heap after index  : %.1f MB (was %.1f MB before opening)",
		float64(after.HeapAlloc)/(1<<20), float64(before.HeapAlloc)/(1<<20))
	t.Logf("filter level=error: %.0f ms for %d records (scanned %d, exhausted=%v)",
		float64(filterDuration.Microseconds())/1000, len(errorsPage.Entries), errorsPage.Scanned, errorsPage.Exhausted)
	t.Logf("full-text scan    : %.0f ms for %d hits (scanned %d)",
		float64(textDuration.Microseconds())/1000, len(textPage.Entries), textPage.Scanned)
	t.Logf("navigate to end   : %.0f ms for %d records", float64(navDuration.Microseconds())/1000, len(deep.Entries))
	t.Logf("budget 200 ms     : returned after %.0f ms, exceeded=%v, scanned %d, resume at %d",
		float64(budgetDuration.Microseconds())/1000, budgeted.BudgetExceeded, budgeted.Scanned, budgeted.NextFrom)
	t.Logf("cancel indexing   : stopped %.0f ms after start, %d records kept",
		float64(cancelDuration.Microseconds())/1000, cancelRecords)

	if float64(after.HeapAlloc) > float64(generated)/4 {
		t.Fatalf("indexing must not scale with the file size: heap %d for a %d byte log", after.HeapAlloc, generated)
	}
}

// generateFixture writes a realistic mixed log (plain lines, JSON lines and
// Java stack traces) until it reaches at least target bytes.
func generateFixture(t *testing.T, path string, target int64) int64 {
	t.Helper()
	if info, err := os.Stat(path); err == nil && info.Size() >= target {
		t.Logf("reusing existing fixture %s (%.2f GB)", path, float64(info.Size())/(1<<30))
		return info.Size()
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	writer := bufio.NewWriterSize(file, 4<<20)

	start := time.Now()
	base := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	var written int64
	for index := 0; written < target; index++ {
		stamp := base.Add(time.Duration(index) * time.Millisecond).Format(time.RFC3339Nano)
		var line string
		switch index % 20 {
		case 0:
			line = fmt.Sprintf(`{"time":"%s","level":"error","service":"orders","correlation_id":"correlation-%d","msg":"payment declined","http":{"status_code":502}}`, stamp, index)
		case 1:
			line = fmt.Sprintf("%s ERROR [orders] correlation-%d java.lang.IllegalStateException: order %d is not payable", stamp, index, index)
		case 2:
			line = "\tat com.acme.orders.OrderService.create(OrderService.java:142)"
		case 3:
			line = "\tat org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1071)"
		case 4:
			line = fmt.Sprintf(`{"time":"%s","level":"warn","service":"gateway","correlation_id":"correlation-%d","msg":"upstream slow","latency_ms":%d}`, stamp, index, 500+index%900)
		default:
			line = fmt.Sprintf("%s INFO  [gateway] correlation-%d handled GET /api/v1/orders/%d in %d ms", stamp, index, index%100000, index%250)
		}
		count, err := writer.WriteString(line + "\n")
		if err != nil {
			t.Fatal(err)
		}
		written += int64(count)
	}
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	t.Logf("generated %.2f GB fixture in %.1f s", float64(written)/(1<<30), time.Since(start).Seconds())
	return written
}
