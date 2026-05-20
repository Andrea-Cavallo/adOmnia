# adOmnia: Architettura Python Layer

> Go è il core. Python è l'acceleratore. gRPC è il contratto.

---

## 1. Visione

adOmnia è un desktop tool enterprise con backend Go e frontend React. Python non sostituisce Go — lo estende dove l'ecosistema Python non ha rivali:

- **AI/LLM**: LangChain, Ollama, embeddings, agenti
- **Security**: Scapy, YARA, nmap, forensics
- **Data**: PDF/OCR, Excel avanzato, NLP, ETL
- **Enterprise legacy**: SAP scripting, IBM tools, SOAP generators

Python gira come **subprocess isolato**, comunicante via gRPC. Non ha accesso diretto al sistema. Non è mai nel critical path dell'UI.

Principio guida: se una feature può essere fatta in Go con performance e complessità accettabili, si fa in Go. Python si usa quando l'alternativa è riscrivere una libreria matura da zero.

---

## 2. Architettura di Sistema

```
┌───────────────────────────────────────────────────┐
│  Frontend (React + TypeScript + Tailwind + Zustand)│
│  Monaco Editor, panels, plugin UI slots            │
└─────────────────────┬─────────────────────────────┘
                      │ Wails IPC (Go ↔ JS)
┌─────────────────────▼─────────────────────────────┐
│  Core Backend (Go)                                 │
│  HTTP engine, proxy, kafka, gRPC server, loadtest  │
│  storage, vault, mock, broker, websocket           │
└────────┬──────────────────────────┬───────────────┘
         │                          │
         │ gRPC (localhost)         │ Native (in-process)
         │                          │
┌────────▼────────────┐    ┌───────▼────────────────┐
│  Python Workers      │    │  Go Services            │
│  Subprocess isolati  │    │  SQLite, NATS, TLS      │
│  Embedded runtime    │    │  Kafka, DNS, crypto     │
│  SDK + protobuf      │    │  DreamServer (fase 1)   │
└─────────────────────┘    └────────────────────────┘
```

### Flusso dati tipico

1. Utente attiva un plugin dalla UI (es. "AI Request Analyzer")
2. Frontend chiama Go via Wails IPC: `PluginExecute(pluginId, payload)`
3. Go spawn/riutilizza un worker Python, invia richiesta gRPC
4. Worker elabora, risponde via gRPC stream o unary
5. Go riceve risultato, lo inoltra al frontend via Wails event
6. Frontend aggiorna la UI

---

## 3. Decisioni Tecniche

### 3.1 IPC: gRPC

**Scelta:** gRPC con protobuf su localhost per tutte le comunicazioni Go ↔ Python.

**Perché:**
- Schema tipizzato — contratto esplicito, errori a compile-time
- Streaming bidirezionale nativo — AI token streaming, packet capture live
- Codegen sia Go che Python — nessun parsing JSON manuale
- Performance superiore a REST/JSON per payload binari
- Ecosystem maturo (grpc-python, grpc-go)

**Trade-off accettati:**
- Aggiunge step di compilazione protobuf
- Dipendenza `grpcio` nel runtime Python (~15MB)
- Più complesso di stdin/stdout per casi banali

**Porta:** ephemeral (OS-assigned), comunicata al worker via env var `ADOMNIA_GRPC_PORT`.

### 3.2 Runtime: Embedded (python-build-standalone)

**Scelta:** bundle un runtime Python completo dentro adOmnia.

**Perché:**
- Zero dipendenze esterne per l'utente
- Versione controllata (no "funziona sul mio Python 3.8")
- Coerente con la filosofia single-executable
- python-build-standalone produce build ~30-40MB (comprimibili)

**Piattaforme:**
| OS | Runtime | Size (compressed) |
|----|---------|-------------------|
| Windows x64 | cpython-3.12-windows-x86_64 | ~15MB |
| macOS arm64 | cpython-3.12-apple-darwin-aarch64 | ~18MB |
| macOS x64 | cpython-3.12-apple-darwin-x86_64 | ~18MB |
| Linux x64 | cpython-3.12-linux-x86_64 | ~16MB |

**Distribuzione:** il runtime embedded vive in `<app_data>/python-runtime/`. Viene estratto al primo avvio o quando mancante.

