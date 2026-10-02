# gO Studio 2027 — Lavoro aperto per priorità

> **Visione:** non costruire semplicemente “un IDE Go dentro adOmnia”, ma un ambiente di sviluppo Go completo in cui **codice, runtime, API, database, broker, log, trace, profiler e Git sono collegati tra loro**.
>
> **North Star:** _Write the service. Run it. Call it. Debug it. Inspect its database, messages, logs and runtime — without leaving the workspace._
>
> **Principio chiave:** **From code to runtime, everything is connected.**

Questo file contiene **solo le voci ancora aperte**, in ordine di priorità per un IDE Go di prima fascia. Il 2026-10-01 ogni voce è stata
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
| **P0** | Fondamenta: un IDE di cui fidarsi tutto il giorno | 39 | 14 |
| **P1** | Workflow Go migliore di GoLand | 122 | 24 |
| **P2** | Codice ↔ runtime: la differenza adOmnia | 219 | 54 |
| **P3** | Remote ed estensibilità | 29 | 3 |
| **P4** | AI e intelligenza del workspace | 178 | 19 |
| **Riferimento** | Obiettivi, qualità, roadmap e KPI | 152 | 57 |

---

# P0 — Fondamenta: un IDE di cui fidarsi tutto il giorno

_Affidabilità, velocità su repo grandi e PC aziendali, debug/test/Git completi. Finché manca qualcosa qui, l'utente apre un altro IDE._

## §62 · Disaster Recovery & Crash Recovery

> gO Studio non deve perdere il lavoro non salvato se adOmnia, WebView2, un processo Go o il sistema operativo si chiudono in modo anomalo. Git protegge il codice salvato; il Disaster Recovery protegge il lavoro ancora presente solo nell’editor.

### Test obbligatori

- [ ] Crash con almeno 10 file dirty → recovery completo e UI responsiva. — *Parziale: recovery completo: 10 buffer su due workspace sopravvivono al kill reale (`TestKillDuringSnapshotWritesKeepsEveryBuffer`). UI: snapshot debounced e asincrone via IPC, costo per snapshot limitato al workspace corrente; manca solo la misura a mano nell'app.*
- [ ] Verifica Windows, macOS e Linux. — *Parziale: test DR in CI su tutti e tre (`build.yml`: Linux in Checks, step "Go Studio disaster recovery" nei job Windows e macOS); verde in locale su Windows, da spuntare al primo run CI verde.*

## §3 · gopls Integration

- [ ] Gestione repository grandi. — *gopls esclude `node_modules`; manca una misura su monorepo grandi → §4.*

## §4 · Workspace e Project Model

### Multi-module

- [ ] Vista module dependency. — *le dipendenze di un modulo ci sono (Module Dependencies); il grafo tra moduli → §19.*
- [ ] Supporto monorepo. — *funziona (multi-modulo, go.work); manca una misura delle prestazioni su monorepo grandi.*
- [ ] Project graph. — *→ §15 Architecture Explorer.*

## §50 · Privacy / Local-first

- [ ] Per-project AI permissions. — *Parziale: Per-progetto solo .adomnia/aiignore per Copilot (internal/copilot/ignore.go); nessun permesso AI per progetto per gli altri provider.*
- [ ] Telemetry opt-in.
- [ ] Clear network activity panel.
- [ ] Offline mode.
- [ ] Export privacy settings.

## §48 · Enterprise — rete aziendale e toolchain

- [ ] Corporate proxy. — *Parziale: GOPROXY configurabile per toolchain e proxy Copilot; non c'è un proxy globale unico.*
- [ ] Private module repositories. — *Parziale: Campi GOPRIVATE/GONOPROXY/GONOSUMDB in GoStudioToolchainConfig.tsx; manca la gestione credenziali dei repo privati.*
- [ ] GOPRIVATE UX. — *Parziale: Campo GOPRIVATE con placeholder in GoStudioToolchainConfig.tsx; nessuna guida o validazione specifica.*
- [ ] Custom CA certificates. — *Parziale: CA bundle PEM solo per Copilot (NODE_EXTRA_CA_CERTS); non per toolchain Go o resto di Go Studio.*
- [ ] Offline mode.
- [ ] Air-gapped mode.
- [ ] Internal artifact registry.
- [ ] Corporate Git support.
- [ ] Audit-friendly settings export.

## §7 · Debugger Go con Delve

### Base

- [ ] Set next statement dove supportato. — *non supportato da Delve via DAP (niente `goto`): resta aperto finché Delve non lo offre*

### Go-specific

- [ ] Goroutine creation stack. — *Parziale: La sessione Debug mostra "Started in" (funzione di avvio) in GoStudioDebugSession.tsx; manca lo stack dell'istruzione go che ha creato la goroutine.*
- [ ] Deferred call inspector. — *Parziale: goStudioDeferredCalls.ts + GoStudioDebugSession.tsx elencano dal sorgente i defer candidati; mancano l'elenco e l'ordine runtime dei defer davvero pendenti (Delve non li espone).*

## §10 · Test Explorer

### Coverage

- [ ] Branch-like insights dove deducibili. — *Parziale: goStudioCoverage.ts marca nel gutter le righe 'partial' (coperte in parte); non esiste un'analisi dei rami né un pannello di insight dedicato.*
- [ ] Coverage diff rispetto a branch base.
- [ ] Coverage per PR.

