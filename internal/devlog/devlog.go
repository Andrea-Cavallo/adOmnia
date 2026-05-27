// internal/devlog/devlog.go
package devlog

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

const IsDev = true

var (
	baseDir string
	logFile *os.File
	mu      sync.Mutex
	counter int64
)

// Init deve essere chiamato una sola volta all'avvio, prima di qualunque log.
// baseDataDir è il valore restituito da dataDir() in package main.
func Init(baseDataDir string) {
	baseDir = baseDataDir
	if !IsDev {
		return
	}
	if err := os.MkdirAll(logDir(), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "[devlog] impossibile creare cartella logs: %v\n", err)
		return
	}
	f, err := os.OpenFile(currentLogPath(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[devlog] impossibile aprire file di log: %v\n", err)
		return
	}
	logFile = f
}

// Log scrive una voce DEBUG.
func Log(fn, msg string, data map[string]any) {
	write("backend", "DEBUG", fn, msg, data)
}

// Info scrive una voce INFO.
func Info(fn, msg string, data map[string]any) {
	write("backend", "INFO", fn, msg, data)
}

// Err scrive una voce ERROR, aggiungendo l'errore ai data.
func Err(fn, msg string, err error, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	if err != nil {
		data["error"] = err.Error()
	}
	write("backend", "ERROR", fn, msg, data)
}

type Entry struct {
	I      int64          `json:"i"`
	Ts     string         `json:"ts"`
	Source string         `json:"source,omitempty"`
	Func   string         `json:"func"`
	Level  string         `json:"level"`
	Msg    string         `json:"msg"`
	Data   map[string]any `json:"data,omitempty"`
}

func write(source, level, fn, msg string, data map[string]any) {
	if !IsDev || logFile == nil {
		return
	}
	idx := atomic.AddInt64(&counter, 1)
	e := Entry{
		I:      idx,
		Ts:     time.Now().UTC().Format(time.RFC3339Nano),
		Source: source,
		Func:   fn,
		Level:  level,
		Msg:    msg,
		Data:   data,
	}
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	_, _ = logFile.Write(b)
	_, _ = logFile.Write([]byte("\n"))
}

// WriteSource records a log entry from a non-backend source, such as frontend console forwarding.
func WriteSource(source, level, fn, msg string, data map[string]any) {
	write(source, level, fn, msg, data)
}

// Clear truncates the current active development log.
func Clear() {
	mu.Lock()
	defer mu.Unlock()
	if logFile != nil {
		_ = logFile.Truncate(0)
		_, _ = logFile.Seek(0, 0)
	}
}

// CurrentPath returns the JSONL file currently receiving log entries.
func CurrentPath() string {
	return currentLogPath()
}

// Dir returns the directory containing development log files.
func Dir() string {
	return logDir()
}

func currentLogPath() string {
	return filepath.Join(logDir(), fmt.Sprintf("debug-%s.jsonl", time.Now().Format("2006-01-02")))
}

func logDir() string {
	return filepath.Join(baseDir, "logs")
}

// RegisterHandlers registra l'endpoint SSE /devlogs/stream sul mux fornito.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/devlogs/stream", streamHandler)
}

func streamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET required", http.StatusMethodNotAllowed)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	path := currentLogPath()
	f, err := os.Open(path)
	if err != nil {
		fmt.Fprintf(w, "data: {\"error\":\"log file not found\"}\n\n")
		flusher.Flush()
		return
	}
	defer f.Close()

	_, _ = f.Seek(0, io.SeekEnd)
	scanner := bufio.NewScanner(f)

	tick := time.NewTicker(500 * time.Millisecond)
	defer tick.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
			for scanner.Scan() {
				line := scanner.Text()
				if line == "" {
					continue
				}
				fmt.Fprintf(w, "data: %s\n\n", line)
				flusher.Flush()
			}
		}
	}
}
