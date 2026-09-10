// Package logindex makes a log file larger than the available RAM usable.
//
// The file is never loaded. It is scanned once, in a streaming pass, and every
// record is described by a fixed-size entry written to an index file on disk:
// where the record starts, how long it is, when it happened, at which level,
// and whether it continues the record above it. Queries then walk that index —
// 24 bytes per record instead of the record itself — and read from the log
// only the bytes of the page they are about to return.
//
// Everything is bounded and interruptible: indexing runs in its own goroutine
// and can be cancelled, and every query carries a time budget, reports how far
// it got and hands back a cursor to continue from.
package logindex

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// entrySize is the on-disk footprint of one record: offset, length, timestamp,
// level and flags. Five million lines of a 1 GB log cost ~120 MB of index,
// which is read sequentially and never held in memory as a whole.
const entrySize = 24

const (
	flagContinuation = 1 << 0 // stack-trace line belonging to the record above
	defaultBudgetMs  = 1500
	maxLineBytes     = 4 << 20
	readBufferBytes  = 1 << 20
)

// Levels are stored as a small integer so a level filter never touches the log.
var levelNames = []string{"unknown", "trace", "debug", "info", "warn", "error", "fatal"}

func levelCode(name string) uint8 {
	for code, candidate := range levelNames {
		if strings.EqualFold(candidate, name) {
			return uint8(code)
		}
	}
	return 0
}

type Entry struct {
	Index  int64  `json:"index"`
	Offset int64  `json:"offset"`
	Length int32  `json:"length"`
	TS     int64  `json:"ts"` // unix milliseconds, -1 when unknown
	Level  string `json:"level"`
	// True when this line continues the record above (stack trace, wrapped text).
	Continuation bool   `json:"continuation"`
	Text         string `json:"text"`
}

type Status struct {
	ID          string           `json:"id"`
	Path        string           `json:"path"`
	Name        string           `json:"name"`
	Size        int64            `json:"size"`
	BytesRead   int64            `json:"bytesRead"`
	Records     int64            `json:"records"`
	Done        bool             `json:"done"`
	Cancelled   bool             `json:"cancelled"`
	Error       string           `json:"error"`
	FirstTS     int64            `json:"firstTs"`
	LastTS      int64            `json:"lastTs"`
	LevelCounts map[string]int64 `json:"levelCounts"`
	// Wall-clock milliseconds from open() to the first indexed record.
	FirstRecordMs int64 `json:"firstRecordMs"`
	IndexBytes    int64 `json:"indexBytes"`
}

type Job struct {
	id        string
	path      string
	size      int64
	indexDir  string
	indexPath string

	mu          sync.Mutex
	writer      *os.File
	reader      *os.File
	records     int64
	bytesRead   int64
	done        bool
	cancelled   bool
	err         string
	firstTS     int64
	lastTS      int64
	levelCounts [8]int64
	startedAt   time.Time
	firstRecord time.Duration
	cancel      context.CancelFunc
}

var (
	jobs     = map[string]*Job{}
	jobsMu   sync.Mutex
	sequence int64
)

// ─── Lightweight field extraction ────────────────────────────────────────────
//
// The index only needs a level and a timestamp. Full normalization stays in the
// renderer, which parses a page at a time; duplicating it here would mean
// maintaining the same field-alias table twice.