### Flaky Test Detector

- [ ] Concurrency correlation.
- [ ] Flaky history.
- [ ] Possibile causa.
- [ ] Generazione scenario riproducibile. — *Parziale: il seed di `-shuffle` si riesegue dal pannello Tests (stesso ordine, stesse ripetizioni); manca uno scenario esportabile (comando/test minimo).*

## §22 · Git Integration

### IDE integration

- [ ] Changed APIs. — *Parziale: i simboli esportati aggiunti/modificati/rimossi sono contati nel dialog di commit (VCSChangedSymbols); mancano endpoint HTTP/gRPC cambiati e breaking change.*
- [ ] Changed DB interactions.
- [ ] Changed broker interactions.

## §21 · Static Analysis

- [ ] Custom linter support. — *Parziale: ConfigureLinter accetta un binario custom per sessione, ma solo golangci-lint o staticcheck, non linter arbitrari.*
- [ ] Per-project linter settings. — *Parziale: Rileva .golangci.yml/staticcheck.conf del progetto; nessuna UI per le impostazioni del linter del progetto.*
- [ ] Baseline.
- [ ] Quality panel.
- [ ] Technical debt trend.

## §2 · Editor Core

### Refactoring

- [ ] Move symbol. — *oggi Move to New File (gopls); spostare un simbolo in un altro package non è ancora supportato da gopls.*

---

# P1 — Workflow Go migliore di GoLand

_Visualizzare ciò che oggi finisce nel terminale: profiler, sicurezza, benchmark, fuzzing, analisi statica Go-specifica._

## §13 · Performance Studio

### Profiler

- [ ] CPU profile. — *Parziale: runconfig_params.go aggiunge -cpuprofile=cpu.pprof alle configurazioni di test (menu in GoStudioRunParameters.tsx); scrive solo il file, niente analisi o vista.*
- [ ] Heap profile. — *Parziale: -memprofile=mem.pprof per le config di test (runconfig_params.go); solo cattura su file, nessun parsing né vista in app.*
- [ ] Allocations profile. — *Parziale: mem.pprof da -memprofile contiene anche i campioni alloc_*, ma è solo cattura; manca una vista separata delle allocazioni.*
- [ ] Goroutine profile.
- [ ] Mutex profile. — *Parziale: -mutexprofile=mutex.pprof selezionabile nelle config di test (runconfig_params.go); solo file, nessuna visualizzazione.*
- [ ] Block profile. — *Parziale: -blockprofile=block.pprof selezionabile nelle config di test (runconfig_params.go); solo file, nessuna visualizzazione.*
- [ ] Thread creation profile dove disponibile.
- [ ] `pprof` integration. — *Parziale: Solo i flag go test che scrivono *.pprof (runconfig_params.go, solo config di test); nessun parsing, nessun go tool pprof, nessun viewer.*

### Visualizzazioni

- [ ] Top functions.
- [ ] Call graph.
- [ ] Flame graph.
- [ ] Icicle view.
- [ ] Source line cost.
- [ ] Package grouping.
- [ ] Hide runtime internals.
- [ ] Diff profiles.
- [ ] Search function.
- [ ] Navigate to source.

### Go trace

- [ ] Trace capture. — *Parziale: -trace=trace.out selezionabile nelle config di test (runconfig_params.go/GoStudioRunParameters.tsx); scrive solo il file, nessun viewer né go tool trace.*
- [ ] Goroutine timeline.
- [ ] Scheduler activity.
- [ ] GC.
- [ ] Syscalls.
- [ ] Network blocking.
- [ ] Synchronization.
- [ ] Long-running goroutines.
- [ ] Runtime events.
- [ ] Navigate trace event → code.

## §20 · Security Studio

- [ ] `govulncheck`. — *Parziale: Esiste solo il toggle gopls vulncheck (lsp.go); non c'è un'esecuzione govulncheck con pannello risultati.*
- [ ] Reachable vulnerability path.
- [ ] Vulnerability severity.
- [ ] Advisory detail.
- [ ] Fixed version.
- [ ] Dependency path.
- [ ] Call path.
- [ ] Open vulnerable source call.
- [ ] Upgrade preview.
- [ ] Secret scanning. — *Parziale: SecretScannerPanel scansiona collezioni e ambienti dell'API workspace, non i sorgenti del progetto Go.*
- [ ] Dangerous filesystem permissions.
- [ ] TLS misconfiguration hints.
- [ ] Weak crypto hints.
- [ ] Insecure HTTP usage hints.
- [ ] SQL injection static hints.
- [ ] Command injection static hints.
- [ ] Path traversal hints.
- [ ] Unsafe deserialization-like patterns dove applicabili.
- [ ] Security findings suppression con motivazione.
- [ ] Baseline per non inondare legacy projects.

## §12 · Benchmark Studio

### Comparazioni

- [ ] Compare branch vs main.
- [ ] Compare commit vs commit.
- [ ] Compare before/after refactor.
- [ ] Significance indicator quando calcolabile.
- [ ] Regression threshold configurabile.

## §11 · Fuzzing Studio

- [ ] Corpus viewer.
- [ ] Crash input viewer.
- [ ] Minimized failing input.
- [ ] Replay failing case.
- [ ] Promote failing case a unit test.
- [ ] Corpus management.
- [ ] Fuzz session history.
- [ ] Parallelism controls.
- [ ] Crash deduplication.

