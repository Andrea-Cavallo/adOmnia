# Go Internal Packages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estrarre i ~65 file Go da `package main` in package `internal/` con dominio singolo, zero global variables esposte, e un `main.go` che fa solo wiring.

**Architecture:** Ogni dominio diventa `internal/<nome>/` con package proprio. I package HTTP-handler espongono `RegisterHandlers(mux *http.ServeMux)`. I package Wails-bound espongono una struct con costruttore. `server.go` diventa un loop di chiamate a `RegisterHandlers`. `main.go` diventa wireman puro ≤100 righe.

**Tech Stack:** Go 1.25, Wails v2, `adomnia` module name, bbolt, sarama, cobra

**Regola di verifica per ogni fase:** dopo ogni task eseguire:
```bash
go build ./...
go test ./...
```
Entrambi devono passare prima del commit. Non procedere alla fase successiva se uno dei due fallisce.

---

## Task 0: Crea `internal/devlog/` — il logger condiviso

`dlog`/`dlogErr`/`dlogInfo` sono chiamate da ogni file del progetto. Questo package **deve** essere il primo estratto perché tutti gli altri dipendono da lui.

**Files:**
- Create: `internal/devlog/devlog.go`
- Modify: `devlog.go` (svuotare e ridirigere a internal/devlog)
- Modify: `server.go` (handler `/devlogs/stream`)
- Modify: `helpers.go` (aggiungere `DevDataDir`)

- [ ] **Step 1: Crea la directory**

```bash
mkdir -p internal/devlog
```

- [ ] **Step 2: Crea `internal/devlog/devlog.go`**

```go
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
	baseDir    string
	logFile    *os.File
	mu         sync.Mutex
	counter    int64
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

type entry struct {
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
	e := entry{
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
```

- [ ] **Step 3: Sostituisci `devlog.go` con shim che delega a `internal/devlog`**

Questo mantiene la compatibilità con tutti i file ancora in `package main` durante la transizione.

Sostituisci l'intero contenuto di `devlog.go` con:

```go
// devlog.go — shim di transizione: delega a internal/devlog.
// Rimuovere quando tutti i package saranno migrati a internal/.
package main

import "adomnia/internal/devlog"

func dlog(fn, msg string, data map[string]any)              { devlog.Log(fn, msg, data) }
func dlogInfo(fn, msg string, data map[string]any)          { devlog.Info(fn, msg, data) }
func dlogErr(fn, msg string, err error, data map[string]any) { devlog.Err(fn, msg, err, data) }
```

- [ ] **Step 4: Chiama `devlog.Init` in `app.go` all'avvio**

In `app.go`, aggiungi in cima all'import:
```go
import "adomnia/internal/devlog"
```

All'inizio di `OnStartup`, come prima istruzione:
```go
func (a *App) OnStartup(ctx context.Context) {
    devlog.Init(dataDir()) // ← aggiungere questa riga
    a.ctx = ctx
    // ... resto invariato
```

- [ ] **Step 5: Aggiorna `server.go` per usare `devlog.RegisterHandlers`**

Aggiungi import in `server.go`:
```go
import "adomnia/internal/devlog"
```

Sostituisci la riga:
```go
mux.HandleFunc("/devlogs/stream", devLogStreamHandler)
```
con:
```go
devlog.RegisterHandlers(mux)
```

- [ ] **Step 6: Verifica build**

```bash
go build ./...
```
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add internal/devlog/ devlog.go app.go server.go
git commit -m "refactor: extract internal/devlog package"
```

---

## Task 1: Crea `internal/httputil/` — helper HTTP condivisi

`jsonError` è definita in `kafka.go` ma è usata da quasi ogni handler. Prima di muovere i package, la esportiamo in un posto neutro.

**Files:**
- Create: `internal/httputil/httputil.go`
- Modify: `kafka.go` (rimuovere la definizione locale, importare httputil)

- [ ] **Step 1: Crea `internal/httputil/httputil.go`**

```go
// internal/httputil/httputil.go
package httputil

import (
	"encoding/json"
	"net/http"
)

// JSONError scrive una risposta JSON con campo "ok":false e "error".
func JSONError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"error": msg,
	})
}

