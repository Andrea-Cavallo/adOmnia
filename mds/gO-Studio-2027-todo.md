# gO Studio 2027 — Lavoro aperto per priorità

> **Visione:** non costruire semplicemente “un IDE Go dentro adOmnia”, ma un ambiente di sviluppo Go completo in cui **codice, runtime, API, database, broker, log, trace, profiler e Git sono collegati tra loro**.
>
> **North Star:** _Write the service. Run it. Call it. Debug it. Inspect its database, messages, logs and runtime — without leaving the workspace._
>
> **Principio chiave:** **From code to runtime, everything is connected.**

Questo file contiene **solo le voci ancora aperte**, in ordine di priorità per un IDE Go di prima fascia. Il 2026-10-01, e di nuovo il 2026-10-10, ogni voce è stata
verificata nel codice: quelle chiuse sono state rimosse (la loro storia è in git, nel `CHANGELOG.md` e in
`docs/releases/`). Le prove manuali nell'app avviata sono in [`todo-ide.md`](todo-ide.md).

## Regole

- Si lavora dall'alto: P0 → P4. Dentro una priorità, le sezioni sono in ordine di impatto per l'utente.
- Criterio d'ordine: **fiducia** (non perdere lavoro, non bloccarsi) → **completezza da IDE** → **eccellenza Go** → **runtime connesso** → **intelligenza**.
- Una voce si chiude solo se verificata nel codice; chiusa, si **cancella** da qui e finisce nel CHANGELOG.
- *Parziale:* dice cosa esiste già e cosa manca: si riparte da lì, non da zero.
- Niente funzioni simulate, dati sempre locali, nessun processo avviato senza un'azione dell'utente.

## Riepilogo

| Priorità | Tema | Voci aperte | Di cui parziali |
| --- | --- | --- | --- |
| **P0** | Fondamenta: un IDE di cui fidarsi tutto il giorno | 0 | 0 |
| **P1** | Workflow Go migliore di GoLand | 0 | 0 |
| **P2** | Codice ↔ runtime: la differenza adOmnia | 37 | 15 |
| **P3** | Remote ed estensibilità | 3 | 3 |
| **P4** | AI e intelligenza del workspace | 150 | 18 |
| **Riferimento** | Obiettivi, qualità, roadmap e KPI | 135 | 38 |

---

# P0 — Fondamenta: un IDE di cui fidarsi tutto il giorno

_Chiusa il 2026-10-06: l'ultima voce (crash con 10 file dirty) è coperta da `TestKillDuringSnapshotWritesKeepsEveryBuffer` (kill reale, 10 buffer su due workspace integri) e `TestRecoveryLatencyWithTenDirtyFiles` (bbolt reale: snapshot più lenta ~13 ms in locale e ~160 ms sulla CI Linux contro budget 500 ms, sotto il debounce di 750 ms; ripristino di 10 buffer ~6 ms contro 500 ms)._

---

# P1 — Workflow Go migliore di GoLand

_Chiusa il 2026-10-05: profiler, trace, sicurezza, Context Propagation Inspector (anche fra package, con grafo visuale e trace ID runtime), Architecture Explorer e Documentation Intelligence sono nel `CHANGELOG.md`._

---

# P2 — Codice ↔ runtime: la differenza adOmnia

_Il flusso North Star: dal codice alla chiamata, al debug, a DB, broker, log e trace — senza uscire dal workspace._

## §61 · North Star Experience

Lo scenario ideale da raggiungere:

- [ ] Il distributed debugger collega i due servizi. — *Parziale: dalla trace (Trace Studio) "Break here" mette il breakpoint sulla riga della span nel servizio giusto e la request successiva si ferma lì; log, messaggi e span dei due servizi sono legati per trace ID. Manca una sessione di debug unica che segua la request da un servizio all'altro.*

Quando questo flusso funziona bene, gO Studio non è più “un IDE aggiunto ad adOmnia”.

È il punto in cui **adOmnia diventa un ambiente di sviluppo completo per sistemi Go**.

## §29 · Docker e Containers

- [ ] Attach debugger.
- [ ] Run tests in container.
- [ ] Run profiler in container.
- [ ] Container → local service mapping.
- [ ] Dev container support.
- [ ] BuildKit awareness.

## §39 · Smart Local Development Environment

- [ ] Detect ports. — *Parziale: devcontext/compose.go legge le porte dei servizi compose e le run config hanno il campo port; nessun rilevamento globale.*