// containsFold reports whether needle (which must be upper-case ASCII) appears
// in head, ignoring case, without allocating a folded copy of the line.
func containsFold(head []byte, needle string) bool {
	limit := len(head) - len(needle)
	for start := 0; start <= limit; start++ {
		match := true
		for offset := 0; offset < len(needle); offset++ {
			character := head[start+offset]
			if character >= 'a' && character <= 'z' {
				character -= 32
			}
			if character != needle[offset] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func detectLevel(line []byte) uint8 {
	head := line
	if len(head) > 256 {
		head = head[:256]
	}
	switch {
	case containsFold(head, "FATAL"), containsFold(head, "PANIC"), containsFold(head, "SEVERE"):
		return levelCode("fatal")
	case containsFold(head, "ERROR"), containsFold(head, "\"ERR\""):
		return levelCode("error")
	case containsFold(head, "WARN"):
		return levelCode("warn")
	case containsFold(head, "INFO"), containsFold(head, "NOTICE"):
		return levelCode("info")
	case containsFold(head, "DEBUG"):
		return levelCode("debug")
	case containsFold(head, "TRACE"):
		return levelCode("trace")
	default:
		return 0
	}
}

var timestampLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05.000",
	"2006-01-02 15:04:05.000",
	"2006-01-02 15:04:05",
	"2006/01/02 15:04:05",
	"02/Jan/2006:15:04:05 -0700",
}

// firstTokens returns the first two whitespace-separated tokens of the head of
// a line. Only the head is scanned: a one-line 200 MB JSON must not be walked
// looking for a date.
func firstTokens(text []byte) ([]byte, []byte) {
	head := text
	if len(head) > 128 {
		head = head[:128]
	}
	cut := bytes.IndexAny(head, " 	")
	if cut < 0 {
		return head, nil
	}
	first := head[:cut]
	rest := bytes.TrimLeft(head[cut:], " 	")
	if next := bytes.IndexAny(rest, " 	"); next >= 0 {
		return first, rest[:next]
	}
	return first, rest
}

// tryLayouts parses one candidate token against the known layouts. Only the
// token is turned into a string, never the line.
func tryLayouts(candidate []byte) int64 {
	if len(candidate) < 8 {
		return -1
	}
	// A comma is the European decimal separator in log4j/logback output.
	text := strings.Replace(string(bytes.TrimRight(candidate, ",];")), ",", ".", 1)
	for _, layout := range timestampLayouts {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.UnixMilli()
		}
	}
	return -1
}

// parseTimestamp reads a leading timestamp. Candidates are whole tokens, not a
// fixed-width slice: `2026-09-10T08:00:00Z INFO ...` and
// `2026-09-10 08:00:05,123 INFO ...` must both be recognized.
func parseTimestamp(text []byte) int64 {
	trimmed := bytes.TrimLeft(text, "[ 	")
	if len(trimmed) == 0 {
		return -1
	}
	first, second := firstTokens(trimmed)
	if ts := tryLayouts(first); ts >= 0 {
		return ts
	}
	if len(second) == 0 {
		return -1
	}
	pair := make([]byte, 0, len(first)+1+len(second))
	pair = append(append(append(pair, first...), ' '), second...)
	return tryLayouts(pair)
}

var timestampKeys = [][]byte{
	[]byte(`"timestamp":`), []byte(`"time":`), []byte(`"ts":`), []byte(`"@timestamp":`), []byte(`"eventTime":`),
}

// jsonTimestamp pulls the value of the first timestamp-looking key. It is a
// scan, not a JSON parse: the index pass must stay linear in the line length.
func jsonTimestamp(line []byte) int64 {
	for _, key := range timestampKeys {
		start := bytes.Index(line, key)
		if start < 0 {
			continue
		}
		rest := bytes.TrimLeft(line[start+len(key):], " ")
		if len(rest) == 0 {
			continue
		}
		if rest[0] == '"' {
			if end := bytes.IndexByte(rest[1:], '"'); end > 0 {
				if ts := parseTimestamp(rest[1 : 1+end]); ts >= 0 {
					return ts
				}
			}
			continue
		}
		end := bytes.IndexAny(rest, ",}")
		if end < 0 {
			end = len(rest)
		}
		if numeric, err := strconv.ParseFloat(string(bytes.TrimSpace(rest[:end])), 64); err == nil && numeric > 0 {
			// Seconds, milliseconds or microseconds, told apart by magnitude.
			switch {
			case numeric > 1e14:
				return int64(numeric / 1000)
			case numeric > 1e11:
				return int64(numeric)
			default:
				return int64(numeric * 1000)
			}
		}
	}
	return -1
}

func timestampOf(line []byte) int64 {
	if ts := parseTimestamp(line); ts >= 0 {
		return ts
	}
	if bytes.IndexByte(line, '"') >= 0 {
		return jsonTimestamp(line)
	}
	return -1
}

// isContinuation recognizes the lines a record spills onto: stack frames,
// `Caused by:` chains and indented wrapped text.
func isContinuation(line []byte) bool {
	if len(line) == 0 {
		return false
	}
	if line[0] == ' ' || line[0] == '	' {
		return true
	}
	trimmed := bytes.TrimSpace(line)
	return bytes.HasPrefix(trimmed, []byte("at ")) ||
		bytes.HasPrefix(trimmed, []byte("Caused by:")) ||
		bytes.HasPrefix(trimmed, []byte("... ")) ||
		bytes.HasPrefix(trimmed, []byte("Suppressed:"))
}

// ─── Indexing ────────────────────────────────────────────────────────────────

// writeEntry appends to the buffered index writer. One 24-byte write per line
// straight to the file would make indexing syscall-bound, not I/O-bound.
func writeEntry(writer *bufio.Writer, offset int64, length int32, ts int64, level uint8, flags uint8) error {
	var buffer [entrySize]byte
	binary.LittleEndian.PutUint64(buffer[0:8], uint64(offset))
	binary.LittleEndian.PutUint32(buffer[8:12], uint32(length))
	binary.LittleEndian.PutUint64(buffer[12:20], uint64(ts))
	buffer[20] = level
	buffer[21] = flags
	_, err := writer.Write(buffer[:])
	return err
}

func decodeEntry(buffer []byte, index int64) Entry {
	return Entry{
		Index:        index,
		Offset:       int64(binary.LittleEndian.Uint64(buffer[0:8])),
		Length:       int32(binary.LittleEndian.Uint32(buffer[8:12])),
		TS:           int64(binary.LittleEndian.Uint64(buffer[12:20])),
		Level:        levelNames[buffer[20]%uint8(len(levelNames))],
		Continuation: buffer[21]&flagContinuation != 0,
	}
}

func (j *Job) fail(err error) {
	j.mu.Lock()
	j.err = err.Error()
	j.done = true
	j.mu.Unlock()
}

func (j *Job) index(ctx context.Context) {
	file, err := os.Open(j.path)
	if err != nil {
		j.fail(err)
		return
	}
	defer file.Close()

	reader := bufio.NewReaderSize(file, readBufferBytes)
	indexWriter := bufio.NewWriterSize(j.writer, 512*1024)
	var offset int64
	var pending []byte
	checkEvery := 0
	// Counters are kept locally and published in batches: taking the mutex on
	// every line of a multi-gigabyte file is pure overhead.
	var levels [8]int64
	firstTS, lastTS := int64(-1), int64(-1)
	// Entries become visible to queries only once flushed, so `records` never
	// promises a page the index file cannot serve yet.
	pendingEntries := int64(0)
	lastFlush := time.Now()
	publish := func(force bool) {
		if pendingEntries == 0 || (!force && pendingEntries < 4096 && time.Since(lastFlush) < 150*time.Millisecond) {
			return
		}
		if err := indexWriter.Flush(); err != nil {
			j.fail(err)
			return
		}
		lastFlush = time.Now()
		j.mu.Lock()
		if j.records == 0 {
			j.firstRecord = time.Since(j.startedAt)
		}
		j.records += pendingEntries
		j.mu.Unlock()
		pendingEntries = 0
	}

	for {
		if checkEvery++; checkEvery >= 512 {
			checkEvery = 0
			if ctx.Err() != nil {
				publish(true)
				j.mu.Lock()
				j.cancelled = true
				j.done = true
				j.mu.Unlock()
				return
			}
		}
		chunk, err := reader.ReadSlice('\n')
		if len(chunk) == 0 && err != nil {
			break
		}
		// ReadSlice returns ErrBufferFull on a line longer than the buffer; the
		// remainder is consumed so offsets stay exact on a one-line 200 MB JSON.
		full := chunk
		for err == bufio.ErrBufferFull {
			pending = append(pending[:0], full...)
			var more []byte
			more, err = reader.ReadSlice('\n')
			if len(pending)+len(more) <= maxLineBytes {
				pending = append(pending, more...)
			}
			full = pending
		}
		length := len(full)
		// The line is never turned into a string here: this loop runs once per
		// line of the whole file, and the index only needs level and timestamp.
		text := bytes.TrimRight(full, "\r\n")
		level := detectLevel(text)
		flags := uint8(0)
		if isContinuation(text) {
			flags |= flagContinuation
		}
		ts := int64(-1)
		if flags&flagContinuation == 0 {
			ts = timestampOf(text)
		}

		if writeErr := writeEntry(indexWriter, offset, int32(length), ts, level, flags); writeErr != nil {
			j.fail(writeErr)
			return
		}
		offset += int64(length)
		pendingEntries++
		levels[level%8]++
		if ts >= 0 {
			if firstTS < 0 || ts < firstTS {
				firstTS = ts
			}
			if ts > lastTS {
				lastTS = ts
			}
		}
		if pendingEntries >= 4096 {
			j.mu.Lock()
			j.bytesRead = offset
			j.levelCounts = levels
			j.firstTS, j.lastTS = firstTS, lastTS
			j.mu.Unlock()
			publish(false)
		}

		if err != nil {
			break
		}
	}

	j.mu.Lock()
	j.bytesRead = offset
	j.levelCounts = levels
	j.firstTS, j.lastTS = firstTS, lastTS
	j.mu.Unlock()
	publish(true)

	j.mu.Lock()
	if j.writer != nil {
		if syncErr := j.writer.Sync(); syncErr != nil && j.err == "" {
			j.err = syncErr.Error()
		}
	}
	j.done = true
	j.mu.Unlock()
}

// Open starts indexing path and returns immediately: the caller polls Status.
func Open(path string) (*Job, error) {
	cleaned := filepath.Clean(path)
	info, err := os.Stat(cleaned)
	if err != nil {
		return nil, fmt.Errorf("cannot read %s: %w", path, err)
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%s is a folder", filepath.Base(cleaned))
	}

	dir, err := os.MkdirTemp("", "adomnia-logindex-")
	if err != nil {
		return nil, err
	}
	indexPath := filepath.Join(dir, "entries.idx")
	writer, err := os.Create(indexPath)
	if err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	reader, err := os.Open(cleaned)
	if err != nil {
		writer.Close()
		os.RemoveAll(dir)
		return nil, err
	}

	jobsMu.Lock()
	sequence++
	job := &Job{
		id:        fmt.Sprintf("idx-%d-%d", time.Now().UnixMilli(), sequence),
		path:      cleaned,
		size:      info.Size(),
		indexDir:  dir,
		indexPath: indexPath,
		writer:    writer,
		reader:    reader,
		firstTS:   -1,
		lastTS:    -1,
		startedAt: time.Now(),
	}
	jobs[job.id] = job
	jobsMu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	job.cancel = cancel
	go func() {
		job.index(ctx)
		job.mu.Lock()
		writer := job.writer
		job.writer = nil
		job.mu.Unlock()
		if writer != nil {
			writer.Close()
		}
	}()
	return job, nil
}

func (j *Job) Status() Status {
	j.mu.Lock()
	defer j.mu.Unlock()
	counts := map[string]int64{}
	for code, count := range j.levelCounts {
		if count > 0 && code < len(levelNames) {
			counts[levelNames[code]] = count
		}
	}
	return Status{
		ID: j.id, Path: j.path, Name: filepath.Base(j.path), Size: j.size,
		BytesRead: j.bytesRead, Records: j.records, Done: j.done, Cancelled: j.cancelled,
		Error: j.err, FirstTS: j.firstTS, LastTS: j.lastTS, LevelCounts: counts,
		FirstRecordMs: j.firstRecord.Milliseconds(),
		IndexBytes:    j.records * entrySize,
	}
}

func (j *Job) ID() string { return j.id }

// ─── Query ───────────────────────────────────────────────────────────────────

type Query struct {
	ID string `json:"id"`
	// Record index to start from; use NextFrom of the previous page.
	From   int64    `json:"from"`
	Limit  int      `json:"limit"`
	Levels []string `json:"levels"`
	FromTS int64    `json:"fromTs"`
	ToTS   int64    `json:"toTs"`
	// Case-insensitive substring, applied to the record text.
	Text string `json:"text"`
	// Milliseconds this query may spend scanning before returning what it has.
	BudgetMs int `json:"budgetMs"`
	// Include the continuation lines of a matching record.
	WithContinuations bool `json:"withContinuations"`
}

type QueryResult struct {
	Entries []Entry `json:"entries"`
	// Record index to pass as From to continue; -1 when the index is exhausted.
	NextFrom int64 `json:"nextFrom"`
	// Records examined by this call, whether or not they matched.
	Scanned int64 `json:"scanned"`
	// True when the whole index was walked.
	Exhausted bool `json:"exhausted"`
	// True when the time budget ended the scan before the page was filled.
	BudgetExceeded bool   `json:"budgetExceeded"`
	Indexing       bool   `json:"indexing"`
	Records        int64  `json:"records"`
	Error          string `json:"error"`
}

func (j *Job) readText(entry Entry) string {
	length := entry.Length
	if length <= 0 {
		return ""
	}
	if length > maxLineBytes {
		length = maxLineBytes
	}
	buffer := make([]byte, length)
	if _, err := j.reader.ReadAt(buffer, entry.Offset); err != nil && err != io.EOF {
		return ""
	}
	return strings.TrimRight(string(buffer), "\r\n")
}

func (q Query) matchesLevel(level string) bool {
	if len(q.Levels) == 0 {
		return true
	}
	for _, wanted := range q.Levels {
		if strings.EqualFold(wanted, level) {
			return true
		}
	}
	return false
}

// Query walks the index from q.From, returning at most q.Limit matching
// records. It stops early when the budget runs out and says so, so the caller
// can decide whether to continue instead of freezing on a 1 GB scan.
func (j *Job) Query(q Query) QueryResult {
	limit := q.Limit
	if limit <= 0 || limit > 5000 {
		limit = 200
	}
	budget := time.Duration(q.BudgetMs) * time.Millisecond
	if budget <= 0 {
		budget = defaultBudgetMs * time.Millisecond
	}
	deadline := time.Now().Add(budget)
	needle := strings.ToLower(q.Text)

	status := j.Status()
	result := QueryResult{NextFrom: -1, Indexing: !status.Done, Records: status.Records, Error: status.Error}

	indexFile, err := os.Open(j.indexPath)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer indexFile.Close()

	cursor := q.From
	if cursor < 0 {
		cursor = 0
	}
	if _, err := indexFile.Seek(cursor*entrySize, io.SeekStart); err != nil {
		result.Error = err.Error()
		return result
	}
	reader := bufio.NewReaderSize(indexFile, 256*1024)
	buffer := make([]byte, entrySize)
	checkEvery := 0
	// Index of the last line folded into the current match, so a stack trace
	// keeps attaching to the record it belongs to.
	lastAppended := int64(-2)

	for int64(len(result.Entries)) < int64(limit) {
		if cursor >= status.Records {
			result.Exhausted = status.Done
			result.NextFrom = cursor
			return result
		}
		if _, err := io.ReadFull(reader, buffer); err != nil {
			result.Exhausted = status.Done
			result.NextFrom = cursor
			return result
		}
		entry := decodeEntry(buffer, cursor)
		cursor++
		result.Scanned++

		if checkEvery++; checkEvery >= 256 {
			checkEvery = 0
			if time.Now().After(deadline) {
				result.BudgetExceeded = true
				result.NextFrom = cursor
				return result
			}
		}

		if entry.Continuation && !q.WithContinuations {
			// A stack frame is part of the record above; it is appended to the
			// last match rather than becoming a result of its own.
			if len(result.Entries) > 0 && lastAppended == entry.Index-1 {
				last := &result.Entries[len(result.Entries)-1]
				last.Text += "\n" + j.readText(entry)
				last.Length += entry.Length
				lastAppended = entry.Index
			}
			continue
		}
		if !q.matchesLevel(entry.Level) {
			continue
		}
		if entry.TS >= 0 {
			if q.FromTS > 0 && entry.TS < q.FromTS {
				continue
			}
			if q.ToTS > 0 && entry.TS > q.ToTS {
				continue
			}
		}
		text := j.readText(entry)
		if needle != "" && !strings.Contains(strings.ToLower(text), needle) {
			continue
		}
		entry.Text = text
		result.Entries = append(result.Entries, entry)
		lastAppended = entry.Index
	}

	result.NextFrom = cursor
	result.Exhausted = status.Done && cursor >= status.Records
	return result
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

func lookup(id string) *Job {
	jobsMu.Lock()
	defer jobsMu.Unlock()
	return jobs[id]
}

// Cancel stops the indexing pass; what was indexed so far stays queryable.
func Cancel(id string) {
	if job := lookup(id); job != nil && job.cancel != nil {
		job.cancel()
	}
}

// Close cancels the job and deletes its index file.
func Close(id string) {
	jobsMu.Lock()
	job := jobs[id]
	delete(jobs, id)
	jobsMu.Unlock()
	if job == nil {
		return
	}
	if job.cancel != nil {
		job.cancel()
	}
	job.mu.Lock()
	writer, reader := job.writer, job.reader
	job.writer, job.reader = nil, nil
	job.mu.Unlock()
	if writer != nil {
		writer.Close()
	}
	if reader != nil {
		reader.Close()
	}
	os.RemoveAll(job.indexDir)
}

// CloseAll releases every index, on shutdown.
func CloseAll() {
	jobsMu.Lock()
	ids := make([]string, 0, len(jobs))
	for id := range jobs {
		ids = append(ids, id)
	}
	jobsMu.Unlock()
	for _, id := range ids {
		Close(id)
	}
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/logindex/open", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		job, err := Open(request.Path)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, job.Status())
	})

	mux.HandleFunc("/logindex/status", func(w http.ResponseWriter, r *http.Request) {
		job := lookup(r.URL.Query().Get("id"))
		if job == nil {
			writeJSON(w, http.StatusOK, map[string]string{"error": "this index is no longer open"})
			return
		}
		writeJSON(w, http.StatusOK, job.Status())
	})

	mux.HandleFunc("/logindex/query", func(w http.ResponseWriter, r *http.Request) {
		var query Query
		if err := json.NewDecoder(r.Body).Decode(&query); err != nil {
			writeJSON(w, http.StatusBadRequest, QueryResult{NextFrom: -1, Error: "invalid request"})
			return
		}
		job := lookup(query.ID)
		if job == nil {
			writeJSON(w, http.StatusOK, QueryResult{NextFrom: -1, Error: "this index is no longer open"})
			return
		}
		writeJSON(w, http.StatusOK, job.Query(query))
	})

	mux.HandleFunc("/logindex/cancel", func(w http.ResponseWriter, r *http.Request) {
		Cancel(r.URL.Query().Get("id"))
		writeJSON(w, http.StatusOK, map[string]string{"error": ""})
	})

	mux.HandleFunc("/logindex/close", func(w http.ResponseWriter, r *http.Request) {
		Close(r.URL.Query().Get("id"))
		writeJSON(w, http.StatusOK, map[string]string{"error": ""})
	})
}