// JSONOk scrive una risposta JSON con status 200.
func JSONOk(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 2: Rimuovi `jsonError` da `kafka.go` e sostituisci tutte le chiamate**

In `kafka.go`, elimina la funzione `jsonError` (righe 631–638).

Aggiungi in cima all'import block di `kafka.go`:
```go
"adomnia/internal/httputil"
```

Poi sostituisci tutte le occorrenze di `jsonError(` con `httputil.JSONError(` in kafka.go:
```bash
# Verifica quante ce ne sono
grep -c "jsonError(" kafka.go
```

- [ ] **Step 3: Verifica che tutti gli altri file che usano `jsonError` ora trovino la versione in kafka.go**

```bash
grep -rn "jsonError(" *.go
```
I file che la chiamano ma non la definiscono funzionano perché sono nello stesso `package main`. Non cambiare ancora gli altri file — verranno aggiornati quando i loro package vengono estratti.

- [ ] **Step 4: Verifica build**

```bash
go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add internal/httputil/ kafka.go
git commit -m "refactor: extract internal/httputil package (JSONError, JSONOk)"
```

---

## Task 2: Estrai `internal/kafka/`

**Files:**
- Create: `internal/kafka/` (directory)
- Move (con modifica): `kafka.go` → `internal/kafka/kafka.go`
- Move (con modifica): `scram.go` → `internal/kafka/scram.go`
- Modify: `server.go` (sostituire 5 HandleFunc con `kafka.RegisterHandlers(mux)`)
- Delete: `kafka.go`, `scram.go` dalla root

- [ ] **Step 1: Crea la directory**

```bash
mkdir -p internal/kafka
```

- [ ] **Step 2: Copia `kafka.go` → `internal/kafka/kafka.go` e modifica**

Cambia la prima riga da:
```go
package main
```
a:
```go
package kafka
```

Aggiungi agli import:
```go
"adomnia/internal/devlog"
"adomnia/internal/httputil"
```

Rimuovi dagli import: *(nessuno da rimuovere, kafka.go non importava nulla da package main)*

Sostituisci tutte le chiamate interne:
- `dlog(` → `devlog.Log(`
- `dlogErr(` → `devlog.Err(`
- `dlogInfo(` → `devlog.Info(`
- `jsonError(` → `httputil.JSONError(`

Aggiungi alla fine del file la funzione di registrazione:
```go
// RegisterHandlers registra tutti gli handler Kafka sul mux fornito.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/kafka/produce", kafkaProduceHandler)
	mux.HandleFunc("/kafka/bulk-produce", kafkaBulkProduceHandler)
	mux.HandleFunc("/kafka/loadtest", kafkaLoadTestHandler)
	mux.HandleFunc("/kafka/consume", kafkaConsumeHandler)
	mux.HandleFunc("/kafka/topics", kafkaTopicsHandler)
}
```

- [ ] **Step 3: Copia `scram.go` → `internal/kafka/scram.go` e modifica**

Cambia la prima riga da:
```go
package main
```
a:
```go
package kafka
```

Nessun'altra modifica necessaria: scram.go non usa dlog né jsonError.

- [ ] **Step 4: Rimuovi i file originali dalla root**

```bash
rm kafka.go scram.go
```

- [ ] **Step 5: Aggiorna `server.go`**

Aggiungi all'import block:
```go
"adomnia/internal/kafka"
```

Sostituisci il blocco Kafka in `startHTTPServer`:
```go
// Prima (5 righe):
mux.HandleFunc("/kafka/produce", kafkaProduceHandler)
mux.HandleFunc("/kafka/bulk-produce", kafkaBulkProduceHandler)
mux.HandleFunc("/kafka/loadtest", kafkaLoadTestHandler)
mux.HandleFunc("/kafka/consume", kafkaConsumeHandler)
mux.HandleFunc("/kafka/topics", kafkaTopicsHandler)

// Dopo (1 riga):
kafka.RegisterHandlers(mux)
```

- [ ] **Step 6: Verifica build e test**

```bash
go build ./...
go test ./...
```
Expected: entrambi passano.

- [ ] **Step 7: Commit**

```bash
git add internal/kafka/ server.go
git commit -m "refactor: extract internal/kafka package"
```

---

## Task 3: Estrai `internal/broker/`

**Files:**
- Create: `internal/broker/`
- Move: `broker.go` → `internal/broker/broker.go`
- Modify: `server.go`

**Dipendenze interne da risolvere:** `broker.go` usa `storeDB` (bbolt globale da `storage.go`). Finché `storage.go` non è nel suo package, passa `storeDB` come parametro al costruttore.

- [ ] **Step 1: Crea directory**

```bash
mkdir -p internal/broker
```

- [ ] **Step 2: Copia e modifica `internal/broker/broker.go`**

```go
// Prima riga:
package broker
// (era: package main)
```

Aggiungi import:
```go
"adomnia/internal/devlog"
"adomnia/internal/httputil"
```

Sostituisci:
- `dlog(` → `devlog.Log(`
- `dlogErr(` → `devlog.Err(`
- `dlogInfo(` → `devlog.Info(`
- `jsonError(` → `httputil.JSONError(`

`broker.go` usa `storeDB` (bbolt). Aggiungi una variabile di package e una funzione di inizializzazione:

```go
import bolt "go.etcd.io/bbolt"

var db *bolt.DB

// SetDB inietta il database bbolt. Chiamare prima di RegisterHandlers.
func SetDB(database *bolt.DB) {
	db = database
}
```

Poi nel codice sostituisci `storeDB` con `db`.

Aggiungi in fondo al file:
```go
// RegisterHandlers registra tutti gli handler Broker sul mux fornito.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/broker/rabbitmq/publish", rabbitPublishHandler)
	mux.HandleFunc("/broker/rabbitmq/consume", rabbitConsumeHandler)
	mux.HandleFunc("/broker/rabbitmq/exchanges", rabbitExchangesHandler)
	mux.HandleFunc("/broker/mqtt/publish", mqttPublishHandler)
	mux.HandleFunc("/broker/mqtt/subscribe", mqttSubscribeHandler)
	mux.HandleFunc("/broker/redis/publish", redisPublishHandler)
	mux.HandleFunc("/broker/redis/subscribe", redisSubscribeHandler)
	mux.HandleFunc("/broker/nats/publish", natsPublishHandler)
	mux.HandleFunc("/broker/nats/subscribe", natsSubscribeHandler)
	mux.HandleFunc("/broker/presets/save", brokerPresetsSaveHandler)
	mux.HandleFunc("/broker/presets/list", brokerPresetsListHandler)
	mux.HandleFunc("/broker/presets/delete", brokerPresetsDeleteHandler)
}
```

- [ ] **Step 3: Rimuovi `broker.go` dalla root**

```bash
rm broker.go
```

- [ ] **Step 4: Aggiorna `server.go`**

```go
import "adomnia/internal/broker"

// In startHTTPServer, dopo aver aperto il DB (o passandolo):
broker.SetDB(storeDB)

// Sostituisci il blocco Broker Studio:
broker.RegisterHandlers(mux)
```

- [ ] **Step 5: Verifica build e commit**

```bash
go build ./...
git add internal/broker/ server.go
git commit -m "refactor: extract internal/broker package"
```

---

## Task 4: Estrai `internal/grpc/`

**Files:**
- Create: `internal/grpc/`
- Move: `grpc.go` → `internal/grpc/grpc.go`
- Modify: `server.go`

- [ ] **Step 1: Crea directory e copia file**

```bash
mkdir -p internal/grpc
cp grpc.go internal/grpc/grpc.go
rm grpc.go
```

- [ ] **Step 2: Modifica `internal/grpc/grpc.go`**

```go
package grpc  // era: package main
```

Aggiungi import:
```go
"adomnia/internal/devlog"
"adomnia/internal/httputil"
```

Sostituisci `dlog(` → `devlog.Log(`, `dlogErr(` → `devlog.Err(`, `jsonError(` → `httputil.JSONError(`.

Aggiungi in fondo:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/grpc/reflect", grpcReflectHandler)
	mux.HandleFunc("/grpc/describe", grpcDescribeHandler)
	mux.HandleFunc("/grpc/invoke", grpcInvokeHandler)
	mux.HandleFunc("/grpc/parse-proto", grpcParseProtoHandler)
}
```

- [ ] **Step 3: Aggiorna `server.go`**

```go
import igrpc "adomnia/internal/grpc"   // alias per evitare conflitto con google.golang.org/grpc