## §8 · Concurrency View — Feature distintiva

### Diagnostica

- [ ] Worker pool saturation.

## §18 · Error Handling Intelligence

- [ ] Returned error ignored.
- [ ] Error shadowing.
- [ ] Incorrect wrapping.
- [ ] `%w` awareness.
- [ ] `errors.Is`.
- [ ] `errors.As`.
- [ ] Sentinel error navigation.
- [ ] Error type hierarchy.
- [ ] Unhandled errors.
- [ ] Lost context in returned errors.
- [ ] Panic usage analysis. — *Parziale: Solo il Panic Inspector runtime in debug (`goStudioPanicInspector.ts`, `GoStudioDebugSession.tsx`). Manca un'analisi statica dei panic.*
- [ ] Recover usage analysis.
- [ ] Nil + nil suspicious return patterns.
- [ ] Error path visualization.
- [ ] Generate contextual wrapping.

## §17 · Context Propagation Inspector

- [x] Traccia `context.Context`. — *Parziale: l'analisi statica (`goStudioContextAnalysis.ts`) segue parametri, radici e variabili derivate per file; non attraversa i confini tra package.*
- [x] Evidenzia `context.Background()` dentro call chain.
- [x] Evidenzia `context.TODO()`.
- [x] Detect cancellation chain broken.
- [x] Detect missing timeout.
- [x] Detect timeout troppo ampio configurabile. — *Soglia configurabile nel pannello (default 30s, persistita in localStorage).*
- [x] Detect context stored in struct quando sospetto.
- [x] Detect ignored cancellation.
- [x] Detect leaked cancel function.
- [x] Visual context graph. — *Parziale: grafo di propagazione testuale (nodi funzione + archi) nel pannello Context, non un grafo visuale SVG/force-directed.*
- [x] Trace ID correlation. — *Parziale: correlazione statica (`WithValue` con chiavi trace/request + letterali); nessuna correlazione runtime con trace OTLP.*

## §16 · Interface Explorer

- [ ] Lista interface.
- [ ] Lista implementazioni. — *Parziale: I marker I↓/I↑ e il popup elencano le implementazioni del singolo simbolo (`goStudioImplementationMarkers.ts`). Manca una lista globale.*
- [ ] Visual graph. — *Parziale: Esiste solo l'albero Type Hierarchy (`GoStudioHierarchyDialog.tsx`), non un grafo visuale.*
- [ ] “Who uses this interface?”. — *Parziale: Usages gopls e Code Vision con conteggio usi (`goStudioCodeVision.ts`). Non c'è una vista specifica per le interfacce.*
- [ ] Missing methods. — *Parziale: Il quick fix gopls "Declare missing methods" è usato in `goStudioImplementInterface.ts`. Non c'è una vista dei metodi mancanti.*
- [ ] Detect interface too broad.
- [ ] Detect interface implemented only once.
- [ ] Consumer-side interface hint non invasivo.

## §15 · Architecture Explorer

### Static architecture

- [ ] Package graph.
- [ ] Import graph.
- [ ] Call graph. — *Parziale: Esiste solo la Call Hierarchy ad albero espandibile (`GoStudioHierarchyDialog.tsx`, gopls). Manca un grafo visuale complessivo.*
- [ ] Interface implementation graph. — *Parziale: Esiste la Type Hierarchy ad albero (`GoStudioHierarchyDialog.tsx`), non un grafo visuale.*
- [ ] Module graph.
- [ ] Entry points. — *Parziale: `detectMain` in `internal/devcontext/gofile.go` rileva solo `func main` come entità service, mostrata nel Developer Context. Mancano altri entry point e una vista dedicata.*
- [ ] gRPC services. — *Parziale: Entità `grpc` da `goprotocols.go` con CodeLens verso il gRPC client. Manca una vista architettura che elenchi i servizi.*
- [ ] Kafka producers. — *Parziale: Rilevati solo i topic (`goliterals.go`), senza distinguere producer da consumer. Manca una vista architettura.*
- [ ] Kafka consumers. — *Parziale: Rilevati solo i topic (`goliterals.go`), senza distinguere producer da consumer. Manca una vista architettura.*
- [ ] DB repositories.
- [ ] Scheduled jobs.
- [ ] CLI commands.

### UX

- [ ] Clic nodo → codice. — *Parziale: Nelle gerarchie call/type il clic sul nodo apre il codice (`navigateToLocation`). Non esiste un architecture graph con nodi.*
- [ ] Clic service → service workspace. — *Parziale: Il dialog Project Services apre Docker Lab, Database Studio o Broker Studio (`goStudioIntegrations.ts`). Manca un service workspace unico.*
- [ ] Clic trace → distributed debugger.

## §43 · Documentation Intelligence

- [ ] Package docs. — *Parziale: Il tool go doc mostra la documentazione di un package; non c'è una vista dedicata.*
- [ ] Missing docs hints opzionali.
- [ ] Generate docs.
- [ ] Diagram embedding.
- [ ] Architecture docs generation.
- [ ] API docs generation.
- [ ] OpenAPI generation/preview.
- [ ] Proto docs.
- [ ] Dependency report. — *Parziale: Dialog Go dependencies e go mod why/graph; nessun report.*
- [ ] ADR links.

---

# P2 — Codice ↔ runtime: la differenza adOmnia