### 3.3 Sandbox v1: Timeout + Memory

**Scelta:** v1 applica solo timeout e limiti di memoria. Nessun filesystem jail, nessun network filtering.

**Perché:**
- Permette di spedire il plugin system rapidamente
- La complessità di un sandbox granulare (capabilities, seccomp, namespace) è sproporzionata per v1
- I plugin v1 sono first-party o curati — il trust model è implicito
- Sandboxing completo è previsto per v2 quando il marketplace si apre a terzi

**Enforcement:**
```go
type WorkerLimits struct {
    TimeoutMs   int64  // default: 30_000, max: 300_000
    MemoryMB    int    // default: 256, max: 1024
    MaxWorkers  int    // default: 4 concurrent
}
```

- **Timeout:** Go cancella il context gRPC e fa SIGTERM → SIGKILL dopo 5s grace
- **Memory:** su Linux `setrlimit(RLIMIT_AS)`, su Windows Job Objects, su macOS `launchctl limit`
- **Kill automatico:** se il worker crasha o eccede i limiti, Go lo termina e logga l'evento

### 3.4 DreamServer: Strategia Phased

**Fase 1 (ora):** DreamServer è un servizio Go nativo. Integrato direttamente nel backend, esposto al frontend via Wails IPC. Nessuna dipendenza dal plugin system.

**Fase 2 (post plugin system stabile):** DreamServer viene migrato a plugin Python. Diventa la reference implementation ufficiale del plugin system. Se DreamServer non gira bene come plugin, il sistema non è pronto per terzi.

Criterio di migrazione: il plugin system deve supportare:
- Long-running workers (DreamServer è un server)
- Event emission verso il frontend
- Lifecycle hooks (start/stop/restart)
- Stato persistente proprio

---

## 4. Interfacce & Contratti

### 4.1 Proto: Worker Lifecycle

```protobuf
syntax = "proto3";
package adomnia.worker;

option go_package = "adomnia/proto/worker";

service WorkerService {
  // Inizializza il worker con la sua configurazione
  rpc Init(InitRequest) returns (InitResponse);

  // Esegui un task (unary)
  rpc Execute(ExecuteRequest) returns (ExecuteResponse);

  // Esegui un task con streaming (AI, packet capture)
  rpc ExecuteStream(ExecuteRequest) returns (stream ExecuteChunk);

  // Health check
  rpc Ping(PingRequest) returns (PingResponse);

  // Shutdown graceful
  rpc Shutdown(ShutdownRequest) returns (ShutdownResponse);
}

message InitRequest {
  string plugin_id = 1;
  string plugin_version = 2;
  map<string, string> config = 3;
  string data_dir = 4;  // directory dati isolata del plugin
}

message InitResponse {
  bool ready = 1;
  string error = 2;
}

message ExecuteRequest {
  string action = 1;           // nome dell'azione richiesta
  bytes payload = 2;           // JSON o binary, dipende dall'azione
  map<string, string> meta = 3;
}

message ExecuteResponse {
  bool success = 1;
  bytes result = 2;
  string error = 3;
  int64 duration_ms = 4;
}

message ExecuteChunk {
  bytes data = 1;
  bool is_final = 2;
  string error = 3;
}

message PingRequest {}
message PingResponse {
  int64 uptime_ms = 1;
  int64 memory_bytes = 2;
}

message ShutdownRequest {
  int64 grace_period_ms = 1;
}

message ShutdownResponse {
  bool clean = 1;
}
```

### 4.2 Proto: SDK API (Go → Python callback)