// Sostituisci il blocco gRPC:
igrpc.RegisterHandlers(mux)
```

- [ ] **Step 4: Verifica build e commit**

```bash
go build ./...
git add internal/grpc/ server.go
git commit -m "refactor: extract internal/grpc package"
```

---

## Task 5: Estrai `internal/loadtest/`

**Files:**
- Create: `internal/loadtest/`
- Move: `loadtest.go` → `internal/loadtest/loadtest.go`
- Modify: `server.go`

- [ ] **Step 1: Crea directory e copia file**

```bash
mkdir -p internal/loadtest
cp loadtest.go internal/loadtest/loadtest.go
rm loadtest.go
```

- [ ] **Step 2: Modifica `internal/loadtest/loadtest.go`**

```go
package loadtest  // era: package main
```

Aggiungi import:
```go
"adomnia/internal/devlog"
"adomnia/internal/httputil"
```

Sostituisci `dlog(` → `devlog.Log(`, `dlogErr(` → `devlog.Err(`, `jsonError(` → `httputil.JSONError(`.

`loadtest.go` usa `storeDB` per salvare risultati. Applica lo stesso pattern di broker:
```go
import bolt "go.etcd.io/bbolt"
var db *bolt.DB
func SetDB(database *bolt.DB) { db = database }
```
Sostituisci `storeDB` con `db` nel codice.

Aggiungi in fondo:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/loadtest", loadTestHandler)
	mux.HandleFunc("/loadtest/report", loadTestReportHandler)
	mux.HandleFunc("/loadtest/scenario/save", loadTestScenarioSaveHandler)
	mux.HandleFunc("/loadtest/scenario/list", loadTestScenarioListHandler)
	mux.HandleFunc("/loadtest/scenario/load", loadTestScenarioLoadHandler)
	mux.HandleFunc("/loadtest/compare", loadTestCompareHandler)
	mux.HandleFunc("/loadtest/result/save", loadTestResultSaveHandler)
	mux.HandleFunc("/loadtest/result/list", loadTestResultListHandler)
	mux.HandleFunc("/loadtest/result/load", loadTestResultLoadHandler)
	mux.HandleFunc("/loadtest/result/delete", loadTestResultDeleteHandler)
	mux.HandleFunc("/loadtest/grpc", loadTestGrpcHandler)
}
```

- [ ] **Step 3: Aggiorna `server.go`**

```go
import "adomnia/internal/loadtest"

loadtest.SetDB(storeDB)
loadtest.RegisterHandlers(mux)
```

- [ ] **Step 4: Verifica build e commit**

```bash
go build ./...
git add internal/loadtest/ server.go
git commit -m "refactor: extract internal/loadtest package"
```

---

## Task 6: Estrai `internal/mock/`

**Files:**
- Create: `internal/mock/`
- Move: `mock.go` → `internal/mock/mock.go`
- Move: `websocket_mock.go` → `internal/mock/websocket.go`
- Modify: `server.go`

- [ ] **Step 1: Crea directory e copia file**

```bash
mkdir -p internal/mock
cp mock.go internal/mock/mock.go
cp websocket_mock.go internal/mock/websocket.go
rm mock.go websocket_mock.go
```

- [ ] **Step 2: Modifica entrambi i file**

In `internal/mock/mock.go` e `internal/mock/websocket.go`:
```go
package mock  // era: package main
```

In `internal/mock/mock.go` aggiungi import:
```go
"adomnia/internal/devlog"
"adomnia/internal/httputil"
```

Sostituisci `dlog(` → `devlog.Log(`, `dlogErr(` → `devlog.Err(`, `jsonError(` → `httputil.JSONError(`.

Aggiungi in `internal/mock/mock.go`:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/mock/start", mockStartHandler)
	mux.HandleFunc("/mock/stop", mockStopHandler)
	mux.HandleFunc("/mock/status", mockStatusHandler)
	mux.HandleFunc("/mock/hits", mockHitsHandler)
	mux.HandleFunc("/mock/record", recordReplayHandler)
	mux.HandleFunc("/ws/mock/start", wsMockStartHandler)
	mux.HandleFunc("/ws/mock/stop", wsMockStopHandler)
	mux.HandleFunc("/ws/mock/status", wsMockStatusHandler)
	mux.HandleFunc("/ws/mock/rules", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			wsMockRulesSaveHandler(w, r)
		} else {
			wsMockRulesGetHandler(w, r)
		}
	})
	mux.HandleFunc("/ws/mock/hits/clear", wsMockHitsClearHandler)
}
```

- [ ] **Step 3: Aggiorna `server.go`**

```go
import "adomnia/internal/mock"

mock.RegisterHandlers(mux)
```

- [ ] **Step 4: Verifica build e commit**

```bash
go build ./...
git add internal/mock/ server.go
git commit -m "refactor: extract internal/mock package"
```

---

## Task 7: Estrai `internal/proxy/`

Il più complesso: 7 file con dipendenze reciproche. Li muoviamo tutti insieme in un unico commit.

**Files:**
- Create: `internal/proxy/`
- Move: `proxy.go`, `proxy_rules.go`, `proxy_traffic.go`, `proxy_ca.go`, `proxy_export.go`, `proxy_map.go`, `record_replay.go`
- Modify: `server.go`

- [ ] **Step 1: Crea directory e copia tutti i file**

```bash
mkdir -p internal/proxy
cp proxy.go internal/proxy/proxy.go
cp proxy_rules.go internal/proxy/rules.go
cp proxy_traffic.go internal/proxy/traffic.go
cp proxy_ca.go internal/proxy/ca.go
cp proxy_export.go internal/proxy/export.go
cp proxy_map.go internal/proxy/map.go
cp record_replay.go internal/proxy/record_replay.go
rm proxy.go proxy_rules.go proxy_traffic.go proxy_ca.go proxy_export.go proxy_map.go record_replay.go
```

- [ ] **Step 2: Cambia `package main` → `package proxy` in tutti e 7 i file**

```bash
# Verifica che tutti i file abbiano la dichiarazione giusta dopo la modifica
head -1 internal/proxy/*.go
```
Ogni file deve mostrare `package proxy`.

- [ ] **Step 3: Aggiungi import devlog/httputil e sostituisci chiamate in `internal/proxy/proxy.go`**

```go
import (
    "adomnia/internal/devlog"
    "adomnia/internal/httputil"
)
```

Sostituisci `dlog(` → `devlog.Log(`, `dlogErr(` → `devlog.Err(`, `dlogInfo(` → `devlog.Info(`, `jsonError(` → `httputil.JSONError(`.

Ripeti per ogni file del package che usa queste funzioni.

- [ ] **Step 4: Aggiungi `RegisterHandlers` in `internal/proxy/proxy.go`**

```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/proxy/start", proxyStartHandler)
	mux.HandleFunc("/proxy/stop", proxyStopHandler)
	mux.HandleFunc("/proxy/traffic", proxyTrafficHandler)
	mux.HandleFunc("/proxy/breakpoints", proxyBreakpointsHandler)
	mux.HandleFunc("/proxy/breakpoint/pending", proxyBreakpointPendingHandler)
	mux.HandleFunc("/proxy/breakpoint/resume", proxyBreakpointResumeHandler)
	mux.HandleFunc("/proxy/export", proxyExportHandler)
	mux.HandleFunc("/proxy/rules", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			proxyRulesPutHandler(w, r)
		} else {
			proxyRulesGetHandler(w, r)
		}
	})
	mux.HandleFunc("/proxy/rules/test", proxyRulesTestHandler)
	mux.HandleFunc("/proxy/rules/log", proxyRulesLogHandler)
	mux.HandleFunc("/proxy/map/local", proxyMapLocalHandler)
	mux.HandleFunc("/proxy/map/remote", proxyMapRemoteHandler)
	mux.HandleFunc("/proxy/throttle", proxyThrottleHandler)
	mux.HandleFunc("/proxy/repeat", proxyRepeatHandler)
	mux.HandleFunc("/proxy/ca/status", caStatusHandler)
	mux.HandleFunc("/proxy/ca/generate", caGenerateHandler)
	mux.HandleFunc("/proxy/ca/export", caExportHandler)
	mux.HandleFunc("/proxy/ca/delete", caDeleteHandler)
}
```

- [ ] **Step 5: Aggiorna `server.go`**

```go
import "adomnia/internal/proxy"

proxy.RegisterHandlers(mux)
```

- [ ] **Step 6: Verifica che `initProxyRules()` sia ancora raggiungibile da `app.go`**

`app.go` chiama `initProxyRules()`. Questa funzione si trova ora in `internal/proxy/`. Aggiorna `app.go`:

```go
import "adomnia/internal/proxy"

// In OnStartup, sostituisci:
initProxyRules()
// con:
proxy.InitRules()
```

Rinomina la funzione in `internal/proxy/rules.go`:
```go
// era: func initProxyRules()
func InitRules() { ... }
```

- [ ] **Step 7: Verifica build e commit**

```bash
go build ./...
git add internal/proxy/ server.go app.go
git commit -m "refactor: extract internal/proxy package (7 files)"
```

---

## Task 8: Estrai `internal/ws/`

**Files:**
- Create: `internal/ws/`
- Move: `websocket_client.go` → `internal/ws/client.go`
- Modify: `server.go`

- [ ] **Step 1: Crea directory e copia**

```bash
mkdir -p internal/ws
cp websocket_client.go internal/ws/client.go
rm websocket_client.go
```

- [ ] **Step 2: Modifica `internal/ws/client.go`**

```go
package ws  // era: package main
```

Aggiungi `"adomnia/internal/devlog"` e `"adomnia/internal/httputil"` agli import. Sostituisci le chiamate.

Aggiungi in fondo:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/ws/connect", wsConnectHandler)
	mux.HandleFunc("/ws/disconnect", wsDisconnectHandler)
	mux.HandleFunc("/ws/send", wsSendHandler)
	mux.HandleFunc("/ws/ping", wsPingHandler)
	mux.HandleFunc("/ws/stream", wsStreamHandler)
	mux.HandleFunc("/ws/list", WsListHandler)
	mux.HandleFunc("/ws/close-all", WsCloseAllHandler)
}
```

- [ ] **Step 3: Aggiorna `server.go`**

```go
import "adomnia/internal/ws"
ws.RegisterHandlers(mux)
```

- [ ] **Step 4: Verifica build e commit**

```bash
go build ./...
git add internal/ws/ server.go
git commit -m "refactor: extract internal/ws package"
```

---

## Task 9: Estrai `internal/sse/`

**Files:**
- Create: `internal/sse/`
- Move: `sse_client.go` → `internal/sse/client.go`
- Modify: `server.go`

- [ ] **Step 1**

```bash
mkdir -p internal/sse
cp sse_client.go internal/sse/client.go
rm sse_client.go
```

- [ ] **Step 2: Modifica `internal/sse/client.go`**

```go
package sse
```

Import + sostituzioni dlog/jsonError. Aggiungi:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/sse/connect", sseConnectHandler)
	mux.HandleFunc("/sse/disconnect", sseDisconnectHandler)
	mux.HandleFunc("/sse/stream", sseStreamHandler)
	mux.HandleFunc("/sse/list", SseListHandler)
	mux.HandleFunc("/sse/close-all", SseCloseAllHandler)
}
```

- [ ] **Step 3: Aggiorna `server.go`**

```go
import "adomnia/internal/sse"
sse.RegisterHandlers(mux)
```

- [ ] **Step 4: Verifica build e commit**

```bash
go build ./...
git add internal/sse/ server.go
git commit -m "refactor: extract internal/sse package"
```

---

## Task 10: Estrai `internal/storage/`

**Files:**
- Create: `internal/storage/`
- Move: `storage.go` → `internal/storage/storage.go`
- Move: `storage_bindings.go` → `internal/storage/bindings.go`
- Move: `workspace_go.go` → `internal/storage/workspace.go`
- Modify: `app.go`, `server.go`

- [ ] **Step 1: Crea directory e copia file**

```bash
mkdir -p internal/storage
cp storage.go internal/storage/storage.go
cp storage_bindings.go internal/storage/bindings.go
cp workspace_go.go internal/storage/workspace.go
rm storage.go storage_bindings.go workspace_go.go
```

- [ ] **Step 2: Cambia package e aggiungi import in tutti e 3**

```go
package storage
```

Import devlog/httputil. Sostituisci dlog/jsonError.

- [ ] **Step 3: Esporta `DB()` e `Open()` da `internal/storage/storage.go`**

Le funzioni `openStore()` e la variabile `storeDB` erano globali in main. Ora devono essere accessibili da `app.go` e dagli altri package (broker, loadtest).

In `internal/storage/storage.go`:
```go
var db *bolt.DB

// Open apre (o crea) il database bbolt nell'apposita directory.
func Open(dataDir string) error {
    // contenuto dell'attuale openStore(), con dataDir come parametro
    path := filepath.Join(dataDir, "adomnia.db")
    var err error
    db, err = bolt.Open(path, 0o600, &bolt.Options{Timeout: 2 * time.Second})
    return err
}

// DB restituisce il database aperto. Usare solo dopo Open().
func DB() *bolt.DB { return db }
```

- [ ] **Step 4: Aggiorna `app.go`**

```go
import "adomnia/internal/storage"

// In OnStartup, sostituisci:
if err := openStore(); err != nil { ... }
a.store = storeDB
// con:
if err := storage.Open(dataDir()); err != nil { ... }
a.store = storage.DB()
```

- [ ] **Step 5: Aggiorna broker e loadtest per usare `storage.DB()`**

In `server.go`, sostituisci le chiamate `SetDB(storeDB)` con `storage.DB()`:

```go
import "adomnia/internal/storage"

// Nel corpo di startHTTPServer:
broker.SetDB(storage.DB())
loadtest.SetDB(storage.DB())
```

- [ ] **Step 6: Aggiungi `RegisterHandlers` in `internal/storage/bindings.go`**

```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/storage/status", storageStatusHandler)
	mux.HandleFunc("/storage/get", storageGetHandler)
	mux.HandleFunc("/storage/put", storagePutHandler)
	mux.HandleFunc("/storage/delete", storageDeleteHandler)
	mux.HandleFunc("/storage/list", storageListHandler)
	mux.HandleFunc("/storage/migrate", storageMigrateHandler)
	mux.HandleFunc("/storage/export", storageExportHandler)
	mux.HandleFunc("/storage/import", storageImportHandler)
	mux.HandleFunc("/storage/snapshot", storageSnapshotHandler)
	mux.HandleFunc("/storage/restore", storageRestoreHandler)
	mux.HandleFunc("/storage/search", storageSearchHandler)
	mux.HandleFunc("/workspace/list", workspaceListHandler)
	mux.HandleFunc("/workspace/save", workspaceSaveHandler)
	mux.HandleFunc("/workspace/load", workspaceLoadHandler)
	mux.HandleFunc("/workspace/delete", workspaceDeleteHandler)
}
```

- [ ] **Step 7: Aggiorna `server.go`**

```go
import "adomnia/internal/storage"
storage.RegisterHandlers(mux)
```

- [ ] **Step 8: Verifica build e commit**

```bash
go build ./...
git add internal/storage/ app.go server.go
git commit -m "refactor: extract internal/storage package"
```

---

## Task 11: Estrai `internal/vault/`

**Files:**
- Create: `internal/vault/`
- Move: `vault.go` → `internal/vault/vault.go`
- Modify: `server.go`

- [ ] **Step 1**

```bash
mkdir -p internal/vault
cp vault.go internal/vault/vault.go
rm vault.go
```

- [ ] **Step 2: Modifica `internal/vault/vault.go`**

```go
package vault
```

Import devlog/httputil/storage:
```go
"adomnia/internal/devlog"
"adomnia/internal/httputil"
"adomnia/internal/storage"
```

Sostituisci `storeDB` con `storage.DB()`. Sostituisci dlog/jsonError.

Aggiungi:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/vault/status", vaultStatusHandler)
	mux.HandleFunc("/vault/unlock", vaultUnlockHandler)
	mux.HandleFunc("/vault/lock", vaultLockHandler)
	mux.HandleFunc("/vault/encrypt", vaultEncryptHandler)
	mux.HandleFunc("/vault/decrypt", vaultDecryptHandler)
	mux.HandleFunc("/vault/export", vaultExportHandler)
	mux.HandleFunc("/vault/import", vaultImportHandler)
}
```

- [ ] **Step 3: Aggiorna `server.go`**

```go
import "adomnia/internal/vault"
vault.RegisterHandlers(mux)
```

- [ ] **Step 4: Verifica build e commit**

```bash
go build ./...
git add internal/vault/ server.go
git commit -m "refactor: extract internal/vault package"
```

---

## Task 12: Estrai `internal/net/`

**Files:**
- Create: `internal/net/`
- Move: `nettools.go` → `internal/net/tools.go`
- Move: `hostsmap.go` → `internal/net/hosts.go`
- Move: `certtools_go.go` → `internal/net/cert.go`
- Move: `folderdiff_go.go` → `internal/net/folderdiff.go`
- Modify: `server.go`

- [ ] **Step 1**

```bash
mkdir -p internal/net
cp nettools.go internal/net/tools.go
cp hostsmap.go internal/net/hosts.go
cp certtools_go.go internal/net/cert.go
cp folderdiff_go.go internal/net/folderdiff.go
rm nettools.go hostsmap.go certtools_go.go folderdiff_go.go
```

- [ ] **Step 2: `package net` in tutti e 4 i file**

⚠️ Attenzione: `net` è anche il nome di un package della stdlib. Usa l'alias `inet` nell'import di server.go.

```go
package net  // in tutti e 4 i file
```

- [ ] **Step 3: Import devlog/httputil e sostituzioni in ogni file**

Stesso pattern degli altri task.

Aggiungi `RegisterHandlers` in `internal/net/tools.go`:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/dns/lookup", dnsLookupHandler)
	mux.HandleFunc("/dns/trace", dnsTraceHandler)
	mux.HandleFunc("/dns/compare", dnsCompareHandler)
	mux.HandleFunc("/dns/cache", dnsCacheGetHandler)
	mux.HandleFunc("/dns/cache/clear", dnsCacheClearHandler)
	mux.HandleFunc("/portscan", portScanHandler)
	mux.HandleFunc("/cors", corsTestHandler)
	mux.HandleFunc("/cert/jks-split", certJksSplitHandler)
	mux.HandleFunc("/folderdiff/scan", folderDiffHandler)
	mux.HandleFunc("/folderdiff/file", folderDiffFileHandler)
}
```

- [ ] **Step 4: Aggiorna `server.go`**

```go
import inet "adomnia/internal/net"   // alias per evitare conflitto con stdlib net

inet.RegisterHandlers(mux)
```

- [ ] **Step 5: Verifica build e commit**

```bash
go build ./...
git add internal/net/ server.go
git commit -m "refactor: extract internal/net package"
```

---

## Task 13: Estrai `internal/jsonutil/`, `internal/oauth/`, `internal/database/`

Tre package piccoli, ognuno con lo stesso pattern. Task unico per efficienza.

**Files:**
- `jsontools_go.go` → `internal/jsonutil/jsonutil.go`
- `oauth.go` → `internal/oauth/oauth.go`
- `database_go.go` → `internal/database/database.go`

- [ ] **Step 1: Crea directory e copia**

```bash
mkdir -p internal/jsonutil internal/oauth internal/database
cp jsontools_go.go internal/jsonutil/jsonutil.go
cp oauth.go internal/oauth/oauth.go
cp database_go.go internal/database/database.go
rm jsontools_go.go oauth.go database_go.go
```

- [ ] **Step 2: Modifica i 3 file**

`internal/jsonutil/jsonutil.go`:
```go
package jsonutil
```
Import devlog/httputil + sostituzioni + `RegisterHandlers`:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/json/query", jsonQueryHandler)
	mux.HandleFunc("/json/set", jsonSetHandler)
	mux.HandleFunc("/json/diff", jsonDiffHandler)
	mux.HandleFunc("/json/human", jsonHumanHandler)
	mux.HandleFunc("/json/stream", jsonStreamHandler)
	mux.HandleFunc("/json/mimetype", mimeDetectHandler)
}
```

`internal/oauth/oauth.go`:
```go
package oauth
```
Import devlog/httputil + sostituzioni + `RegisterHandlers`:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/oauth/start", oauthStartHandler)
	mux.HandleFunc("/oauth/callback", oauthCallbackHandler)
	mux.HandleFunc("/oauth/status", oauthStatusHandler)
}
```

`internal/database/database.go`:
```go
package database
```
Import devlog/httputil + sostituzioni + `RegisterHandlers`:
```go
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/database/test", databaseTestHandler)
	mux.HandleFunc("/database/query", databaseQueryHandler)
}
```

- [ ] **Step 3: Aggiorna `server.go`**

```go
import (
    "adomnia/internal/database"
    "adomnia/internal/jsonutil"
    "adomnia/internal/oauth"
)

jsonutil.RegisterHandlers(mux)
oauth.RegisterHandlers(mux)
database.RegisterHandlers(mux)
```

- [ ] **Step 4: Verifica build e commit**

```bash
go build ./...
git add internal/jsonutil/ internal/oauth/ internal/database/ server.go
git commit -m "refactor: extract internal/jsonutil, oauth, database packages"
```

---

## Task 14: Estrai i package Wails-bound (themes, browser, plugins, python, docker, templates)

Questi package non hanno HTTP handlers: sono struct registrate in `main.go` con `Bind`. Il pattern è diverso.

**Files:**
- `themes.go` + `themes_extended.go` → `internal/themes/`
- `browser_debug.go` + `browser_debug_discover.go` + `browser_debug_extended.go` → `internal/browser/`
- `plugins.go` + `plugins_sandbox.go` → `internal/plugins/`
- `python_bindings.go` + `python_runtime.go` + `python_sdk_server.go` + `python_worker*.go` → `internal/python/`
- `dockerlab.go` → `internal/docker/`
- `templates.go` → `internal/templates/`

- [ ] **Step 1: Crea directory e copia file**

```bash
mkdir -p internal/themes internal/browser internal/plugins internal/python internal/docker internal/templates

cp themes.go internal/themes/themes.go
cp themes_extended.go internal/themes/extended.go
cp browser_debug.go internal/browser/browser.go
cp browser_debug_discover.go internal/browser/discover.go
cp browser_debug_extended.go internal/browser/extended.go
cp plugins.go internal/plugins/plugins.go
cp plugins_sandbox.go internal/plugins/sandbox.go
cp python_bindings.go internal/python/bindings.go
cp python_runtime.go internal/python/runtime.go
cp python_sdk_server.go internal/python/sdk_server.go
cp python_worker.go internal/python/worker.go
cp python_worker_windows.go internal/python/worker_windows.go
cp python_worker_other.go internal/python/worker_other.go
cp dockerlab.go internal/docker/lab.go
cp templates.go internal/templates/store.go

rm themes.go themes_extended.go browser_debug.go browser_debug_discover.go browser_debug_extended.go
rm plugins.go plugins_sandbox.go
rm python_bindings.go python_runtime.go python_sdk_server.go python_worker*.go
rm dockerlab.go templates.go
```

- [ ] **Step 2: Cambia package declaration in tutti i file**

| File | Package |
|------|---------|
| `internal/themes/*.go` | `package themes` |
| `internal/browser/*.go` | `package browser` |
| `internal/plugins/*.go` | `package plugins` |
| `internal/python/*.go` | `package python` |
| `internal/docker/lab.go` | `package docker` |
| `internal/templates/store.go` | `package templates` |

- [ ] **Step 3: Aggiungi import devlog in ogni file e sostituisci dlog**

Stesso pattern dei task precedenti per ogni file che usa dlog.

- [ ] **Step 4: Aggiorna `main.go` per usare i nuovi package**

```go
import (
    "adomnia/internal/browser"
    "adomnia/internal/docker"
    "adomnia/internal/plugins"
    "adomnia/internal/python"
    "adomnia/internal/templates"
    "adomnia/internal/themes"
)

func main() {
    configureWindowChromeBackend(startupWindowChrome)

    browserDebug  := browser.NewBrowserDebug()
    themeManager  := themes.NewThemeManager()
    templateStore := templates.NewTemplateStore()
    pluginManager := plugins.NewPluginManager()
    wasmRuntime   := plugins.NewWasmRuntime()
    dockerLab     := docker.NewDockerLab()
    pythonBridge  := python.NewPythonBridge()
    app           := NewApp()
    app.browserDebug = browserDebug

    // ... resto invariato
    Bind: []interface{}{
        app, browserDebug, themeManager, templateStore,
        pluginManager, wasmRuntime, dockerLab, pythonBridge,
    },
}
```

- [ ] **Step 5: Aggiorna `app.go`**

I riferimenti a `globalPluginManager` e `globalPythonBridge` (se esistono come globali in package main) devono essere passati via costruttore o setter. Sostituisci:

```go
// In app.go, aggiorna il tipo del campo:
type App struct {
    ctx          context.Context
    store        *bolt.DB
    browserDebug *browser.BrowserDebug  // era *BrowserDebug
}
```

- [ ] **Step 6: Verifica build — risolvi errori di compilazione uno per uno**

```bash
go build ./...
```

Ci saranno errori di compilazione per riferimenti mancanti. Risolvili in ordine:
1. Tipi non trovati → verificare che la dichiarazione sia nel package giusto
2. Metodi privati usati da altri package → rendere pubblici (maiuscola) quelli necessari
3. Global variables → passarle come parametri

- [ ] **Step 7: Verifica funzionamento**

```bash
wails dev
```
Apri l'app. Verifica che themes, plugins, docker lab, python bridge funzionino.

- [ ] **Step 8: Commit**

```bash
git add internal/themes/ internal/browser/ internal/plugins/ internal/python/ internal/docker/ internal/templates/ main.go app.go
git commit -m "refactor: extract Wails-bound packages (themes, browser, plugins, python, docker, templates)"
```

---

## Task 15: Pulizia finale — `main.go` e `server.go`

Obiettivo: `main.go` ≤ 100 righe, `server.go` = solo mux + loop di RegisterHandlers.

**Files:**
- Modify: `main.go`
- Modify: `server.go`
- Modify: `helpers.go` (rimuovere tutto quello che è stato spostato)
- Delete: `devlog.go` (lo shim di transizione — non serve più)

- [ ] **Step 1: Verifica che lo shim `devlog.go` sia ancora necessario**

```bash
grep -rn "dlog\|dlogErr\|dlogInfo" *.go
```

Se l'output è vuoto (nessun file root usa ancora le funzioni shim), cancella `devlog.go`:
```bash
rm devlog.go
```

- [ ] **Step 2: Verifica `main.go` finale**

```bash
wc -l main.go
```
Expected: ≤ 100 righe. Se è più lungo, sposta le funzioni di inizializzazione rimanenti nel package appropriato.

- [ ] **Step 3: Verifica `server.go` finale**

Il file deve contenere solo:
1. `startHTTPServer()` con la lista di `RegisterHandlers(mux)` 
2. `stopHTTPServer()`
3. La variabile `httpSidecar`

```bash
wc -l server.go
```
Expected: ≤ 60 righe.

- [ ] **Step 4: Verifica globale finale**

```bash
go build ./...
go test ./...
```

```bash
# Verifica zero global variables in internal/
grep -rn "^var " internal/ | grep -v "_test.go"
```
L'output deve mostrare solo variabili di stato dei singoli package (es. connessioni active map), non globali di coordinamento tra package.

- [ ] **Step 5: Smoke test con wails dev**

```bash
wails dev
```
Testa manualmente: Kafka, gRPC, proxy, mock, load test, browser debug, themes, plugins.

- [ ] **Step 6: Commit finale**

```bash
git add -A
git commit -m "refactor: finalize Go internal package reorganization — main.go clean wireman"
```

---

## Riepilogo dei package estratti

| Package | Import path | Pattern |
|---------|-------------|---------|
| devlog | `adomnia/internal/devlog` | Init() + Log/Info/Err + RegisterHandlers |
| httputil | `adomnia/internal/httputil` | JSONError + JSONOk |
| kafka | `adomnia/internal/kafka` | RegisterHandlers |
| broker | `adomnia/internal/broker` | SetDB + RegisterHandlers |
| grpc | `adomnia/internal/grpc` | RegisterHandlers |
| loadtest | `adomnia/internal/loadtest` | SetDB + RegisterHandlers |
| mock | `adomnia/internal/mock` | RegisterHandlers |
| proxy | `adomnia/internal/proxy` | InitRules + RegisterHandlers |
| ws | `adomnia/internal/ws` | RegisterHandlers |
| sse | `adomnia/internal/sse` | RegisterHandlers |
| storage | `adomnia/internal/storage` | Open + DB + RegisterHandlers |
| vault | `adomnia/internal/vault` | RegisterHandlers |
| net | `adomnia/internal/net` | RegisterHandlers |
| jsonutil | `adomnia/internal/jsonutil` | RegisterHandlers |
| oauth | `adomnia/internal/oauth` | RegisterHandlers |
| database | `adomnia/internal/database` | RegisterHandlers |
| themes | `adomnia/internal/themes` | NewThemeManager (Wails binding) |
| browser | `adomnia/internal/browser` | NewBrowserDebug (Wails binding) |
| plugins | `adomnia/internal/plugins` | NewPluginManager + NewWasmRuntime (Wails binding) |
| python | `adomnia/internal/python` | NewPythonBridge (Wails binding) |
| docker | `adomnia/internal/docker` | NewDockerLab (Wails binding) |
| templates | `adomnia/internal/templates` | NewTemplateStore (Wails binding) |
