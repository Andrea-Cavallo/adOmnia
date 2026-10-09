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
| **P0** | Fondamenta: un IDE di cui fidarsi tutto il giorno | 0 | 0 |
| **P1** | Workflow Go migliore di GoLand | 0 | 0 |
| **P2** | Codice ↔ runtime: la differenza adOmnia | 155 | 37 |
| **P3** | Remote ed estensibilità | 9 | 1 |
| **P4** | AI e intelligenza del workspace | 150 | 18 |
| **Riferimento** | Obiettivi, qualità, roadmap e KPI | 151 | 56 |

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

- [x] Parte l'ambiente locale. — *Run → **Start Workspace** avvia una configurazione compound condivisa/pinnata "Start workspace"; se manca, apre la bozza corretta nelle Run configurations. Restano espliciti Trust e segreti runtime, nessun processo parte senza azione utente.*
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

### Debug integration

- [ ] Trace. — *Parziale: Esiste la tab Timeline costruita da stack dei breakpoint, SQL, messaggi e log; nessun ricevitore OTLP né span veri.*

## §26 · Kafka / Broker Integration

### Code ↔ broker

- [ ] Correlation ID propagation. — *Parziale: devsession/kafkawatch.go lega i messaggi alla request se un header porta l'id; la propagazione dell'id spetta al servizio.*

## §28 · WebSocket Integration

- [x] Binary payload viewer. — *L'Inspector WebSocket mostra byte in Hex/ASCII, dimensione decodificata e anteprima limitata a 4 KiB; il Base64 originale resta copiabile.*
- [ ] Debug handler.
- [ ] Connection → goroutine.
- [ ] Connection → trace/log.

## §29 · Docker e Containers

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

- [x] `Start workspace`. — *Comando dedicato nel menu Run/Search Everywhere: usa la compound "Start workspace" e raccoglie i segreti anche dalle configurazioni figlie.*
- [x] Start required containers. — *`Start Workspace` interroga il contesto locale del progetto, rileva tutti i file Compose dai servizi indicizzati, riusa o crea configurazioni Compose Up condivise e le inserisce nella compound prima dell'avvio. Se non trova Compose apre la configurazione manuale; nulla parte senza il comando utente.*
- [ ] Run migrations.
- [ ] Seed DB.
- [x] Start services. — *Lo stesso bootstrap rileva i package Go `main` dal contesto locale, riusa o crea configurazioni Package condivise con restart-on-save e le avvia nella compound insieme ai container. I segreti delle configurazioni riusate vengono richiesti prima dell'avvio.*
- [ ] Wait health checks.
- [ ] Open API. — *Parziale: CodeLens Open in API Client sugli handler e opener route in palette; non fa parte di un flusso Start workspace.*
- [ ] Open logs. — *Parziale: ServiceLogsDrawer apre i log della sessione nel Log Inspector; non c'è un flusso unico.*
- [x] Stop workspace. — *Run → Stop Workspace arresta tutte le esecuzioni attive della sessione, non soltanto quella selezionata; per Compose il backend esegue lo stop controllato dei servizi.*
- [ ] Clean workspace.

## §41 · Trace Studio

- [ ] OpenTelemetry compatibility. — *Parziale: ObservabilityPanel.tsx legge trace_id/span_id/otel.* dai log; manca un receiver OTLP.*
- [ ] Local traces. — *Parziale: Trace ricostruite dai log; nessuna raccolta di trace vere.*
- [x] Trace tree. — *La vista Observability ordina le span per parent/child con indentazione, mantenendo le barre temporali; parent assenti e cicli restano visibili come radici.*
- [ ] Service colors/theme coherent.
- [ ] DB spans.
- [ ] HTTP spans. — *Parziale: Le span riportano http.method/url/status; nessuna vista specifica degli HTTP span.*
- [ ] gRPC spans.
- [ ] Kafka spans.
- [ ] Custom spans.
- [ ] Span → source.
- [ ] Trace → distributed debugger. — *Parziale: le trace strutturate dei servizi aprono una vista multi-servizio con link al debugger per span correlati; manca la raccolta OTLP e la propagazione automatica della trace.*
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

- [ ] Supportare trace ID. — *Parziale: la vista correla span dei log strutturati da più servizi tramite trace ID; manca acquisizione OTLP e propagazione automatica.*
- [ ] Collegare gRPC.
- [ ] Collegare goroutines.
- [ ] Collegare spans. — *Parziale: parent_span_id costruisce l'albero nella vista distribuita; manca il collegamento da span OTLP acquisiti direttamente.*
- [ ] Collegare retries.

### Timeline

- [ ] Timeline unica. — *Parziale: RequestTimeline unisce invio, frame, breakpoint, SQL, messaggi, log di errore e risposta; solo per il servizio locale, senza confini fra servizi.*
- [ ] Service boundaries. — *Parziale: la vista distribuita mostra il servizio di ogni span e l'elenco dei servizi della trace; mancano confini basati su acquisizione runtime completa.*
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