```protobuf
syntax = "proto3";
package adomnia.sdk;

option go_package = "adomnia/proto/sdk";

// Il worker chiama questo servizio (hosted da Go) per accedere allo stato adOmnia
service AdOmniaAPI {
  // Ottieni la request corrente dal composer
  rpc GetCurrentRequest(Empty) returns (HttpRequest);

  // Emetti un evento verso il frontend
  rpc EmitEvent(Event) returns (Empty);

  // Log strutturato
  rpc Log(LogEntry) returns (Empty);

  // Leggi variabili ambiente attivo
  rpc GetEnvVariables(Empty) returns (EnvVariables);

  // Leggi/scrivi storage plugin-specifico
  rpc StorageGet(StorageKey) returns (StorageValue);
  rpc StorageSet(StorageEntry) returns (Empty);
}

message Empty {}

message HttpRequest {
  string method = 1;
  string url = 2;
  map<string, string> headers = 3;
  bytes body = 4;
}

message Event {
  string name = 1;
  bytes payload = 2;  // JSON
}

message LogEntry {
  string level = 1;  // debug, info, warn, error
  string message = 2;
  map<string, string> fields = 3;
}

message EnvVariables {
  map<string, string> variables = 1;
}

message StorageKey {
  string key = 1;
}

message StorageValue {
  bytes value = 1;
  bool found = 2;
}

message StorageEntry {
  string key = 1;
  bytes value = 2;
}
```

### 4.3 Plugin Manifest Schema

```json
{
  "$schema": "https://adomnia.dev/schemas/plugin-manifest.v1.json",
  "id": "string (kebab-case, unique)",
  "name": "string (display name)",
  "version": "semver string",
  "description": "string",
  "author": "string",
  "license": "SPDX identifier",
  "runtime": "python",
  "python_version": ">=3.12",
  "entrypoint": "relative path to main.py",
  "actions": [
    {
      "id": "action-id",
      "name": "Display Name",
      "description": "What this action does",
      "streaming": false
    }
  ],
  "ui_slots": ["panel", "composer_tab", "sidebar_widget"],
  "limits": {
    "timeout_ms": 30000,
    "memory_mb": 256
  },
  "dependencies": ["requirements.txt path or inline list"]
}
```

### 4.4 Worker Lifecycle (Diagramma Sequenza)

```
Go Backend                    Python Worker
    │                              │
    ├──spawn process──────────────►│
    │                              │
    │◄──gRPC ready on port────────┤
    │                              │
    ├──Init(config)───────────────►│
    │◄──InitResponse(ready)───────┤
    │                              │
    │  ... worker idle ...         │
    │                              │
    ├──Execute(action, payload)───►│
    │                              ├── (worker calls AdOmniaAPI)
    │◄──GetCurrentRequest()───────┤
    ├──HttpRequest────────────────►│
    │                              │
    │◄──EmitEvent(progress)───────┤
    │                              │
    │◄──ExecuteResponse───────────┤
    │                              │
    │  ... più execute ...         │
    │                              │
    ├──Shutdown(grace)────────────►│
    │◄──ShutdownResponse──────────┤
    │                              X (process exit)
```

**Pool strategy:** Go mantiene un pool di worker. Un worker idle da >60s viene terminato. Worker riavviato on-demand alla prossima richiesta.

---

## 5. Python SDK

### 5.1 API Surface

```python
"""adOmnia Python SDK — installato automaticamente nel runtime embedded."""

from adomnia import api, log

# Accesso allo stato adOmnia (chiama Go via gRPC)
request = api.get_current_request()
env_vars = api.get_env_variables()

# Storage plugin-specifico
api.storage.set("last_scan", json.dumps(results))
data = api.storage.get("last_scan")

# Eventi verso il frontend
api.emit("analysis_complete", {"findings": findings})
api.emit("progress", {"percent": 45, "message": "Scanning headers..."})

# Logging strutturato (forwarded a Go logger)
log.info("Worker started", script=__file__)
log.error("Parse failed", error=str(e), input_size=len(data))
```

### 5.2 Worker Base Class

```python
"""Base class per plugin workers."""

from adomnia.worker import BaseWorker, action

class MyPlugin(BaseWorker):
    def on_init(self, config: dict) -> None:
        """Chiamato una volta all'avvio."""
        self.model = config.get("model", "default")

    @action("analyze")
    def analyze(self, payload: bytes) -> bytes:
        """Azione unary."""
        data = json.loads(payload)
        result = do_analysis(data)
        return json.dumps(result).encode()

    @action("stream_analyze", streaming=True)
    def stream_analyze(self, payload: bytes):
        """Azione streaming — yield chunks."""
        for chunk in process_stream(payload):
            yield chunk

if __name__ == "__main__":
    MyPlugin.serve()  # avvia gRPC server, registra azioni
```

