package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// isDev abilita il sistema di debug logging.
// Impostare a false prima del rilascio in produzione.
const isDev = true

var (
	devLogFile    *os.File
	devLogMu      sync.Mutex
	devLogCounter int64
)

func init() {
	if !isDev {
		return
	}
	if err := os.MkdirAll(devLogDir(), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "[devlog] impossibile creare cartella logs: %v\n", err)
		return
	}
	f, err := os.OpenFile(currentDevLogPath(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[devlog] impossibile aprire file di log: %v\n", err)
		return
	}
	devLogFile = f
}

type devLogEntry struct {
	I      int64          `json:"i"`
	Ts     string         `json:"ts"`
	Source string         `json:"source,omitempty"`
	Func   string         `json:"func"`
	Level  string         `json:"level"`
	Msg    string         `json:"msg"`
	Data   map[string]any `json:"data,omitempty"`
}

func writeDevLog(level, fn, msg string, data map[string]any) {
	writeDevLogSource("backend", level, fn, msg, data)
}

func writeDevLogSource(source, level, fn, msg string, data map[string]any) {
	if !isDev || devLogFile == nil {
		return
	}
	idx := atomic.AddInt64(&devLogCounter, 1)
	entry := devLogEntry{
		I:      idx,
		Ts:     time.Now().UTC().Format(time.RFC3339Nano),
		Source: source,
		Func:   fn,
		Level:  level,
		Msg:    msg,
		Data:   data,
	}
	b, err := json.Marshal(entry)
	if err != nil {
		return
	}
	devLogMu.Lock()
	defer devLogMu.Unlock()
	_, _ = devLogFile.Write(b)
	_, _ = devLogFile.Write([]byte("\n"))
}

// dlog scrive una voce DEBUG nel file JSONL.
func dlog(fn, msg string, data map[string]any) {
	writeDevLog("DEBUG", fn, msg, data)
}

// dlogInfo scrive una voce INFO nel file JSONL.
func dlogInfo(fn, msg string, data map[string]any) {
	writeDevLog("INFO", fn, msg, data)
}

// dlogErr scrive una voce ERROR nel file JSONL.
func dlogErr(fn, msg string, err error, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	if err != nil {
		data["error"] = err.Error()
	}
	writeDevLog("ERROR", fn, msg, data)
}

func currentDevLogPath() string {
	return filepath.Join(devLogDir(), fmt.Sprintf("debug-%s.jsonl", time.Now().Format("2006-01-02")))
}

func devLogDir() string {
	return filepath.Join(dataDir(), "logs")
}