- [x] Kubernetes contexts. — *Kubernetes Studio (rail Remote): `kubectl config get-contexts` letto e mostrato con il contesto corrente (internal/kube).*
- [x] Namespace selector. — *Dropdown namespace alimentato da `kubectl get namespaces` per il contesto scelto.*
- [x] Pod viewer. — *Tabella pod (ready, status, restart, età, node) da `kubectl get pods -o json`, parsing in-app.*
- [x] Logs. — *Dal pod viewer si seleziona container e si fa stream con `kubectl logs -f` (logstream riusato) nel pannello, con stop e buffer limitato.*
- [x] Exec. — *Tab Exec del pod: comando one-shot via `kubectl exec -- sh -c`, timeout 60 s, output limitato all'ultimo MB, storico delle ultime 20 run.*
- [x] Port forward. — *Da pod o service, solo su 127.0.0.1; tab Port forwards con stato live e stop; chiusi con il sidecar (internal/kube/portforward.go).*
- [x] Copy file. — *Tab Files del pod: download (salvataggio nativo) e upload fino a 16 MB via `cat`; il path arriva alla shell come `$1`, mai interpolato.*
- [x] Deployment overview. — *Tab Deployments: ready/desired, up-to-date, available, età, immagini.*
- [x] Service overview. — *Tab Services: tipo, cluster/external IP, porte, selector, port forward dall'inspector.*
- [x] ConfigMap. — *Tab ConfigMaps con inspector chiave → valore.*
- [x] Secret metadata senza mostrare valori di default. — *Tab Secrets: solo nomi delle chiavi e dimensioni; i valori sono scartati nel parser Go (test `TestParseSecretsDropsValues`).*
- [x] Attach remote debugger. — *Tab Go del pod: port forward di Delve su una porta libera di 127.0.0.1 (internal/kube, localPort 0) e attach remoto nel progetto aperto in Go Studio (useGoStudioRemoteHandoff.ts).*
- [x] Remote profile. — *Tab Go del pod: forward di pprof e CaptureLiveProfile (CPU, heap, goroutine, allocs, block, mutex); il profilo si apre selezionato nel pannello Profile.*
- [x] Remote trace. — *Nuovo CaptureLiveTrace (/debug/pprof/trace, default 5 s, validato con x/exp/trace, test con net/http/pprof reale); dal pod o da qualunque servizio su localhost, si apre nel Trace viewer.*
- [ ] Remote logs correlated to source. — *Da fare: nei log del pod rendere cliccabili i `file.go:riga` verso il progetto aperto (routeToModule open-location).*
- [x] SSH development. — *Run configuration → "Run on" host di ~/.ssh/config: run/test/build/comandi via `ssh -T -o BatchMode=yes` nella cartella remota indicata (internal/ide/remote); host SSH anche come profili terminale. Il codice non viene sincronizzato: serve lo stesso checkout sul server.*
- [x] WSL development. — *"Run on" distro WSL: percorsi tradotti (/mnt/c, \wsl.localhost), toolchain della distro, variabili via WSLENV (mai in riga di comando); Stop termina il process group remoto. Provato su Ubuntu reale.*
- [x] Container development. — *"Run on" container in esecuzione: `docker exec -i` con -e KEY (valori dall'ambiente del client) nella cartella montata; container anche come profili terminale. Limite: l'input interattivo non arriva al processo remoto (stdin fa da guardia per lo Stop).*

## §47 · Plugin / Extension Architecture

- [ ] Public extension API. — *Parziale: contratto `contributes` (commands, codeActions, analyzers, templates, languages, adapters) con validazione in internal/plugins e GetContributions; manca il consumo lato IDE (palette, editor, New Project) e l'API per estensioni dell'IDE.*
- [ ] Language extension points.
- [ ] Framework adapters.
- [ ] Broker adapters.
- [ ] DB adapters.
- [ ] Analyzer extensions.
- [ ] Custom code actions.
- [ ] Custom templates.
- [x] WASM plugins. — *Runtime WASI (wazero) in internal/plugins: modulo wasip1 senza filesystem/rete/env, stdin JSON → stdout JSON, stderr come log, sotto i limiti memoria/tempo del sandbox; il test esegue un vero modulo Go wasip1 (GOOS=wasip1 GOARCH=wasm).*
- [x] Signed plugin support. — *signature.json ed25519 su ogni file (escluso signature.json); install verifica, una chiave trusted marca il plugin trusted, e qualunque modifica dopo la firma lo disabilita (internal/plugins/signature.go).*
- [x] Plugin developer mode. — *LinkDevPlugin lega il plugin alla cartella sorgente e lo reinstalla a ogni modifica (fsnotify, debounce 300 ms) con log dedicati info/error/reload in GetPluginLogs (internal/plugins/devmode.go); PluginDevTools.tsx resta per host functions, eventi, stato sandbox ed esecuzione manuale.*

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

- [ ] Concurrency view. — *Parziale: `GoStudioConcurrencyView.tsx` e `GoStudioGoroutineTree.tsx`, sezione 8 a 36/37. Manca la worker pool saturation.*
- [ ] Profiler integrato. — *Parziale: profiling dei test (cpu/mem/block/mutex/trace) in `runconfig_params.go` e viewer pprof in-app (`internal/goide/pprof.go`, `GoStudioProfilePanel.tsx`). Mancano cattura per goroutine/threadcreate, call graph visuale, heatmap per riga e trace viewer.*
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
- [ ] Context Inspector. — *Parziale: inspector runtime, analisi per file e per progetto (tipata, fra package) con grafo; manca la verifica manuale.*
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