_Il flusso North Star: dal codice alla chiamata, al debug, a DB, broker, log e trace — senza uscire dal workspace._

## §61 · North Star Experience

Lo scenario ideale da raggiungere:

- [ ] Parte l'ambiente locale. — *Parziale: Handoff verso Docker Lab con preset dei servizi; avvio manuale, non automatico.*
- [ ] Il consumer di un altro servizio riceve il messaggio.
- [ ] Il distributed debugger collega i due servizi.
- [ ] Vedo log e trace della stessa operazione. — *Parziale: Log e timeline per request; nessun trace/OTLP receiver.*
- [ ] Se qualcosa fallisce posso salvarne la riproduzione.
- [ ] Posso generare un regression test. — *Parziale: Solo lo starter di test per i race; non per request fallite.*
- [ ] Posso profilare la stessa richiesta.
- [ ] Posso confrontare performance prima/dopo il fix.

Quando questo flusso funziona bene, gO Studio non è più “un IDE aggiunto ad adOmnia”.

È il punto in cui **adOmnia diventa un ambiente di sviluppo completo per sistemi Go**.

## §24 · API Integration — REST

### Code detection

- [ ] Framework adapter estendibile.
- [ ] Individuare middleware.
- [ ] Individuare request DTO.
- [ ] Individuare response DTO.

### Azioni inline

- [ ] `MOCK`. — *Parziale: Esiste l'opener route "Add to Mock Server" (entities/openers.ts), raggiungibile da command palette; manca una lens inline sul codice.*
- [ ] `COPY CURL`.
- [ ] `OPENAPI`. — *Parziale: Route da OpenAPI come entità contratto (devcontext/contracts.go) e avviso route mancante; manca azione inline "OpenAPI" sul handler.*

### Debug integration

- [ ] Trace. — *Parziale: Esiste la tab Timeline costruita da stack dei breakpoint, SQL, messaggi e log; nessun ricevitore OTLP né span veri.*

## §27 · Database Integration

### Code intelligence

- [ ] Detect `database/sql`. — *Parziale: goliterals.go riconosce solo i nomi dei metodi (Query/Exec…) senza verificare l'import di database/sql.*
- [ ] Detect pgx. — *Parziale: Query/Exec/QueryRow riconosciuti solo per nome di metodo, nessun rilevamento dell'import pgx.*
- [ ] Detect GORM.
- [ ] Detect sqlx. — *Parziale: goliterals.go ha Queryx/Select/Get/NamedExec per nome; nessun controllo dell'import sqlx.*
- [ ] Adapter architecture per ORM/driver.
- [ ] Detect transaction.
- [ ] Detect prepared statements.

### SQL editor

- [ ] Completion.
- [ ] Schema-aware completion.
- [ ] Explain. — *Parziale: QueryEditor.tsx pulsante Explain; database.go explainQuery restituisce il piano come testo, senza vista strutturata.*
- [ ] Explain analyze.

### Code ↔ database

- [ ] Query → schema.
- [ ] Table → repository methods.
- [ ] Runtime query duration.
- [ ] Rows returned.
- [ ] Slow query detection.
- [ ] N+1-like behavior hints.
- [ ] Transaction duration.
- [ ] Lock/wait hints quando disponibili.
- [ ] DB error → source line.

## §26 · Kafka / Broker Integration

### Detection

- [ ] Detect producer. — *Parziale: goliterals.go rileva topic da ProducerMessage/Writer ma l'entità topic non ha il ruolo producer.*
- [ ] Detect consumer. — *Parziale: goliterals.go rileva ConsumeTopics e ReaderConfig.Topic ma non marca il ruolo consumer.*
- [ ] Detect consumer group.
- [ ] Detect serializers.
- [ ] Detect retry topic.
- [ ] Detect dead-letter topic.

### Actions

- [ ] Replay message. — *Parziale: "Open in composer" riapre il messaggio nel producer; non è un replay a un clic.*
- [ ] Save message fixture.
- [ ] Debug consumer.
- [ ] Debug producer.

### Code ↔ broker

- [ ] Topic → producer functions.
- [ ] Topic → consumer functions.
- [ ] Producer → topic.
- [ ] Consumer → topic.
- [ ] Message schema → Go struct.
- [ ] Message → breakpoint.
- [ ] Correlation ID propagation. — *Parziale: devsession/kafkawatch.go lega i messaggi alla request se un header porta l'id; la propagazione dell'id spetta al servizio.*

## §25 · gRPC Integration

- [ ] `.proto` support.
- [ ] Proto syntax highlighting.
- [ ] Proto navigation.
- [ ] Generate Go code.
- [ ] Link proto method → Go handler. — *Parziale: devcontext/goprotocols.go rileva solo RegisterXServer a livello di servizio; manca il link metodo proto → funzione Go.*
- [ ] Debug method.
- [ ] Streaming support. — *Parziale: Server e client streaming supportati; bidi invia tutti i messaggi in batch e poi CloseSend, non interattivo.*
- [ ] Client streaming. — *Parziale: GrpcPanel.tsx accetta una lista di messaggi inviata in blocco; non si inviano messaggi in modo interattivo.*
- [ ] Bidirectional streaming. — *Parziale: Badge Bidi e invio batch di più messaggi con ricezione dello stream; manca scambio interattivo duplex.*

## §28 · WebSocket Integration