### 5.3 Dipendenze SDK

Il SDK è un package Python minimale:
- `grpcio` + `grpcio-tools` (comunicazione)
- `protobuf` (serializzazione)
- Nessun'altra dipendenza — il resto lo porta il plugin

---

## 6. Runtime Embedded

### 6.1 Struttura su Disco

```
<app_data>/
├── python-runtime/
│   ├── python.exe (o python3)
│   ├── lib/
│   │   └── python3.12/
│   ├── pip (bundled)
│   └── .version  # "3.12.7-standalone"
├── plugins/
│   ├── mqtt-inspector/
│   │   ├── manifest.json
│   │   ├── main.py
│   │   ├── venv/  (plugin-specific virtualenv)
│   │   └── data/  (plugin storage)
│   └── ai-analyzer/
│       └── ...
└── proto/
    └── compiled python stubs
```

### 6.2 Primo Avvio

1. Go verifica se `<app_data>/python-runtime/` esiste e `.version` è corretta
2. Se mancante: estrae l'archivio bundled (incluso nel binary via `embed` o sidecar)
3. Installa SDK adOmnia nel runtime: `python -m pip install ./sdk --target=...`
4. Segna setup completo

**Tempo stimato primo avvio:** 3-8 secondi (estrazione + pip install SDK).

### 6.3 Settings UI

```
Settings → Python Runtime
├── Status: ✅ Ready (Python 3.12.7, embedded)
├── Location: C:\Users\...\AppData\Local\adOmnia\python-runtime
├── [Reinstall Runtime]
├── [Open Runtime Folder]
└── Advanced
    ├── Use system Python instead: [ ] (path: _______)
    └── pip extra-index-url: _______
```

### 6.4 Plugin Dependency Install

Ogni plugin ha il proprio virtualenv isolato:
```
Go: plugin install → 
  1. Crea venv in plugins/<id>/venv/
  2. pip install -r plugins/<id>/requirements.txt --target venv/
  3. Verifica entrypoint importabile
  4. Segna plugin come ready
```

---

## 7. Plugin System

### 7.1 Install Flow

```
User clicks "Install Plugin" →
  Frontend: mostra progresso
  Go: 
    1. Valida manifest.json
    2. Crea directory plugins/<id>/
    3. Copia files
    4. Crea venv + installa dipendenze
    5. Test: spawn worker, Init(), Ping(), Shutdown()
    6. Se test ok → plugin enabled
    7. Se test fallisce → rollback, mostra errore
```

### 7.2 Plugin Discovery (v1)

v1 non ha un marketplace remoto. I plugin si installano da:
- **Bundled:** plugins inclusi nella distribuzione
- **Local folder:** l'utente trascina una cartella plugin
- **Git URL:** clone da repository (futuro)

### 7.3 Plugin UI Slots

I plugin possono iniettare UI in slot predefiniti:

| Slot | Dove appare | Cosa il plugin fornisce |
|------|-------------|------------------------|
| `panel` | Rail principale (icona dedicata) | Intero pannello |
| `composer_tab` | Tab nel Composer | Tab aggiuntivo con contenuto |
| `sidebar_widget` | Sotto la collection tree | Widget compatto |
| `response_tab` | Tab nel ResponsePanel | Analisi della risposta |

Il plugin dichiara gli slot nel manifest. Il frontend rende i componenti basandosi sugli eventi emessi dal worker.

### 7.4 Hot Reload (dev mode)

In dev mode, Go osserva i file del plugin. Su modifica:
1. Shutdown worker corrente
2. Re-spawn con nuovo codice
3. Re-Init()
4. Notifica frontend

---

## 8. DreamServer

### 8.1 Fase 1: Core Service (ora)

DreamServer è integrato come servizio Go nativo:

```go
// dreamserver.go — servizio interno
type DreamServer struct {
    pythonCmd  *exec.Cmd
    grpcConn   *grpc.ClientConn
    port       int
}

func (ds *DreamServer) Start(config DreamConfig) error { ... }
func (ds *DreamServer) Stop() error { ... }
func (ds *DreamServer) Execute(action string, payload []byte) ([]byte, error) { ... }
```