### One-click environment

- [ ] Open API. — *Parziale: CodeLens Open in API Client sugli handler e opener route in palette; non fa parte di un flusso Start workspace.*
- [ ] Open logs. — *Parziale: ServiceLogsDrawer apre i log della sessione nel Log Inspector; non c'è un flusso unico.*
- [ ] Clean workspace.

## §44 · UX Layout proposta

```text
┌───────────────────────────────────────────────────────────────────────┐
│                           gO STUDIO                                   │
├──────────────┬─────────────────────────────────────┬──────────────────┤
│              │                                     │                  │
│ WORKSPACE    │               CODE                  │     CONTEXT      │
│              │                                     │                  │
│ Files        │                                     │ API              │
│ Symbols      │                                     │ DB               │
│ Services     │                                     │ Kafka            │
│ Endpoints    │                                     │ Runtime          │
│ Tests        │                                     │ AI               │
│ Modules      │                                     │ Architecture     │
│              │                                     │                  │
├──────────────┴─────────────────────────────────────┴──────────────────┤
│ RUN │ TEST │ DEBUG │ LOGS │ TERMINAL │ PROFILE │ TRACE │ PROBLEMS    │
└───────────────────────────────────────────────────────────────────────┘
```

### Context panel intelligente

- [ ] Seleziono goroutine → concurrency context. — *Parziale: il pannello Context riconosce le righe `go …` e, in pausa nel debugger, conta le goroutine create lì per stato; manca una vista di concorrenza (canali, lock) legata alla riga.*
- [ ] Seleziono errore → debugging context. — *Parziale: il pannello Context mostra i problemi della riga; error chain e panic restano nel pannello debug.*
- [ ] Seleziono trace → runtime context. — *Parziale: il pannello Context mostra i numeri Runtime Lens della riga; selezionare una trace non apre ancora un contesto runtime.*

## §31 · Service Map

> *Base esistente:* Observability → Traces → **Service map** dalle trace OTLP: servizi, archi HTTP/gRPC/SQL/messaging/esterni con rate, p50/p95, errori; dall'arco si aprono una trace, una trace fallita, il codice chiamante, il topic o Database Studio. Redis compare come datastore (`db.system=redis`).

### Static

- [ ] WebSocket edges. — *Parziale: devcontext rileva server e client WebSocket (goprotocols.go); non sono mostrati come archi.*

### Runtime

- [ ] Active connections.

## §32 · Distributed Request Debugger — Killer Feature

> Debuggare una richiesta attraverso più componenti, non solo una funzione.

### Capture

- [ ] Collegare gRPC.
- [ ] Collegare goroutines.

### Timeline

- [ ] Service boundaries. — *Parziale: la vista distribuita mostra il servizio di ogni span e l'elenco dei servizi della trace; mancano confini basati su acquisizione runtime completa.*

### Source navigation

- [ ] Click retry → policy.

## §14 · Runtime Lens

> Mostrare informazioni runtime direttamente sopra o accanto al codice.
>
> *Base esistente:* Runtime Lens (View → Toggle Runtime Lens) dalle span OpenTelemetry ricevute in locale: chiamate, p50/p95 (p99/avg/max nel tooltip), errori, ultima esecuzione, hot/slow path, per ogni `code.filepath:code.lineno`.

- [ ] Allocation estimate.
- [ ] CPU cost.
- [ ] Runtime values opzionali.
- [ ] Sampling per ridurre overhead.

### Esempi

- [ ] Cache access → hit/miss.
- [ ] Function → allocations.
- [ ] Goroutine → lifetime.

## §33 · Reproduction Studio

> Trasformare un bug osservato in uno scenario ripetibile.
>
> *Base esistente:* **Save reproduction** sulla risposta live (API Workspace) e nel tab Request del debug: scrive `repro/<data>-<request>/` nel progetto con README, `request.http`, test Go di regressione, `queries.sql`, fixture Kafka, `.env.example`, `logs.txt`, `stack.txt`; segreti rimossi, valori non deterministici elencati.

- [ ] Capture relevant DB state.
- [ ] Capture feature flags.

### Output

- [ ] Generate unit test.
- [ ] Generate Docker/Compose reproduction where useful.

## §48 · Enterprise — protocolli legacy in gO Studio