- [ ] Binary payload viewer. — *Parziale: I frame binari sono mostrati come "[binary base64]"; nessuna vista hex/ASCII.*
- [ ] Debug handler.
- [ ] Connection → goroutine.
- [ ] Connection → trace/log.

## §29 · Docker e Containers

- [ ] Restart. — *Parziale: Il tasto Rerun del pannello Run rilancia build e container; non esiste un `docker restart` dedicato né un'azione di riavvio per i container di Docker Lab.*
- [ ] Exec shell.
- [ ] Container health. — *Parziale: Docker Lab elenca stato e Status dei container (LabStatus) e genera healthcheck nei preset; manca una vista health dedicata per i container di Go Studio.*
- [ ] Attach debugger.
- [ ] Run tests in container.
- [ ] Run profiler in container.
- [ ] Container → local service mapping.
- [ ] Dev container support.
- [ ] BuildKit awareness.

## §39 · Smart Local Development Environment

- [ ] Detect ports. — *Parziale: devcontext/compose.go legge le porte dei servizi compose e le run config hanno il campo port; nessun rilevamento globale.*
- [ ] Detect migrations.
- [ ] Detect seed data.

### One-click environment

- [ ] `Start workspace`.
- [ ] Start required containers. — *Parziale: Compose Up per servizio dal gutter e preset Docker Lab; nessun avvio automatico dei container richiesti.*
- [ ] Run migrations.
- [ ] Seed DB.
- [ ] Start services.
- [ ] Wait health checks.
- [ ] Open API. — *Parziale: CodeLens Open in API Client sugli handler e opener route in palette; non fa parte di un flusso Start workspace.*
- [ ] Open logs. — *Parziale: ServiceLogsDrawer apre i log della sessione nel Log Inspector; non c'è un flusso unico.*
- [ ] Stop workspace.
- [ ] Clean workspace.

## §40 · Logs Studio

- [ ] Filter goroutine. — *Parziale: normalize.ts mappa 'goroutine' al campo thread; nessun filtro dedicato.*
- [ ] Group repeated logs. — *Parziale: analyze.ts raggruppa per errorFingerprint e dedupe.ts elimina duplicati; non raggruppa i log ripetuti in generale.*

## §41 · Trace Studio

- [ ] OpenTelemetry compatibility. — *Parziale: ObservabilityPanel.tsx legge trace_id/span_id/otel.* dai log; manca un receiver OTLP.*
- [ ] Local traces. — *Parziale: Trace ricostruite dai log; nessuna raccolta di trace vere.*
- [ ] Trace tree. — *Parziale: Span in lista con barre; waterfall.ts ha parentId ma non c'è un albero parent/child.*
- [ ] Service colors/theme coherent.
- [ ] DB spans.
- [ ] HTTP spans. — *Parziale: Le span riportano http.method/url/status; nessuna vista specifica degli HTTP span.*
- [ ] gRPC spans.
- [ ] Kafka spans.
- [ ] Custom spans.
- [ ] Span → source.
- [ ] Trace → distributed debugger.
- [ ] Compare traces.

## §42 · Config & Environment Intelligence

- [ ] Detect config keys.
- [ ] Show usages. — *Parziale: L'opener envvar mostra valore e file:riga della fonte; non l'elenco completo degli usi.*
- [ ] Missing env warning.
- [ ] Undefined config warning.
- [ ] Unused config warning.
- [ ] Environment profiles.
- [ ] Config diff.
- [ ] Dev/test/staging profiles.

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

- [ ] Seleziono handler → API context. — *Parziale: CodeLens "Open in API Client" sulle route HTTP; manca un context panel contestuale alla selezione.*
- [ ] Seleziono SQL → DB context. — *Parziale: CodeLens e hand-off verso Database Studio; nessun context panel che reagisce alla selezione.*
- [ ] Seleziono Kafka → broker context. — *Parziale: CodeLens topic/gRPC e hand-off a Broker Studio; manca il context panel.*
- [ ] Seleziono test → test context.
- [ ] Seleziono goroutine → concurrency context.
- [ ] Seleziono errore → debugging context. — *Parziale: Ispettori debug per error chain e panic solo nel pannello debug; nessun context panel.*
- [ ] Seleziono dependency → module/security context.
- [ ] Seleziono interface → implementation context. — *Parziale: Marker di implementazione e dialog Hierarchy; manca il context panel dedicato.*
- [ ] Seleziono trace → runtime context.
- [ ] Panel collassabile.
- [ ] Nessuna UI sovraccarica.

## §31 · Service Map

### Static

- [ ] Identificare servizi. — *Parziale: devcontext rileva entità service da compose e da go.mod e il ServiceView mostra il singolo servizio; non esiste una mappa dei servizi.*
- [ ] API edges. — *Parziale: devcontext rileva le route HTTP del servizio e il ServiceView le elenca; mancano archi tra servizi e una vista a grafo.*
- [ ] gRPC edges. — *Parziale: devcontext rileva le registrazioni gRPC (goprotocols.go); non sono mostrate come archi in una mappa.*
- [ ] Kafka edges. — *Parziale: Il ServiceView mostra i topic rilevati dal codice e permette il Kafka watch; non c'è un grafo con archi producer/consumer.*
- [ ] DB edges. — *Parziale: Il ServiceView elenca i datasource rilevati con la cattura SQL; non ci sono archi in una mappa.*
- [ ] Redis edges.
- [ ] WebSocket edges. — *Parziale: devcontext rileva server e client WebSocket (goprotocols.go); non sono mostrati come archi.*
- [ ] External HTTP edges.