- Usa il runtime Python embedded
- Comunicazione via gRPC come i plugin (stesso proto)
- Ma lifecycle gestito direttamente da Go, non dal plugin manager
- UI dedicata nel frontend (non dipende dal plugin slot system)

### 8.2 Fase 2: Migration a Plugin

**Prerequisiti** (tutti devono essere soddisfatti):
- [x] Plugin system supporta long-running workers (idle reaper + pool gestito)
- [x] Event emission funziona end-to-end (`EmitEvent` → Wails → React)
- [x] Lifecycle hooks (start/stop/restart) implementati (`Init`, `Shutdown`, `Ping`)
- [x] Storage persistente plugin funzionante (`StorageGet`/`StorageSet` su bucket bbolt `plugin_storage`)
- [ ] Almeno 2 altri plugin funzionano stabilmente (solo echo-plugin attualmente)

**Migration steps:**
1. Creare `manifest.json` per DreamServer
2. Estrarre config da Go hardcoded → manifest
3. UI: migrare da pannello dedicato a plugin panel slot
4. Test: identico comportamento pre/post migrazione
5. Rimuovere codice Go specifico DreamServer
6. Documentare come "reference plugin implementation"

---

## 9. Roadmap Implementativa

### Fase 1: Fondamenta (2-3 settimane)

**Deliverable:** un worker Python risponde a un comando Go via gRPC.

- [x] Definire e compilare proto (worker.proto, sdk.proto)
- [x] Implementare Go gRPC server per SDK API (`python_sdk_server.go`)
- [x] Implementare Go worker manager (spawn, init, execute, kill) (`python_worker.go`)
- [x] Bundlare python-build-standalone per Windows (`python_runtime.go` — BootstrapRuntime estrae zip + installa SDK)
- [x] Python SDK base: BaseWorker, gRPC client, serve() (`python-sdk/adomnia/worker.py`)
- [x] Test end-to-end: Go spawna worker, Execute(), riceve risultato (`workspaces/plugins/echo-plugin`)
- [x] Worker limits: timeout enforcement (`WorkerLimits` in `python_bindings.go`)

**Dipendenze:** nessuna (può partire subito)

### Fase 2: Plugin System (2-3 settimane)

**Deliverable:** utente installa un plugin locale, lo vede nella UI, lo esegue.

- [x] Plugin manifest parser e validator (`plugins.go`)
- [x] Plugin install flow (venv creation, dependency install) (`plugins.go` — `InstallPythonPlugin`, `createVirtualenv`, `installRequirements`)
- [x] Plugin manager UI (list, enable/disable, uninstall) (`PluginManager.tsx`)
- [x] UI slot rendering (almeno `panel` e `response_tab`) (`PluginPanel.tsx` — panel slot con esecuzione azioni)
- [x] Event bridge: worker emit → Go → Wails event → React (`SDKServer.EmitEvent` → `EventsEmit`)
- [x] Primo plugin bundled: echo-plugin (`workspaces/plugins/echo-plugin/`)

**Dipendenze:** Fase 1 completata

### Fase 3: DreamServer + AI (2-4 settimane)

**Deliverable:** DreamServer funzionante come core service, primo plugin AI.

- [ ] DreamServer integrazione Go (fase 1 del phasing)
- [ ] DreamServer UI panel nel frontend
- [ ] Plugin AI: analisi request con LLM locale (Ollama)
- [x] Streaming gRPC funzionante end-to-end (`ExecuteStream` implementato in `python_worker.go` + `python_bindings.go`)
- [x] Memory limits enforcement (`python_worker_windows.go` — Windows Job Object con `JOB_OBJECT_LIMIT_PROCESS_MEMORY`)
- [x] Settings UI per Python runtime (`SettingsPanel.tsx` sezione "Python Runtime" con status, path, version, buttons)

**Dipendenze:** Fase 2 completata (per il plugin AI), DreamServer può partire in parallelo alla Fase 2

### Fase 4: Hardening + Multi-platform (2-3 settimane)

**Deliverable:** stabile su Win/Mac/Linux, pronto per utenti reali.