- [ ] mTLS. — *Parziale: mTLS esiste nel client HTTP/gRPC di adOmnia (internal/httpexec, internal/grpc); non integrato in Go Studio.*
- [ ] JKS/PKCS12 helper integration dove utile. — *Parziale: Strumenti PEM/JKS in nettools e pdfsign; nessun legame con Go Studio.*
- [ ] Legacy SOAP services. — *Parziale: Pannello SOAP con envelope e WS-Security in adOmnia; non collegato a Go Studio.*
- [ ] WSDL. — *Parziale: Import WSDL da file, URL e testo nel pannello SOAP; non integrato in Go Studio.*
- [ ] XML. — *Parziale: Go Studio apre .xml/.xsd/.wsdl con syntax highlighting; nessun tooling XML.*
- [ ] WS-Security tooling. — *Parziale: WS-Security UsernameToken nel pannello SOAP; non esposto in Go Studio.*

---

# P3 — Remote ed estensibilità

_Sviluppo su WSL/SSH/container/Kubernetes e API per estendere l'IDE._

## §47 · Plugin / Extension Architecture

> *Base esistente:* `contributes` dei plugin consumati da Go Studio: comandi (azioni dell'editor e Search Everywhere), code action (lampadina), analyzer (marcatori al salvataggio), language server di estensione e template in New Project (`goStudioExtensions.ts`, `internal/goide/extensions.go`).

- [ ] Framework adapters. — *Parziale: dichiarati nel manifest e mostrati con le dipendenze dirette in IDE extensions; nessun comportamento nel codice.*
- [ ] Broker adapters. — *Parziale: come sopra.*
- [ ] DB adapters. — *Parziale: come sopra.*

---

# P4 — AI e intelligenza del workspace

_Da progettare prima di implementare: grafi semantici, analisi di impatto, AI che usa il runtime._

## §36 · Semantic Workspace Graph

> Una rappresentazione persistente delle relazioni del progetto.

- [ ] Files.
- [ ] Packages.
- [ ] Symbols. — *Parziale: WorkspaceSymbols via gopls ed entità devcontext; manca un grafo persistente con relazioni.*
- [ ] Functions.
- [ ] Types.
- [ ] Interfaces.
- [ ] Implementations.
- [ ] Tests.
- [ ] Endpoints. — *Parziale: devcontext rileva entità route con file:riga, apribili dalla palette; nessun grafo con relazioni.*
- [ ] gRPC methods. — *Parziale: devcontext rileva entità grpc con apertura nel client gRPC; nessun grafo con relazioni.*
- [ ] Topics. — *Parziale: devcontext rileva entità topic Kafka/AMQP/NATS con apertura in Broker Studio; nessuna relazione.*
- [ ] Consumers.
- [ ] Producers.
- [ ] DB tables. — *Parziale: devcontext rileva entità table da SQL letterale con apertura in Database; nessuna relazione.*
- [ ] Queries.
- [ ] Config keys.
- [ ] Env vars. — *Parziale: devcontext rileva entità envvar da os.Getenv, tag e .env; nessuna relazione.*
- [ ] Services. — *Parziale: ProjectServices da go.mod ed entità service da compose; non è un grafo.*
- [ ] External dependencies. — *Parziale: Entità module (devcontext/gomod.go) e dialog Go dependencies; nessun grafo di relazioni.*

### Utilizzi

- [ ] Faster navigation.
- [ ] Impact analysis.
- [ ] AI context retrieval.
- [ ] Architecture visualization.
- [ ] Test selection.
- [ ] Security path analysis.
- [ ] Change impact analysis.
- [ ] Runtime correlation.

## §37 · Change Impact Analysis

> Prima di modificare una funzione, capire cosa può rompere.

- [ ] Indirect callers. — *Parziale: La gerarchia si espande a livelli; nessuna analisi automatica degli indiretti né tab Impact.*
- [ ] Interfaces affected. — *Parziale: Type hierarchy e marker di implementazione; nessuna analisi di impatto aggregata.*
- [ ] Tests affected.
- [ ] APIs affected.
- [ ] gRPC methods affected.
- [ ] Kafka flows affected.
- [ ] DB queries affected.
- [ ] Modules affected.
- [ ] Services affected.
- [ ] Public contracts affected.
- [ ] Config affected.

### UX

- [ ] `Impact` tab.
- [ ] Risk map.
- [ ] Suggested tests.
- [ ] Suggested integration calls.
- [ ] Suggested services to run.

## §34 · Runtime-Aware AI

### Principio

- [ ] L'AI non deve conoscere solo il file aperto. — *Parziale: le azioni AI dell'editor (`goStudioAIActions.ts`) allegano funzione o selezione, riferimenti gopls, diff Git, test falliti e coverage; manca il semantic graph del workspace.*
- [ ] Deve poter usare il semantic graph del workspace.
- [ ] Deve conoscere profiler.
- [ ] Deve conoscere runtime traces.
- [ ] Deve conoscere logs.

### Azioni contestuali

_Chiusa il 2026-10-07: le 18 azioni AI dell'editor sono nel `CHANGELOG.md` (0.9.64)._

## §35 · AI Debugging

- [ ] Panic analysis. — *Parziale: Panic inspector nel debugger rileva il panic e il frame di origine; nessuna analisi AI.*
_Analisi dei test falliti implementata il 2026-10-08: Tests → Analyze failure prepara una bozza milk/Copilot con output registrato, posizione e comando di riproduzione. Policy AI, esclusioni, redazione e limite dell'output sono coperti da test; lo smoke desktop/provider resta in `todo-ide.md`._
- [ ] Race analysis. — *Parziale: Race detector con card dei due accessi e confronto fra run; analisi euristica, non AI.*
- [ ] Deadlock analysis. — *Parziale: La Concurrency View segnala possibile deadlock e canali bloccati in modo euristico; nessuna spiegazione AI.*
- [ ] Slow request analysis.
- [ ] Memory leak suspicion analysis.
- [ ] Allocation regression analysis.
- [ ] DB error analysis.
- [ ] Kafka failure analysis.
- [ ] gRPC error analysis.
- [ ] Context deadline analysis. — *Parziale: Il debugger mostra deadline/err/cause di context.Context; non è un'analisi.*

### AI debugging context

- [ ] Stack trace.
- [ ] Locals.
- [ ] Goroutines.
- [ ] Last logs.
- [ ] Recent request.
- [ ] Trace.
- [ ] Git diff.
- [ ] Relevant tests.
- [ ] Related functions.
- [ ] Runtime metrics.

### Actions

- [ ] “Show likely cause”.
- [ ] “Open relevant code”.
- [ ] “Generate fix”.
- [ ] “Generate regression test”.
- [ ] “Reproduce”.
- [ ] “Explain why”.
- [ ] “Compare with previous working commit”.

## §38 · Architectural Drift Detection

> Confrontare l'architettura desiderata con ciò che il codice sta diventando.

- [ ] Definire architecture rules.
- [ ] Package boundaries.
- [ ] Forbidden imports.
- [ ] Allowed dependencies.
- [ ] Layer rules.
- [ ] Domain boundaries.
- [ ] Service boundaries.
- [ ] No direct DB access outside repository.
- [ ] No broker calls from forbidden layers.
- [ ] No HTTP client from domain layer.
- [ ] Circular dependencies.
- [ ] Drift report.
- [ ] Diff architecture per commit/branch.

## §56 · Nuove idee da valutare

### A. Live Dependency Heatmap

- [ ] Visualizzare quali package sono più usati runtime.
- [ ] Evidenziare dipendenze statiche mai attraversate.
- [ ] Evidenziare dipendenze centrali troppo accoppiate.
- [ ] Visualizzare “blast radius” di una modifica.

### B. API Contract Drift

- [ ] Confrontare handler con OpenAPI. — *Parziale: contractDrift.ts confronta le route con OpenAPI; niente DTO o direzione inversa.*
- [ ] Confrontare DTO con schema OpenAPI.
- [ ] Detect endpoint documentato ma non implementato.
- [ ] Detect breaking changes.
- [ ] Diff API per branch.

### C. Event Contract Drift

- [ ] Schema Kafka ↔ Go struct.
- [ ] Producer ↔ consumer compatibility.
- [ ] Breaking event changes.
- [ ] Missing fields.
- [ ] Type mismatch.
- [ ] Version evolution.

### D. Runtime Snapshot

- [ ] Salva goroutines. — *Parziale: Copia JSON di goroutine, diagnosi e race negli appunti; non persistito.*
- [ ] Salva heap summary.
- [ ] Salva active requests.
- [ ] Salva broker activity.
- [ ] Salva recent logs.
- [ ] Salva DB activity.
- [ ] Salva trace.
- [ ] Compare snapshot before/after.

### E. “Why is this running?”

Su una goroutine/process/task:

- [ ] Da quale request è nata.
- [ ] Da quale message è nata.
- [ ] Da quanto tempo vive.
- [ ] Quale context possiede. — *Parziale: Relazione goroutine → ctx.Done() e Inspector Runtime; nessuna ownership completa.*
- [ ] Quale cancellation path ha.

### F. “Why is this dependency here?”

- [ ] Module.
- [ ] Package.
- [ ] Import chain.
- [ ] Runtime usage.
- [ ] Security impact.
- [ ] Binary size impact.

### G. Binary Inspector

- [ ] Binary size.
- [ ] Package contribution.
- [ ] Symbol contribution.
- [ ] Embedded assets.
- [ ] Build metadata.
- [ ] Go version.
- [ ] Module versions.
- [ ] Compare binary size between commits.

### H. Startup Analyzer

- [ ] Startup duration.
- [ ] Slow init functions.
- [ ] Slow config loading.
- [ ] Slow dependency initialization.
- [ ] DB connect duration.
- [ ] Broker connect duration.
- [ ] HTTP server ready time.
- [ ] Ready signal timeline.

### I. Shutdown Analyzer

- [ ] Context cancellation.
- [ ] HTTP graceful shutdown.
- [ ] Pending goroutines.
- [ ] Pending Kafka messages.
- [ ] DB cleanup.
- [ ] Timeout exceeded.
- [ ] Resource leaks.
- [ ] “Why process does not exit?”

### J. Go Memory Model Helper

- [ ] Spiegare happens-before relevante.
- [ ] Channel synchronization edges.
- [ ] Mutex synchronization edges.
- [ ] Atomic operations.

---

# Riferimento — Obiettivi, qualità, roadmap e KPI

_Non è lavoro diretto: si chiude quando le funzioni sopra arrivano._

## §0 · Obiettivi di prodotto

- [ ] gO Studio deve poter sostituire un IDE Go tradizionale per il lavoro quotidiano. — *Parziale: Le funzioni P0 ci sono, con test automatici. Manca la verifica manuale M1-M31 e ci sono lacune su refactor e profiler.*
- [ ] Deve funzionare bene su repository piccoli, monorepo e workspace multi-module. — *Parziale: Supporto a `go.work`, multi-modulo e folder mode (`gowork.go`). Prestazioni su monorepo grandi mai misurate.*
- [ ] Deve usare i tool ufficiali Go quando possibile: `go test`, `go vet`, `go list`, `go tool`, `pprof`, `trace`, `govulncheck`, race detector. — *Parziale: Ci sono test, vet, race, generate, fix, mod why/graph e profilo test. Mancano viewer pprof/trace e govulncheck vero.*
- [ ] Deve rendere visuali dati che oggi finiscono quasi sempre nel terminale. — *Parziale: Visuali: test tree, coverage, goroutine, race, benchmark. Mancano profiler e altre viste.*
- [ ] Deve collegare automaticamente codice ↔ API ↔ DB ↔ broker ↔ runtime. — *Parziale: Developer Context e Live Session collegano codice, API, DB e broker. Verifica manuale aperta.*
- [ ] Deve avere una UX coerente con il resto di adOmnia. — *Parziale: Token condivisi, menu e dialog moderni. Resta la verifica visiva manuale.*

## §1 · Priorità strategiche

### P1 — IDE Go superiore alla media

> Ogni voce ha la sua sezione operativa più sotto (§8–§21): si spunta lì, poi qui.

- [ ] Benchmark explorer. — *Parziale: gutter, benchmem, confronto, storico ed export CSV; mancano profiling del benchmark e confronto tra commit.*
- [ ] Dependency intelligence. — *Parziale: Dependency Graph con versioni duplicate, licenze, peso, unused/indirect e govulncheck; manca l'analisi d'impatto sul binario.*

### P2 — Differenziazione adOmnia

- [ ] Distributed Request Debugger. — *Parziale: servizio singolo completo; multi-servizio solo via trace e log correlati.*
- [ ] Reproduction Studio. — *Parziale (§33): Save reproduction completo e senza segreti; mancano stato DB, feature flag e replay di sessione.*
- [ ] Cross-service debugging. — *dipende dal Distributed Request Debugger (§32).*
- [ ] Unified local environment. — *Parziale: Project Services, Docker Lab (`GoStudioProjectServicesDialog.tsx`) e Run → Start Workspace rilevano e avviano Compose + servizi Go in una compound condivisa. Manca ancora la vista unica con health, migrations, seed e log.*

### P3 — Funzioni “2027”

- [ ] Runtime-aware AI.
- [ ] Automatic bug reproduction.
- [ ] Performance regression detection.
- [ ] Architectural drift detection.
- [ ] Smart refactoring multi-service.
- [ ] Continuous background code intelligence locale.
- [ ] Semantic workspace graph.
- [ ] Replay di richieste/eventi.
- [ ] Time-travel debugging dove tecnicamente possibile.

## §55 · Funzioni che danno identità a gO

Se si dovessero scegliere **solo 8 funzioni distintive**, sceglierei:

- [ ] **Distributed Request Debugger**.
- [ ] **Reproduction Studio**. — *Parziale: salvataggio completo e senza segreti; manca il replay di una sessione salvata con i messaggi broker.*
- [ ] **Semantic Workspace Graph**. — *Parziale: internal/devcontext produce entità e snapshot (route, tabelle, topic) usati dalla palette; manca un grafo di relazioni.*
- [ ] **Runtime-aware AI**.

Queste sono le funzioni che possono far dire:

> “Questo non è soltanto un altro IDE Go.”

## §51 · “Do not build badly” checklist

- [ ] Non creare un clone incompleto di GoLand.
- [ ] Non creare una chat AI gigante come feature principale.
- [ ] Non mostrare 20 pannelli contemporaneamente.
- [ ] Non riempire l'editor di badge.
- [ ] Non rendere Runtime Lens sempre acceso.
- [ ] Non introdurre astrazioni magiche impossibili da debuggare.

## §57 · Definition of Done per feature

Ogni nuova feature di gO dovrebbe essere considerata finita solo se:

- [ ] Funziona su Windows. — *Parziale: Suite automatiche passano con gopls e Delve reali; check manuali M1-M31 ancora aperti.*
- [ ] Funziona su macOS.
- [ ] Funziona su Linux. — *Parziale: Suite automatiche in CI; verifica manuale su desktop ancora aperta.*
- [ ] Non blocca UI.
- [ ] Ha keyboard navigation.
- [ ] Ha error state.
- [ ] Ha empty state.
- [ ] Ha loading state.
- [ ] Ha cancellation.
- [ ] Ha logs diagnostici.
- [ ] Ha setting dedicati se necessari.
- [ ] È disattivabile se costosa. — *Parziale: Low-Resource Mode disattiva highlighting, inlay e lint; non c'è un toggle per ogni feature costosa.*
- [ ] Funziona su repository medio/grande.
- [ ] Ha test.
- [ ] Ha documentazione minima.
- [ ] Si integra visivamente con adOmnia.
- [ ] Si collega alle altre aree quando semanticamente utile.

## §52 · Killer Features da comunicare

### Killer #2 — Runtime Lens

- [ ] DB timings.
- [ ] Broker timings.

**Messaggio:** _Your code editor knows what happened at runtime._

### Killer #3 — Code → Everything

- [ ] Log → source. — *Parziale: Log Inspector risolve gli stack frame verso il sorgente; manca il link per ogni riga di log.*

**Messaggio:** _Every integration is one click away from the code that implements it._

### Killer #4 — Distributed Request Debugger

- [ ] HTTP. — *Parziale: request run con log, SQL e Kafka legati da id; tra servizi tramite `traceparent` (log e span), ma senza breakpoint coordinati su più servizi.*
- [ ] gRPC.
- [ ] Kafka. — *Parziale: Kafka watch dei messaggi per request (devsession/kafkawatch.go), solo plaintext e singolo servizio.*
- [ ] DB. — *Parziale: Query SQL da log o proxy associate alla request, solo servizio singolo, senza durate.*
- [ ] Logs. — *Parziale: Log del servizio legati alla request per id o tempo, solo servizio singolo.*

**Messaggio:** _Debug the request, not just the process._

### Killer #5 — Reproduction Studio

- [ ] Replay. — *Parziale: si rinvia la request e Trace Studio carica il `trace.json` salvato; niente replay completo di una sessione con i messaggi broker.*

**Messaggio:** _Turn a production-like failure into a reproducible test._

## §60 · Effetti wow (idee 2026-10-10)

Idee che costruiscono sopra pezzi già esistenti: l'effetto nasce dal collegarli, non da funzioni nuove isolate. Ordine consigliato: **#4** (impatto rapido, usa la matrice degli environment) → **#5** (vetrina per README e video) → **#1 / #2** (unicità).

### Wow #1 — Rewind della richiesta

Dopo Send, una timeline da trascinare mostra in ordine richiesta HTTP, riga del handler Go, query SQL, messaggi Kafka e log; si torna indietro e avanti come in un video.

- [ ] Timeline unica per request run con eventi ordinati (HTTP, hit del handler, SQL, Kafka, log, span).
- [ ] Scrubber: ogni posizione apre la riga di codice e lo stato (query, messaggio, log) di quel momento.
- [ ] Rewind da una reproduction salvata (`repro/…`), non solo dall'ultima richiesta.
- [ ] Eventi multi-servizio legati dal `traceparent`.
- [ ] Export della timeline nella reproduction condivisibile.

**Base esistente:** traceparent sulle live request, Trace Studio, Runtime Lens, Save reproduction, breakpoint Delve.
**Messaggio:** _Rewind any request through your whole system._

### Wow #2 — Ispeziona elemento → codice Go

Nel browser integrato, un clic su un elemento della pagina mostra la chiamata partita, apre il handler Go con il breakpoint e la query eseguita.

- [ ] Modalità "inspect" nel Browser Debug: clic su un elemento → richieste XHR/fetch che scatena.
- [ ] Richiesta → route → handler Go nel progetto aperto (riuso del collegamento route → handler).
- [ ] "Break on this click": breakpoint sul handler e sessione Delve pronta prima del clic successivo.
- [ ] Pannello unico: elemento DOM, richiesta, handler, SQL e log della stessa azione.

**Base esistente:** debug via CDP, Live Development Session, route → handler, Code → API.
**Messaggio:** _Click the UI, land on the Go line that answers it._

### Wow #3 — Stacca il backend in un clic

Dal traffico registrato dall'Interceptor, adOmnia genera mock server, OpenAPI, collection e test; passando l'environment a "Mock" il frontend continua a funzionare senza backend.

- [ ] Sessione di cattura nel Proxy con selezione degli endpoint da tenere.
- [ ] Generazione in un passo: mock (path parametrici), OpenAPI, collection, test di regressione.
- [ ] Environment/fase "Mock" creato in automatico con `base_url` sul mock (matrice degli environment).
- [ ] Rimozione dei segreti e dei dati personali dai payload generati.
- [ ] Demo verificata: backend spento, frontend funzionante.

**Base esistente:** Interceptor, Mock Control Room, import/export OpenAPI, fasi e matrice environment.
**Messaggio:** _Unplug the backend. Nothing breaks._

### Wow #4 — Collaudo contro Produzione dal vivo

La stessa richiesta parte in parallelo verso due fasi; si vedono diff semantico del JSON, header e tempi, e a richiesta il diff degli schemi DB delle due fasi.

- [ ] Azione "Compare stages" sulla richiesta: scelta di due environment della matrice, invio in parallelo.
- [ ] Diff semantico del JSON (campi mancanti, tipi diversi, valori) e diff di status, header e tempi.
- [ ] Diff dello schema DB tra due connessioni risolte con environment diversi.
- [ ] Ignora campi volatili (id, timestamp) configurabili e salvati con la collection.
- [ ] Salva il confronto come asserzione o test di regressione.

**Base esistente:** matrice e fasi degli environment, `{{VAR}}` in tutti i moduli, Database Studio, diff JSON.
**Messaggio:** _"Works in test, fails in prod?" — answered in three seconds._

### Wow #5 — Mappa dei servizi che si accende

Premendo Send, sulla Service Map si vede la richiesta viaggiare tra servizi, topic e database con i tempi sulle frecce; il nodo che fallisce diventa rosso e apre il codice.

- [ ] Animazione degli span in arrivo sulla Service Map, in ordine e con durata.
- [ ] Tempi e errori sulle frecce; nodo in errore evidenziato.
- [ ] Clic su nodo o freccia → codice del servizio (Architecture Explorer / handler).
- [ ] Modalità "demo": replay animato di una trace salvata, esportabile come GIF o video per il README.

**Base esistente:** Service Map, ricevitore OTLP locale, Trace Studio, Architecture Explorer.
**Messaggio:** _Watch your request travel through your system._

## §53 · Roadmap consigliata

### Phase 1 — “Real IDE”

#### Exit criteria

- [ ] Posso lavorare una giornata senza aprire un secondo IDE per funzioni base. — *Parziale: Funzioni base presenti; resta la verifica manuale M1-M31 in todo-ide.md.*

### Phase 2 — “Best Go Workflow”

- [ ] Benchmark Studio. — *Parziale: Gutter ▶, benchmem, confronto, storico ed export CSV; manca profiling.*
- [ ] Dependency Studio. — *Parziale: Dependency Graph (albero diretto → transitivo, versioni duplicate, licenze, peso su disco, unused/indirect, update e govulncheck); manca l'impatto sulla dimensione del binario.*

#### Exit criteria

- [ ] Un bug concorrente è più facile da capire in gO che dal terminale. — *Parziale: Concurrency View con diagnosi e race card; nessuna misura di usabilità.*
- [ ] Un profiling session porta dal dato alla riga di codice in pochi click.
- [ ] Benchmark prima/dopo sono leggibili senza tool esterni. — *Parziale: Confronto con variazione percentuale e storico; manca il confronto fra commit.*

### Phase 3 — “adOmnia Connected”

- [ ] Kafka integration. — *Parziale: CodeLens, topic nell'Architecture Explorer con formato dei messaggi, Debug consumer, replay e fixture; mancano schema registry e contratti.*
- [ ] DB integration. — *Parziale: CodeLens query, SQL capture proxy e Database Studio; mancano durate e schema.*

#### Exit criteria


### Phase 4 — “Runtime-Aware IDE”

- [ ] Distributed Request Debugger. — *Parziale: servizio singolo completo; multi-servizio solo via trace e log correlati.*
- [ ] Runtime architecture.
- [ ] Reproduction Studio. — *Parziale: Save reproduction scrive cartella con request, test di regressione, SQL e fixture Kafka senza segreti; manca il confronto tra sessioni.*
- [ ] Change Impact Analysis.

#### Exit criteria

- [ ] Una richiesta può essere seguita dall'ingresso API al DB/broker. — *Parziale: Vale per un servizio (Timeline con SQL, Kafka, log, breakpoint); manca il multi-servizio.*
- [ ] Ogni passaggio rilevante è navigabile verso il codice. — *Parziale: Frame, handler e breakpoint apribili in Go Studio; SQL, Kafka e log solo verso i rispettivi tool.*
- [ ] Un cambiamento mostra quali parti del sistema può impattare.

### Phase 5 — “2027 Intelligence”

- [ ] Semantic Workspace Graph.
- [ ] Runtime-aware AI.
- [ ] AI debugging.
- [ ] Architectural drift.
- [ ] Smart regression tests. — *Parziale: Solo lo starter di test per i race; nessuna generazione intelligente.*
- [ ] Performance regression intelligence.
- [ ] Automatic reproducer.
- [ ] Multi-service refactoring assistance.

#### Exit criteria

- [ ] L'AI usa informazioni reali del workspace e del runtime. — *Parziale: Usa file, diagnostiche e package locali; nessun dato runtime.*
- [ ] L'AI non è una semplice chat. — *Parziale: Fix with AI e Copilot inline oltre alla chat; nessun uso del contesto runtime.*
- [ ] Le modifiche sono sempre previewabili. — *Parziale: Diff nei refactor e nel Fix with AI; non è universale.*
- [ ] Il sistema può spiegare perché suggerisce una correzione.

## §58 · KPI tecnici utili

- [ ] Time to first usable editor.
- [ ] Time to first diagnostics.
- [ ] Time to first completion.
- [ ] Workspace indexing time.
- [ ] Memory usage.
- [ ] CPU idle usage.
- [ ] Search latency.
- [ ] Go-to-definition latency.
- [ ] Debug startup latency.
- [ ] Test discovery latency.
- [ ] Large repo performance.
- [ ] Crash-free sessions.
- [ ] gopls restart frequency. — *Parziale: Contatore Restarts per sessione e limite maxCrashRestarts in internal/goide/lsp.go; nessuna metrica aggregata.*
- [ ] Delve failure rate.

## §59 · KPI di prodotto

- [ ] % utenti che usano gO senza aprire altro IDE.
- [ ] % sessioni con Run.
- [ ] % sessioni con Debug.
- [ ] % sessioni con Test.
- [ ] % utenti che usano Code → API.
- [ ] % utenti che usano Code → DB.
- [ ] % utenti che usano Code → Kafka.
- [ ] % utenti che usano Concurrency View.
- [ ] % utenti che usano Runtime Lens.
- [ ] % utenti che usano Distributed Debugger.
- [ ] % bug riprodotti tramite Reproduction Studio.
- [ ] Tempo medio code → running.
- [ ] Tempo medio error → relevant source.
- [ ] Tempo medio request → root cause.