### Runtime

- [ ] Request rate.
- [ ] Error rate.
- [ ] Latency.
- [ ] Active connections.
- [ ] Kafka lag.
- [ ] DB latency.
- [ ] Downstream failures.
- [ ] Retry activity.

### Navigazione

- [ ] Endpoint → handler. — *Parziale: Le route portano handler, file e riga e RequestContextView mostra la sezione Handler; manca il salto al handler da una mappa.*
- [ ] Kafka edge → topic.
- [ ] DB edge → datasource.
- [ ] Trace edge → source.
- [ ] Error edge → logs.
- [ ] Open full architecture.

## §32 · Distributed Request Debugger — Killer Feature

> Debuggare una richiesta attraverso più componenti, non solo una funzione.

### Capture

- [ ] Supportare trace ID.
- [ ] Collegare gRPC.
- [ ] Collegare goroutines.
- [ ] Collegare spans.
- [ ] Collegare retries.

### Timeline

- [ ] Timeline unica. — *Parziale: RequestTimeline unisce invio, frame, breakpoint, SQL, messaggi, log di errore e risposta; solo per il servizio locale, senza confini fra servizi.*
- [ ] Service boundaries.
- [ ] Network duration.
- [ ] Handler duration.
- [ ] DB duration.
- [ ] Broker delay.
- [ ] Retry delay.
- [ ] Error point. — *Parziale: La timeline mostra log di errore e la risposta fallita in rosso; non c'è un punto d'errore dedicato che lo isoli.*
- [ ] Parallel branches.
- [ ] Async branches.

### Source navigation

- [ ] Click span → funzione. — *Parziale: I frame dello stack in timeline aprono il file in Go Studio; non esistono span OTLP, solo frame di breakpoint.*
- [ ] Click Kafka → producer/consumer. — *Parziale: Il messaggio apre il topic in Broker Studio; non porta al codice producer o consumer.*
- [ ] Click panic → stack.
- [ ] Click retry → policy.
- [ ] Click external call → client code.

### Debug workflow

- [ ] Replay broker message.
- [ ] Re-run with race detector.
- [ ] Re-run with profiler.
- [ ] Save session.
- [ ] Compare sessions.

## §14 · Runtime Lens

> Mostrare informazioni runtime direttamente sopra o accanto al codice.

- [ ] Call count.
- [ ] Average duration.
- [ ] P50.
- [ ] P95.
- [ ] P99.
- [ ] Error count.
- [ ] Allocation estimate.
- [ ] CPU cost.
- [ ] Last execution.
- [ ] Hot path indicator.
- [ ] Slow path indicator.
- [ ] Runtime values opzionali.
- [ ] Feature disattivabile.
- [ ] Sampling per ridurre overhead.
- [ ] Privacy/local-only.

### Esempi

- [ ] Handler HTTP → request count.
- [ ] DB call → duration.
- [ ] Kafka publish → message count.
- [ ] Kafka consume → throughput.
- [ ] gRPC call → latency.
- [ ] Retry loop → retry count.
- [ ] Cache access → hit/miss.
- [ ] Function → allocations.
- [ ] Goroutine → lifetime.

## §33 · Reproduction Studio

> Trasformare un bug osservato in uno scenario ripetibile.

- [ ] Capture request.
- [ ] Capture headers.
- [ ] Capture body.
- [ ] Capture env references.
- [ ] Capture relevant DB state.
- [ ] Capture broker message.
- [ ] Capture config.
- [ ] Capture feature flags.
- [ ] Capture stack.
- [ ] Capture logs.
- [ ] Capture trace.

### Output

- [ ] Generate unit test.
- [ ] Generate integration test.
- [ ] Generate HTTP request fixture.
- [ ] Generate Kafka fixture.
- [ ] Generate SQL fixture.
- [ ] Generate env template.
- [ ] Generate Docker/Compose reproduction where useful.
- [ ] Generate README reproduction steps.
- [ ] Strip secrets automatically.
- [ ] Mark non-deterministic dependencies.

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

## §30 · Kubernetes / Remote Development

- [ ] Kubernetes contexts.
- [ ] Namespace selector.
- [ ] Pod viewer.
- [ ] Logs. — *Parziale: Il Log Inspector esegue `kubectl logs -f` con context/namespace/pod/container digitati a mano (internal/logstream); non è in Go Studio e non c'è un pod viewer.*
- [ ] Exec.
- [ ] Port forward.
- [ ] Copy file.
- [ ] Deployment overview.
- [ ] Service overview.
- [ ] ConfigMap.
- [ ] Secret metadata senza mostrare valori di default.
- [ ] Attach remote debugger.
- [ ] Remote profile.
- [ ] Remote trace.
- [ ] Remote logs correlated to source.
- [ ] SSH development.
- [ ] WSL development.
- [ ] Container development.

## §47 · Plugin / Extension Architecture