- [ ] Bundle python-build-standalone per macOS e Linux (Windows fatto, macOS/Linux pendenti)
- [x] Worker pool con idle timeout e restart automatico (idle reaper ogni 30s, kill dopo 60s inattività)
- [ ] Error recovery: worker crash → retry con backoff
- [ ] Plugin dependency conflict detection
- [ ] Hot reload in dev mode
- [ ] Documentazione utente: come creare un plugin
- [ ] Preparazione fase 2 DreamServer (valutare prerequisiti)

**Dipendenze:** Fase 3 completata

---

## 10. Anti-pattern

| Pattern | Motivo | Alternativa |
|---------|--------|-------------|
| Business logic in Python | Lento, non compilato, GIL, difficile da distribuire | Tienilo in Go |
| Python accede al filesystem host | Rischio sicurezza, path divergenze cross-platform | Solo via SDK storage API |
| Import Python da Go (cgo + CPython) | Crash, memory leak, build nightmare | Subprocess + gRPC |
| Un runtime Python condiviso tra plugin | Conflitti dipendenze, instabilità | Venv isolato per plugin |
| gRPC su porta fissa | Conflitti con altri servizi, test paralleli impossibili | Porta ephemeral via env |
| Plugin che spawna sotto-processi | Escape dal sandbox, resource leak | Vietato in v1, valutare in v2 |
| Threading pesante in Python | GIL, race conditions, debugging infernale | asyncio o multiprocessing via Go orchestration |
| Marketplace remoto in v1 | Richiede infra, review, trust model, CDN | Solo plugin locali/bundled in v1 |

---

vantaggi del python layer : 

  ---
  1. AI-Powered Request Analysis

  L'utente manda una API request e un plugin Python con LangChain/Ollama analizza automaticamente: suggerisce header mancanti,
  identifica problemi di sicurezza, genera documentazione dalla response. Nessun competitor desktop lo fa localmente.

  2. Security Scanning Integrato

  Plugin che scansiona il traffico proxy in real-time: YARA rules su payload, detection di data leak (PII, secrets), analisi di
  certificati TLS con librerie Python mature (cryptography, pyOpenSSL). Burp Suite ha questo — Postman no.

  3. Plugin Ecosystem = Moat Competitivo

  Gli utenti possono creare i propri plugin senza toccare Go/Rust. Python abbassa la barriera d'ingresso: milioni di
  sviluppatori possono estendere adOmnia. Crea un ecosistema che si auto-alimenta.

  4. Parsing di Formati Enterprise Complessi

  WSDL, SOAP envelope generation, EDI/X12, HL7 (healthcare), SWIFT (banking) — librerie Python mature che in Go richiederebbero
  mesi di sviluppo. Un plugin Python li supporta in giorni.

  5. Test Generation Automatica

  Un plugin AI che osserva le request dell'utente e genera automaticamente test suite: scenari edge case, fuzzing payloads,
  contract tests. Usa la request history come training data.

  6. Data Transformation Pipeline

  Trasformazione di response complesse: Excel → JSON, PDF extraction, CSV pivot, XML normalization, protobuf decode senza
  schema. Python ha pandas, openpyxl, pdfplumber — Go no.

  7. DreamServer come Mock Intelligente

  Mock server che non serve risposte statiche ma genera risposte contestuali via LLM. Simula API non ancora sviluppate con
  risposte realistiche. Utile per frontend dev che non ha backend pronto.

  8. Legacy System Bridge

  Plugin che parlano SAP RFC, IBM MQ, CICS, AS/400 — protocolli che hanno SDK solo Python o Java. Sblocca un segmento enterprise
   che nessun API tool moderno copre.

  9. Custom Auth Flow Scriptabili

  OAuth flows non-standard, token rotation custom, HMAC proprietari, firma digitale eIDAS — l'utente scrive 20 righe di Python
  invece di aspettare che tu implementi ogni variante in Go.

  10. Workflow Automation (Chained Requests)

  Pipeline dove l'output di una request alimenta la successiva con logica Python arbitraria: parsing, branching condizionale,
  retry con backoff, aggregazione risultati, report generation. Più potente dei pre/post scripts JS.

  ---
  In sintesi: il Python layer trasforma adOmnia da "tool con feature fisse" a "piattaforma estendibile" — senza sacrificare le
  performance del core Go. È la differenza tra Notepad e VS Code.


*adOmnia: core veloce, estensioni intelligenti.*
