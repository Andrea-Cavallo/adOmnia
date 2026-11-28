# Load Testing — un solo motore in Go

Obiettivo: lo stress test di adOmnia diventa uno strumento professionale. **Numeri affidabili,
test riproducibili, lo stesso risultato in app e in CI.** Richiesta singola, flow e gRPC usano lo
stesso motore, lo stesso file di scenario e lo stesso pannello.

## 1. Stato attuale (2026-11-28)

| Parte | Dove gira | Problema |
|---|---|---|
| Load test richiesta singola (`LoadTestDrawer`, `internal/loadtest/loadtest.go`) | Go, HTTP sidecar | massimo 200 in parallelo e 50.000 richieste; nessuno stage, soglia, storico vero o CI; burst/gap/load sono modalità a sé |
| Flow Stress (`frontend/src/lib/flowStress*.ts`, `FlowStressPanel.tsx`) | **renderer JS**, un IPC Wails per ogni richiesta | la latenza include IPC + event loop, quindi il p99 non è affidabile; massimo 200 VU; storico in localStorage |
| `adomnia stress` (`internal/adomniacli/stress.go`) | Go, **secondo motore** che riscrive la logica JS | la stessa prova dà numeri diversi in app e in CI; due implementazioni da tenere allineate |
| gRPC load (`loadTestGrpcHandler`) | Go, terzo percorso | metriche e report propri |

Da tenere: HDR histogram (`hdrhistogram-go`), preset smoke/load/spike/soak, stage, soglie
p95/errori/RPS/APDEX, raggruppamento degli errori, baseline, export CSV/JSON/JUnit/HTML, dataset
CSV/JSON. Il lavoro **sposta e unifica**, non riscrive da zero.

## 2. Architettura

```
internal/loadtest/                  motore unico (nessuna dipendenza dalla UI)
  scenario.go     Scenario: target (request | flow | grpc), workload, thresholds, data, seed
  workload.go     executor: closed (VU) e open (arrival rate) con stage
  executor.go     scheduler, VU loop, cancellazione via context, limiti di risorse
  target_http.go  una richiesta via internal/httpexec (stesso client del Composer)
  target_flow.go  grafo del flow (estrazioni, condizioni, branch, script) — logica presa da adomniacli/stress.go
  target_grpc.go  chiamata unary via internal/grpc
  metrics.go      HDR per step + globale, bucket da 1 s, error groups, APDEX
  thresholds.go   valutazione soglie, abort-on-fail
  report.go       JSON (canonico) → Markdown, HTML, JUnit, CSV
  store.go        storico run in bbolt (bucket loadtest/runs), scenari su file
loadtest_bindings.go                Start/Stop/Get/List/Compare — sottile
internal/adomniacli/stress.go       diventa un wrapper: legge il file, chiama loadtest.Run, renderizza
```

- **Un solo client HTTP**: `internal/httpexec`. Auth, variabili, mTLS, proxy e cookie si
  comportano come nel Composer, per costruzione.
- **Eventi live**: `loadtest.progress` (1 Hz: RPS, p50/p95/p99 della finestra, errori, VU attivi,
  stage) e `loadtest.finished`, instradati per `runId`. Il renderer mostra soltanto, non misura.
- **Il sidecar HTTP `/loadtest/*` resta** come alias finché il drawer non passa ai binding, poi viene
  rimosso.

## 3. Modello di carico

| Executor | Uso | Parametri |
|---|---|---|
| `vus` (closed) | "N utenti che ripetono il flow" | `stages: [{durationS, targetVUs}]`, `thinkTimeMs` (fisso o min–max), `iterations` opzionale |
| `arrival-rate` (open) | "N richieste/s qualunque cosa faccia il server" | `stages: [{durationS, targetRps}]`, `maxVUs` (pool) |
| `probe` | ex burst/gap: N richieste insieme o con gap fisso | `count`, `gapMs` |