- [ ] Public extension API. — *Parziale: Contratto v1 con eventi Go Studio read-only (internal/goide/integrations.go) e host API del sandbox; nessuna API per comandi o estensioni dell'IDE.*
- [ ] Language extension points.
- [ ] Framework adapters.
- [ ] Broker adapters.
- [ ] DB adapters.
- [ ] Analyzer extensions.
- [ ] Custom code actions.
- [ ] Custom templates.
- [ ] WASM plugins.
- [ ] Signed plugin support.
- [ ] Plugin developer mode. — *Parziale: PluginDevTools.tsx: host functions, eventi, stato sandbox ed esecuzione manuale; mancano hot reload e log dedicati.*

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

- [ ] L'AI non deve conoscere solo il file aperto. — *Parziale: Fix with AI invia il file con l'errore più fino a 3 file del package locale citato; non c'è semantic graph né contesto di workspace.*
- [ ] Deve poter usare il semantic graph del workspace.
- [ ] Deve conoscere symbol references.
- [ ] Deve conoscere Git diff.
- [ ] Deve conoscere test results.
- [ ] Deve conoscere coverage.
- [ ] Deve conoscere compiler errors. — *Parziale: Fix with AI passa l'errore e gli altri problemi del file; mancano gli errori di build completi e le altre fonti.*
- [ ] Deve conoscere profiler.
- [ ] Deve conoscere runtime traces.
- [ ] Deve conoscere API.
- [ ] Deve conoscere DB schema.
- [ ] Deve conoscere broker metadata.
- [ ] Deve conoscere logs.
- [ ] Deve conoscere architecture graph.

### Azioni contestuali

- [ ] Explain code.
- [ ] Explain error.
- [ ] Generate tests.
- [ ] Generate benchmark.
- [ ] Generate fuzz target.
- [ ] Find race risks.
- [ ] Find goroutine leaks.
- [ ] Find allocation hotspots.
- [ ] Find missing context propagation.
- [ ] Improve error handling.
- [ ] Explain dependency.
- [ ] Explain architecture.
- [ ] Generate docs.
- [ ] Generate migration.
- [ ] Generate mock.
- [ ] Generate API call.
- [ ] Generate SQL query.
- [ ] Generate Kafka message.

## §35 · AI Debugging

- [ ] Panic analysis. — *Parziale: Panic inspector nel debugger rileva il panic e il frame di origine; nessuna analisi AI.*
- [ ] Test failure analysis.
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

- [ ] Concurrency view. — *Parziale: `GoStudioConcurrencyView.tsx` e `GoStudioGoroutineTree.tsx`, sezione 8 a 36/37. Manca la worker pool saturation.*
- [ ] Profiler integrato. — *Parziale: Solo il profiling dei test (cpu/mem/block/mutex/trace) in `runconfig_params.go`. Manca un viewer pprof.*
- [ ] Benchmark explorer. — *Parziale: Esecuzione dal gutter, confronto e storico in `goStudioBenchmarks*.ts` e nel pannello Tests. Sezione 12 a 15/20.*
- [ ] Fuzzing UX. — *Parziale: Solo run con `-fuzztime` dal gutter e generazione del fuzz test. Mancano corpus, crash e minimizzazione.*
- [ ] Dependency intelligence. — *Parziale: Dialog `GoStudioDependencies.tsx` con go get/tidy, mod why/graph. Mancano grafo tra moduli e analisi di aggiornamenti e licenze.*
- [ ] Security. — *Parziale: Solo diagnostica `Vulncheck` di gopls. Non c'è uno Security Studio dedicato.*
- [ ] Interface explorer. — *Parziale: Implementation markers, Implement Interface dialog e gerarchie. Manca un explorer dedicato.*
- [x] Context propagation inspector. — *Implementata l'analisi statica (`goStudioContextAnalysis.ts`) con pannello dedicato, marcatori nel gutter e soglia timeout configurabile; il runtime inspector (`goStudioContextInspector.ts`) resta per le variabili in debug. Manca la verifica manuale nell'app.*
- [ ] Runtime Lens.
- [ ] Architecture Explorer.

### P2 — Differenziazione adOmnia

- [ ] Distributed Request Debugger. — *Parziale: Il caso a servizio singolo è coperto da `internal/devsession` e dalla Debug Request. Manca il multi-servizio.*
- [ ] Service Map runtime-aware. — *§31: va progettato prima.*
- [ ] Reproduction Studio. — *§33: va progettato prima.*
- [ ] Cross-service debugging. — *dipende dal Distributed Request Debugger (§32).*
- [ ] Unified local environment. — *Parziale: Project Services e Docker Lab (`GoStudioProjectServicesDialog.tsx`). Manca la vista unica.*

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

- [ ] **Runtime Lens**.
- [ ] **Distributed Request Debugger**.
- [ ] **Architecture Explorer**. — *Parziale: GoStudioProjectOverview.tsx e GoStudioProjectServicesDialog.tsx mostrano servizi e datasource; manca una vista architetturale esplorabile.*
- [ ] **Reproduction Studio**.
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

- [ ] Performance inline.
- [ ] Runtime counts.
- [ ] Errors inline.
- [ ] DB timings.
- [ ] Broker timings.
- [ ] Hot paths.

**Messaggio:** _Your code editor knows what happened at runtime._

### Killer #3 — Code → Everything

- [ ] Trace → source.
- [ ] Log → source. — *Parziale: Log Inspector risolve gli stack frame verso il sorgente; manca il link per ogni riga di log.*

**Messaggio:** _Every integration is one click away from the code that implements it._

### Killer #4 — Distributed Request Debugger

- [ ] HTTP. — *Parziale: Request run con log, SQL e Kafka legati da id (devsession/requests.go), solo servizio singolo.*
- [ ] gRPC.
- [ ] Kafka. — *Parziale: Kafka watch dei messaggi per request (devsession/kafkawatch.go), solo plaintext e singolo servizio.*
- [ ] DB. — *Parziale: Query SQL da log o proxy associate alla request, solo servizio singolo, senza durate.*
- [ ] Logs. — *Parziale: Log del servizio legati alla request per id o tempo, solo servizio singolo.*
- [ ] Trace.

**Messaggio:** _Debug the request, not just the process._

### Killer #5 — Reproduction Studio

- [ ] Capture. — *Parziale: RequestRun in memoria con hit, log, query e messaggi; niente cattura persistente.*
- [ ] Replay. — *Parziale: Replay copia la tab e rinvia la request; niente replay di sessioni salvate o messaggi broker.*
- [ ] Generate regression test. — *Parziale: Solo "Copy regression test starter" per i race; niente generazione da request fallite.*
- [ ] Remove secrets. — *Parziale: Header sensibili mascherati nella UI; niente rimozione in uno scenario esportabile.*
- [ ] Share reproducible scenario.

**Messaggio:** _Turn a production-like failure into a reproducible test._

## §53 · Roadmap consigliata

### Phase 1 — “Real IDE”

#### Exit criteria

- [ ] Posso lavorare una giornata senza aprire un secondo IDE per funzioni base. — *Parziale: Funzioni base presenti; resta la verifica manuale M1-M31 in todo-ide.md.*

### Phase 2 — “Best Go Workflow”

- [ ] Concurrency View. — *Parziale: Vista implementata; manca la saturazione dei worker pool.*
- [ ] Benchmark Studio. — *Parziale: Gutter ▶, benchmem, confronto, storico ed export CSV; manca profiling.*
- [ ] Fuzz Studio. — *Parziale: Target con ▶ e run limitato a 30s; mancano corpus e crash viewer.*
- [ ] Performance Studio.
- [ ] Go trace.
- [ ] Interface Explorer. — *Parziale: Implement Interface, implementation markers e type hierarchy; manca una vista dedicata.*
- [ ] Context Inspector. — *Parziale: Inspector runtime di context.Context in debug e analisi statica della propagazione (`goStudioContextAnalysis.ts`) con pannello e gutter marker; manca la verifica manuale.*
- [ ] Error intelligence. — *Parziale: Error chain viewer e panic inspector; manca l'analisi statica.*
- [ ] Security. — *Parziale: Vulnerability Diagnostics opt-in via gopls; nessuna Security Studio o govulncheck dedicato.*
- [ ] Dependency Studio. — *Parziale: GoStudioDependencies.tsx con azioni go.mod; mancano grafo, impatto e dimensione binario.*

#### Exit criteria

- [ ] Un bug concorrente è più facile da capire in gO che dal terminale. — *Parziale: Concurrency View con diagnosi e race card; nessuna misura di usabilità.*
- [ ] Un profiling session porta dal dato alla riga di codice in pochi click.
- [ ] Benchmark prima/dopo sono leggibili senza tool esterni. — *Parziale: Confronto con variazione percentuale e storico; manca il confronto fra commit.*
- [ ] Una vulnerabilità mostra il percorso reale verso il codice. — *Parziale: Solo diagnostiche vulncheck di gopls; nessun call path visualizzato.*

### Phase 3 — “adOmnia Connected”

- [ ] gRPC integration. — *Parziale: CodeLens "Call in gRPC client" con reflection; niente debug o tracing delle chiamate.*
- [ ] Kafka integration. — *Parziale: CodeLens verso Broker Studio e Kafka watch; mancano schema e contratti.*
- [ ] DB integration. — *Parziale: CodeLens query, SQL capture proxy e Database Studio; mancano durate e schema.*
- [ ] WebSocket integration. — *Parziale: CodeLens "Open in WebSocket client"; nessun tracing runtime.*
- [ ] Logs integration. — *Parziale: Service logs come sorgente live nel Log Inspector; manca la correlazione cross-servizio.*
- [ ] Service Map.
- [ ] Architecture Explorer.

#### Exit criteria

- [ ] Posso partire da un trace e arrivare al codice.

### Phase 4 — “Runtime-Aware IDE”

- [ ] Runtime Lens.
- [ ] Distributed Request Debugger. — *Parziale: Copre il servizio singolo; manca il multi-servizio.*
- [ ] Runtime architecture.
- [ ] Multi-service logs. — *Parziale: Log per sessione con filtro e Log Inspector; nessuna vista unificata multi-servizio per request.*
- [ ] Trace Studio.
- [ ] Reproduction Studio. — *Parziale: Solo Replay della request; niente cattura, salvataggio o confronto sessioni.*
- [ ] Change Impact Analysis.

#### Exit criteria

- [ ] Una richiesta può essere seguita dall'ingresso API al DB/broker. — *Parziale: Vale per un servizio (Timeline con SQL, Kafka, log, breakpoint); manca il multi-servizio.*
- [ ] Ogni passaggio rilevante è navigabile verso il codice. — *Parziale: Frame, handler e breakpoint apribili in Go Studio; SQL, Kafka e log solo verso i rispettivi tool.*
- [ ] Un errore può essere salvato e riprodotto.
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