- **Coordinated omission**: nell'open model la latenza si misura dall'*istante pianificato* di
  partenza, non da quando un VU si libera. Le iterazioni perse perché il pool `maxVUs` è esaurito
  vengono contate (`droppedIterations`) e mostrate, non nascoste.
- **Warm-up / cool-down** come stage marcati `measured: false`.
- **Limiti**: niente cap fisso a 200. Il massimo si calcola da CPU, file descriptor e porte effimere
  (default prudente: 2.000 VU / 20.000 RPS). Oltre serve una conferma esplicita con il motivo.
  Il generatore misura la propria saturazione (CPU > 85%, scheduler in ritardo > 10 ms) e la
  riporta nel risultato: un run con il generatore saturo è marcato **non affidabile**.
- Connessioni: keep-alive di default; opzioni `newConnectionPerIteration`, `http2`, `maxConnsPerHost`.

## 4. Riproducibilità

**Scenario = file versionabile** in `.adomnia/loadtests/<nome>.loadtest.json` (pretty-printed,
chiavi stabili, condiviso via Git come le run configuration):

```json
{
  "format": "adomnia-loadtest",
  "version": 1,
  "name": "checkout-p95",
  "target": { "kind": "flow", "flowId": "checkout" },
  "environment": "staging",
  "workload": {
    "executor": "arrival-rate",
    "maxVUs": 300,
    "stages": [
      { "durationS": 30, "targetRps": 50, "measured": false },
      { "durationS": 300, "targetRps": 200 }
    ]
  },
  "thinkTimeMs": { "min": 200, "max": 800 },
  "data": { "file": "data/users.csv", "mode": "sequential" },
  "seed": 42,
  "thresholds": [
    { "metric": "http_req_duration", "step": "*", "stat": "p95", "lt": 300 },
    { "metric": "errors", "stat": "rate", "lt": 0.01, "abortOnFail": true }
  ]
}
```

- `seed` alimenta **tutto ciò che è casuale**: think time, `{{$randomInt}}`/`{{$uuid}}` del run,
  ordine `random` del dataset. Stesso seed = stessa sequenza.
- Dataset: `sequential` | `random` | `unique` (si ferma quando finisce), letto da file relativo al
  workspace.
- Gli scenari gRPC e flow portano con sé il riferimento (id del flow / file `.proto`); l'export CI
  include il grafo risolto, così `adomnia stress` non dipende dallo storage dell'app.

**Ogni run salva le sue condizioni** (`manifest` dentro il risultato): versione e commit di adOmnia,
hash SHA-256 dello scenario e del dataset, seed, ambiente con **i valori segreti sostituiti da
`***`**, OS/CPU/core del generatore, ora di inizio e fine, saturazione del generatore. Due run con lo
stesso hash di scenario sono confrontabili, altrimenti il confronto lo segnala.

## 5. Risultati

- Metriche **globali e per step**: p50/p75/p90/p95/p99/p99.9/max, RPS, byte in/out, errori per
  status e per gruppo normalizzato, APDEX, `droppedIterations`.
- Serie temporali da 1 s (RPS, p95, errori, VU attivi) salvate nel run per i grafici e il confronto.
- **Storico in bbolt** (`loadtest/runs`, con retention configurabile, default 200 run). Migrazione
  una tantum dello storico Flow Stress da localStorage (si mantengono le chiavi vecchie).
- **Confronto** di due run qualsiasi: delta per metrica e per step, curve sovrapposte, verdetto
  "regressione" se p95 o errori peggiorano oltre la tolleranza (default 10%).
- Soglie valutate a fine run e, con `abortOnFail`, durante il run (finestra mobile di 10 s).
- Export: JSON canonico (quello che salva lo storico), HTML autocontenuto, Markdown, JUnit, CSV.

## 6. UI — un solo pannello "Load Test"

- Lista scenari del workspace a sinistra; editor scenario (target, workload con anteprima grafica
  degli stage, dati, soglie) al centro; storico run a destra.
- Durante il run: grafici live (RPS, latenze, errori, VU), stage corrente, Stop. Stop salva il
  risultato parziale e lo marca `aborted`.
- Il drawer del Composer, la sezione gRPC e il dock Stress dei Flow restano come **avvio rapido**:
  creano/aprono uno scenario e mostrano lo stesso componente risultati.
- Stessi token, componenti e grafici di `FlowStressCharts` (estratti in `components/loadtest/`).

## 7. Fasi

| # | Contenuto | Fatto quando |
|---|---|---|
| LT-1 | Motore: `Scenario`, executor `vus` + `probe`, target HTTP via `httpexec`, metriche per step, binding Start/Stop/progress. Il drawer attuale passa al motore nuovo. | test Go: conteggi esatti per stage, cancellazione, HDR contro un server `httptest` con latenza nota (±5%) |
| LT-2 | Target flow (logica da `adomniacli/stress.go`) + `adomnia stress` come wrapper. Flow Stress UI sul motore Go, `flowStress.ts` rimosso. | stesso scenario, stesso server: app e CLI riportano gli stessi conteggi e p95 entro il 5% |
| LT-3 | Executor `arrival-rate` con correzione coordinated omission, `droppedIterations`, saturazione del generatore. | test: server che si blocca 2 s → il p99 lo riflette; RPS raggiunto entro ±2% |
| LT-4 | File scenario `.adomnia/loadtests`, seed, dataset, manifest, storico bbolt + migrazione. | stesso seed → stessa sequenza di dati e think time (test deterministico) |
| LT-5 | Soglie live + abort, confronto run, export HTML/JUnit/CSV dal JSON canonico. | JUnit fallisce in CI quando una soglia salta; exit code 1 |
| LT-6 | Pannello unico Load Test, avvii rapidi dal Composer/gRPC/Flow, gRPC sul motore. Rimozione sidecar `/loadtest/*`. | check manuali LT-M1…M8 |

Ogni fase si chiude con: test focalizzati Go/Vitest, `npx tsc --noEmit`, aggiornamento di
`docs/adomnia-feature-catalog.en.md` (A5.17, A5.21, B1.10 e la voce Load Testing) e dei check qui sotto.

## 8. Check manuali (da copiare in `mds/MANUAL-CHECK.md` alla fase relativa)

- **LT-M1** Composer → Load test su `{{baseUrl}}/health` con auth Bearer: le variabili e l'auth
  arrivano al server (verificare dal Mock o dal Proxy).
- **LT-M2** Arrival-rate 200 RPS per 60 s contro il Mock con latenza 50 ms: RPS ~200, p95 ~50 ms,
  generatore non saturo.
- **LT-M3** Mock con latenza 2 s per 10 s a metà run: il p99 lo mostra, `droppedIterations` > 0 se
  `maxVUs` è basso.
- **LT-M4** Stop a metà: risultato parziale salvato come `aborted`, nessun processo/goroutine resta attivo.
- **LT-M5** Scenario salvato, commit, clone su un'altra macchina: si apre e gira identico (stesso hash).
- **LT-M6** `adomnia stress .adomnia/loadtests/x.loadtest.json --reporter junit` con una soglia
  violata → exit code 1, JUnit leggibile in CI.
- **LT-M7** Confronto di due run: delta per step e curve sovrapposte; scenario diverso → avviso.
- **LT-M8** Flow con estrazione token + richiesta autenticata a 100 VU: nessun token incrociato tra VU.

## 9. Fuori scope (finché non c'è un consumatore reale)

Generatori distribuiti su più macchine, script di carico in JS stile k6, carico WebSocket/Kafka/SSE,
monitoraggio delle risorse del server target (CPU/memoria via agent), esportazione verso
Prometheus/InfluxDB.
