# adOmnia | Piano di Refactor Performance — checklist operativa

> Sorgente: [`REFACTOR.txt`](REFACTOR.txt) (obiettivi e vincoli invariati).
> Questo documento trasforma il piano in checklist eseguibile, con **priorità**, **stato reale verificato nel codice** e **fattibilità** per ogni voce.
> Analisi eseguita su: `internal/goide`, `internal/ide`, `internal/languages`, `frontend/src` (stores, hooks, componenti, bindings).

**Legenda**

| Simbolo | Significato |
|---|---|
| `[x]` | **Già implementato** — non duplicare, solo verificare/misurare |
| `[ ]` | Da fare |
| **Fattibilità** | `Alta` = modifiche locali e a basso rischio · `Media` = più file / coordinamento · `Bassa` = alto rischio o da dimostrare con benchmark |
| **Stato** | `Esiste` · `Parziale` · `Mancante` |

**Vincoli invariati dal piano originale** (vale per ogni task):
misurare prima/dopo · nessuna regressione funzionale o grafica · nessun contratto Wails o formato persistente rotto · niente telemetria remota · niente nuove dipendenze/processi se evitabili · una modifica verificabile alla volta, in ordine di impatto.

---

## CS-HOST — Alleggerire il backend Code Studio (audit 2026-10-19)

**Stato: pianificato, nessuna estrazione dichiarata completata.** Verificato `main` a `e8a1c70fc9112e340a0ddd7b06f56741f8c4407b`: 70 directory immediate in `internal`, 266 elementi immediati in `internal/codestudio` (non 266 file di implementazione). Il checkout `develop` contiene anche lavoro concorrente: 71 directory e 267 elementi al momento dell'audit. Il numero di cartelle non è un criterio di accettazione.

Architettura confermata: `codestudio` compone core e adapter; `ide` non importa host, adapter o tooling Go; `languages` non importa host. L'ADR 0001 è esplicitamente superata dal piano multilinguaggio. Le 12 fasi completate indicano la migrazione della piattaforma, non un host già privo di implementazione concreta.

### P0 — Estrazioni in ordine di esecuzione

- [ ] **CS-HOST.1 Profiling.** Estrarre da `internal/codestudio/pprof.go` interpretazione e aggregazione dei campioni, Top, flame graph, archi e righe verso `internal/languages/golang/profiling`. `ListProfileFiles`/`LoadProfile` conservano nell'host sessione, confinamento dei percorsi e limiti di lettura. Spostare con il motore i test numerici di `pprof_test.go`/`pprof_accuracy_test.go`; mantenere test host sui percorsi. Conservare i DTO pubblici e verificare il risultato della generazione Wails prima di scegliere alias o conversioni: lo stesso JSON non garantisce lo stesso percorso TypeScript generato. Beneficio: analisi e regressioni numeriche concentrate nello stesso modulo.
- [ ] **CS-HOST.2 Dipendenze Go.** Estrarre parsing `go list`/`go mod graph`, costruzione del grafo, duplicati, licenze e pesi da `dependencygraph.go` verso `internal/languages/golang/dependencies`. Restano nell'host autorizzazione, risoluzione della directory, cache/singleflight e orchestrazione dei processi. Inventariare prima i consumer di `runModuleCommand`, incluso `affected_packages.go`: non spostarlo insieme al parser senza considerarli. Riutilizzare test grafo, cache e invalidazione; preservare limiti, isolamento tra sessioni e comportamento offline. Beneficio: un proprietario per la semantica dei moduli Go, senza trasferire la gestione delle sessioni nell'adapter.
- [ ] **CS-HOST.3 Coverage condivisa.** Separare il contratto neutro dai parser: `coverage_java.go` usa già lo stesso `CoverageReport` per JaCoCo. Valutare il contratto in `ide/testing`, con compatibilità esplicita dei DTO host; parser del profilo e analisi AST di `coverage.go`/`coverage_branches.go` nell'adapter Go, lettura JaCoCo nell'adapter Java. Nessuna dipendenza Java → Go. Verificare shape JSON, colonne UTF-16, disk token, sorgenti confinati, moduli annidati, funzioni e rami. Beneficio: due adapter reali condividono il risultato senza condividere la sintassi del linguaggio.
- [ ] **CS-HOST.4 Riesame del lifecycle LSP.** La policy RAM è già in `internal/resources/budget.go`. `lsp_budget.go` gestisce mutex, processi, richieste pendenti, attività, epoch e sospensione tramite `lspSession`: non spostare il solo file in `ide/lsp`. Delimitare prima la responsabilità del manager completo, mantenendo replay buffer, shutdown, crash/restart e isolamento sessione/linguaggio. Riusare la policy esistente; nessun secondo servizio di budget.
- [ ] **CS-HOST.5 Riesame gopls e facade.** `DetectGopls` delega già a `golang.LocateGopls` e `ServerSpec` è già nell'adapter. Lasciare nell'host consenso, installazione tramite process manager, configurazione per sessione, eventi e persistenza. Estrarre soltanto semantica Go residua con consumer verificati. Ridurre `service.go` come conseguenza delle estrazioni; suddividerlo in file dello stesso package non conta come riduzione dell'accoppiamento. Conservare i campi Go legacy dei DTO finché sono richiesti dalla compatibilità.

### P1/P2 e gate

- [ ] **CS-HOST.6 P1 Adapter.** Introdurre sottopacchetti Go/Java solo per responsabilità autonome e dipendenze unidirezionali, dopo le estrazioni P0; nessuna nuova interfaccia per un consumatore ipotetico.
- [ ] **CS-HOST.7 P2 Moduli adiacenti.** Cercare duplicazioni concrete tra `codestudiowindow`, `devcontext`, `devsession`, `eclipsepde` e gli altri moduli prima di proporre raggruppamenti. Finestre native e sessioni applicative non diventano responsabilità degli adapter.

Per ciascuna estrazione: diff limitato, test comportamentali del modulo e della facade, `go test ./internal/ide -run 'TestCoreDoesNotImportLanguageAdapters|TestLanguageAdaptersDoNotImportHost' -count=1`, confronto dei binding generati e dei contratti JSON/sessione senza variazioni, compilazione dei consumer coinvolti. I test architetturali sono **PASS nell'audit 2026-10-19**; non sono prova di estrazioni ancora da eseguire. Al checkpoint d'integrazione eseguire le suite complete previste dal repository. Le verifiche desktop restano nel solo `MANUAL-CHECK.md`.

---

## Sintesi

| # | Voce | Priorità | Stato | Fattibilità | Impatto atteso | Sforzo |
|---|------|----------|-------|-------------|----------------|--------|
| 1 | Baseline e profiling | **P0** | Parziale | Alta | Abilita tutto il resto | Medio |
| 2 | Lifecycle gopls | **P0** | Parziale | Media | Alto (RAM/CPU idle) | Medio |
| 3 | Re-render React | **P0** | Parziale | **Alta** | **Alto (quick win)** | Basso |
| 4 | Comunicazione React ↔ Go | **P0** | Parziale | Media | Alto | Medio |
| 5 | Editing e diagnostica | **P0** | Parziale | Media | Medio-alto | Medio-alto |
| 6 | Lifecycle Monaco | **P1** | **Esiste** | Alta | Basso residuo | Basso |
| 7 | Virtualizzazione | **P1** | Parziale | Media | Medio | Medio |
| 8 | Filesystem watcher | **P1** | Parziale | **Alta** | Medio | Basso |
| 9 | Cache condivisa | **P1** | Parziale | **Alta** | **Alto (quick win)** | Basso-medio |
| 10 | Controllo concorrenza | **P1** | Esiste (quasi) | Alta | Basso-medio | Basso |
| 11 | Modalità idle | **P1** | Parziale | Media | Medio-alto | Medio |
| 12 | Bundle e startup | **P2** | **Esiste** | Alta | Basso residuo | Basso |
| 13 | Valutazione Rust | **P2** | Chiusa: valutata con dati, non adottata | Bassa | ? | — (solo valutazione) |
| 14 | Memory leak / stabilità | **P2** | Parziale | Media | Medio | Medio |
| 15 | Performance budget | **P3** | Parziale | Alta | Istituzionale | Basso |
| 16 | Benchmark automatici | **P3** | Parziale | Media | Istituzionale | Medio |

**Quick win ad alto impatto / basso sforzo (fare per primi):**
voci **3** (devLogs churn + selector `documents`), **9** (cache dependency graph + fingerprint), **8** (filtri .gitignore), **12** (rimozioni residue), **2** (sweep processi orfani).

---

## Fase A — Audit e quick win (P0)

### 1. Performance baseline e profiling — `P0` · Stato: Parziale · Fattibilità: **Alta**

**Cosa esiste già** (non rifare):
- [x] `internal/startupperf/recorder.go` — `startup-performance.jsonl` locale con stadi backend (`app.go:142-193`) e marks frontend (`frontend/src/lib/startupPerformance.ts`, 18 marks incl. byte per payload).
- [x] Benchmark Go presenti: `internal/goide/release_performance_test.go`, `internal/logindex/bench_test.go`, `internal/ai/claudecode_test.go`.
- [x] Strumento di confronto benchmark frontend: `components/goide/goStudioBenchmarkCompare.ts`.
- [x] Product features di profiling (per servizi utente, **non** per adOmnia): `internal/goide/pprof_capture.go`, `trace_capture.go`, `startup_analysis.go`, `shutdown_analysis.go`.

**Mancante** (da fare):
- [x] **Endpoint pprof dell'app** ✅ *(fatto 2026-10-15)*: `internal/perf` — `net/http/pprof` su mux dedicato (DefaultServeMux invariato), attivo solo con `ADOMNIA_PPROF=1` (default `127.0.0.1:6069`, valore esplicito ammesso), loopback-only con **rifiuto esplicito** di indirizzi non loopback. Test: disabilitato di default, servizio reale su loopback, rifiuto non-loopback.
- [x] **Suite di scenari ripetibili** ✅ *(fatto 2026-10-15, protocollo)*: i 9 scenari del piano (avvio freddo/caldo · Hub vuota · Go Studio piccolo/grande · 3-5 workspace · digitazione continua · file grandi/JSON · cambio rapido tab · 10 cicli apertura/chiusura · idle 5/15/30 min) documentati con procedura, durata e metriche in `docs/PERFORMANCE.md` ("Native scenario baseline protocol"). Registrazione opt-in con `ADOMNIA_PERF_SCENARIO` (+ `ADOMNIA_PERF_INTERVAL`, `ADOMNIA_PERF_DURATION`).
- [x] **Metriche per scenario** ✅ *(fatto 2026-10-15)*: recorder JSONL locale in `<dataDir>/perf/` con runtime Go (goroutine, heap, GC) + albero processi completo e RAM/CPU per processo (WebView2, gopls, debug adapter, figli — riusa `internal/resources`, gopsutil già dipendenza) + latenza input keypress→paint lato renderer (`lib/inputLatency.ts`, attiva solo durante la registrazione, merge via binding `main.App.PerfPushFrontendMetrics`). *Restano ai strumenti del protocollo* (come da piano): frame persi e tracce input-to-render complete (React Profiler, Chrome/WebView DevTools Performance), latenza RPC (marks esistenti).
- [ ] **Report baseline separato per backend Go / WebView2 / gopls / processi figli**: aggregatore pronto (`scripts/perf-scenario-report.mjs` → `kind: native-scenario-baseline`, colonne per componente + runtime + input) e verificato; **mancano i numeri nativi**, da raccogliere eseguendo la suite sul target (comandi nel protocollo). Fino ad allora la tabella resta vuota e i target proposti non validati.
- [x] **Documentazione** ✅ *(fatto 2026-10-15)*: protocollo, comandi, metriche, strumenti e criteri in `docs/PERFORMANCE.md` ("Native scenario baseline protocol").

**Criterio di accettazione:** report baseline riproducibile, con misurazioni separate per backend Go, WebView2, gopls e processi figli.
**Nota:** è il prerequisito logico delle voci 15-16 e di ogni "misurato prima/dopo". **Fare per prima.**

---

### 2. Ottimizzazione del ciclo di vita di gopls — `P0` · Stato: Parziale · Fattibilità: **Media**

File: `internal/goide/lsp_idle.go`, `internal/goide/lsp.go`, `internal/languages/golang/gopls.go`, `internal/ide/lsp/`, `internal/goide/lsp_documents.go`.

**Cosa esiste già** (non rifare):
- [x] Sospensione dopo 5 minuti di inattività: `lsp_idle.go:5` (`languageServerIdleTimeout = 5 * time.Minute`), con guardia `idleEpoch` e controllo `PendingRequests()`.
- [x] Resume con replay dei buffer: `lsp_documents.go:28-45` + `reopenDocuments` (`lsp.go:313-325`) — documenti, diagnostica e stato preservati.
- [x] Nessun gopls duplicato **nella stessa sessione**: `lspKey{session, language}`, `Start` idempotente (`lsp.go:226-231`), test `lsp_idle_test.go`.
- [x] Restart per crash: max 3 in 2 minuti con backoff esponenziale (`lsp.go:366-399`).
- [x] `GOMEMLIMIT=1GiB` come default gopls (`gopls.go:105-106`, override da env utente).
- [x] Cache di SDK/PATH/versioni strumenti: `internal/ide/sdk/versioncache.go` (validazione `BinaryStamp`), `detectFast` con `go env` in background, `toolversion.go` `toolResolutionCache`. Le verifiche ripetute sono cache-hit (problema VPN/proxy già mitigato).

**Mancante** (da fare):
- [x] **Sweep processi orfani all'avvio** ✅ *(fatto 2026-10-15)*: registro locale dei figli gestiti (`internal/ide/process/managed.go`, `managed-children.json` accanto al runtime lock) — gopls e debug adapter si registrano all'avvio e si rilasciano all'uscita; `goide.SweepOrphanChildren` termina all'avvio i figli rimasti vivi dopo un crash, con identità (PID + nome eseguibile) che risparmia i PID riassegnati e guardia che salta lo sweep se un'altra istanza è ancora viva.
- [x] **Far rispettare `MaxPendingLSPRequests = 128`** ✅ *(fatto 2026-10-15)*: backpressure al livello JSON-RPC (`internal/ide/lsp/jsonrpc.go`, `SetPendingLimit`) — oltre il limite le nuove richieste falliscono subito con `ErrTooManyPendingRequests` invece di accumularsi.
- [x] **Valutata la condivisione gopls per workspace** (2026-10-15): mantenuti processi/connessioni distinti per sessione. Stesso root può avere overlay non salvati, versioni, SDK/configurazioni e intento esplicito differenti; un refcount sulla sola `Project.RealPath` romperebbe l’isolamento per URI. Eventuale daemon condiviso richiede connessioni LSP separate, ownership centrale e teardown all’ultimo consumer; non abilitato in questo intervento. Decisione ed evidenze nel registro 11 e in `docs/PERFORMANCE.md`.
- [x] Valutare la sospensione con editor aperti ma inattivi (oggi deliberatamente esclusa: `lsp_idle.go:15` non sospende con documenti aperti/dirty). Decisione da prendere con dati: se i buffer restano preservati il rischio è basso. — **VALUTATO 2026-10-15: resta esclusa.** Senza dati di idle con editor aperti non si cambia una scelta che protegge buffer sporchi e diagnostica; riaprire con misure CPU/RAM del gopls idle (voce 1).
- [ ] Applicare `GOMEMLIMIT` con verifica empirica (profilare heap gopls sotto carico; oggi il valore è statico e non validato).
- [ ] **IMPLEMENTATO, verifica desktop aperta:** `didChange` incrementale quando il server negozia `textDocumentSync=2` (numero o opzioni), fallback full per server full/legacy, nessuna notifica per sync None. Delta contiguo UTF-16 con confini Unicode/CRLF; buffer completo preservato per replay. Test wire, 2.000 coppie casuali e gopls reale v0.23.0 verdi; verifica in `MANUAL-CHECK.md`, REF-2.M1.
- [ ] **IMPLEMENTATO, verifica desktop aperta:** richieste di lettura sostituibili cancellate per connessione/URI/metodo alla richiesta successiva; cambio buffer e chiusura invalidano tutte le letture sostituibili del documento. Coperti completion, hover, signature help, semantic tokens, inlay hints, highlight e document symbols; rename/formatting/executeCommand restano espliciti. Test sul protocollo e risposte tardive verdi; REF-2.M1.
- [x] Evitare riavvii per cambiamenti irrilevanti (verificare che `filesChanged` → `NotifyWatchedFiles` non causi re-init). — **VERIFICATO 2026-10-15 (lettura + test):** `NotifyWatchedFiles` (`lsp_documents.go`) invia solo `workspace/didChangeWatchedFiles` filtrato (file non aperti e osservati dal server); nessun re-init. In più `filesChanged` non tocca più l'albero se nulla di rilevante è cambiato (voce 4).

**Criterio di accettazione:** nessun processo gopls duplicato o orfano (anche dopo crash), riattivazione affidabile, riduzione misurabile del consumo a inattività.

---

### 3. Riduzione dei re-render React — `P0` · Stato: Parziale · Fattibilità: **Alta** ⭐ quick win

> **Collegamento 2026-10-17:** i residui sul pannello risposte (parse JSON a ogni render, `prettyBody` ricalcolato, copie ritenute `previousBodyRef`/`beautifiedBody`) sono tracciati come **GS-18.5** in `mds/FIX.md` (review "cache per peso"); il resto della voce resta qui.

**Cosa esiste già** (non rifare):
- [x] Selector scalari e `useShallow` nei punti caldi Go Studio: `GoStudioPanel.tsx:144-174` ("buffer, console e ricerche non devono ridisegnare l'intero IDE"), `goStudioDebugEditor.ts`, `GoStudioStatusBar.tsx`, `GoStudioInspectionWidget.tsx`.
- [x] Context limitati e a bassa frequenza (solo 3 provider: Theme, PanelActive, TreeInteraction).
- [x] Cleanup di timer/listener/observer verificati (ResizeObserver, MutationObserver, IntersectionObserver, drag listener: tutti con teardown).
- [x] Polling con pausa su finestra nascosta **in 3 punti**: `goStudioRuntimeLens.ts:50-73` (best practice del codebase), `layout/ResourceStatus.tsx:15`, `layout/arcade/DotArcade.tsx`.
- [x] Architettura pannelli: solo `collections` e `goide` sono keep-alive (`MainAreaRouter.tsx:134`); gli altri rail smontano e i relativi interval muoiono.

**Problemi reali identificati** (da fare):
- [x] **Churn idle di `devLogs`** ✅ *(fatto 2026-10-15)*: `mergeBackendEntries` restituiva sempre un nuovo array `entries` anche con 0 elementi nuovi → notifica a ogni tick del poll di 1.5 s. Fix: fast-path sui batch vuoti + bail-out di zustand (`return s`) quando nessun ingresso è realmente nuovo. Test: `stores/devLogs.test.ts` (0 notifiche con batch vuoti/duplicati).
- [x] **Sottoscrizioni grezze a `state.documents` nei pannelli laterali** ✅ *(fatto 2026-10-15)*: `GoStudioGoPanel` ora sottoscrive solo il path del documento attivo (primitiva), `GoStudioContextPanel` solo il proprio documento attivo (`sessionGoIDEDocument`), `GoStudioCloseGuard` solo una chiave dirty (`goIDEDirtyKey`). Test: `stores/goideSelectors.test.ts`.
- [ ] Restano le sottoscrizioni grezze in `GoStudioEditor.tsx:38`, `GoStudioWorkspace.tsx:40`, `DetachedStudioToolWindow.tsx:28`: richiedono il refactor del flusso props editor (il buffer deve arrivare a `GoStudioCodeEditor`) — **coordinare con la voce 6**.
- [x] `GoStudioEditor.tsx:42` ricalcola `copiesInOtherSessions(allDocuments, ...)` a ogni battuta: memoizzare sulle sole dipendenze necessarie. — **GIÀ FATTO (nota superata):** `copiesForKey` con `useMemo` sulle sole chiavi del documento attivo (`GoStudioEditor.tsx`, `goStudioSharedCopies.ts`).
- [x] **Orologio Hub** ✅ *(fatto 2026-10-15)*: `WelcomePanel` (`useNow`) ora scatta allineato al cambio di minuto (`minuteAlignedTimeout` in `lib/visiblePolling.ts`), non ogni secondo: la Hub mostra solo ore e minuti.
- [x] **Ticker `GoStudioActivityBar` e `GoStudioSonarPanel`** ✅ *(fatto 2026-10-15)*: i timer 500 ms degli indicatori di progresso saltano i tick con finestra nascosta (`visibleInterval`), oltre a restare già limitati ai soli toast visibili.
- [x] **Gate di visibilità condiviso per i poller dei pannelli** ✅ *(fatto 2026-10-15)*: `visibleInterval` (`frontend/src/lib/visiblePolling.ts`, testato) sostituisce 15 `setInterval` a mano in BrowserDebug (×3), DockerLab, Database, Kube (×2), Proxy (×3), TraceStudio, WebSocket, Mock, LargeFile, ThemePanel e nel sync dei dev log: nessun tick con finestra nascosta, refresh immediato al ritorno visibile. Processi, terminali e debug avviati dall'utente non vengono toccati.
- [x] Memoizzare `EventRow` (`loginspector/EventList.tsx:237`) e le righe messaggi chat — oggi la lista re-renderizza tutte le righe visibili a ogni frame di scroll e i thread chat si rigenerano per chunk di streaming. — **FATTO 2026-10-15:** `EventRow` in `memo` (`onSelect` stabile, riceve l'evento); righe chat Copilot (`MessageView`) e Agent (`Reply`) in `memo`, così durante lo streaming si ridisegna solo l'ultimo messaggio e il markdown dei precedenti non viene riparsato.
- [x] Streaming chat (`stores/copilot.ts:93-97`, `stores/agentChat.ts:103-106`, `stores/claudeCode.ts`): sostituire il replace dell'intero array con append/patch dell'ultimo messaggio. — **FATTO 2026-10-15 in forma equivalente:** gli store già mantengono l'identità dei messaggi non toccati (`map` che restituisce lo stesso oggetto); con le righe in `memo` il costo per chunk è O(1) in rendering. Sostituire l'array con un patch dell'ultimo elemento non cambierebbe i render.
- [x] `useLiveCore()` (`stores/devSession.ts:132-134`) sottoscrive 9 slice: stringere ai soli campi usati dai 3 consumer (`CommandPalette`, `LiveRequestStrip`, `DebugBar`). — **FATTO 2026-10-15:** tolti `queries` e `messages` dalla sottoscrizione (nessuno dei 3 consumer né degli helper del modello li legge): niente re-render per ogni SQL/messaggio broker catturato.
- [x] Applicare `React.memo` (oggi solo 10 usi su 396 componenti) **solo dove il profiling dimostra benefici** — come da piano. — **FATTO 2026-10-15 solo dove serve:** righe ad alta frequenza (`EventRow`, messaggi chat). Nessun `memo` generalizzato, come da piano.
- [ ] Decorazioni/animazioni: verificare che non consumino con finestra inattiva (pattern di `DotArcade` già corretto, estendere dove serve).

**Criterio di accettazione:** meno commit React, nessun aggiornamento superfluo (in particolare zero churn a finestra inattiva), nessuna regressione visiva.

---

### 4. Ottimizzazione comunicazione React ↔ Go — `P0` · Stato: Parziale · Fattibilità: **Media**

**Cosa esiste già** (non rifare):
- [x] Dedup in-flight: `lib/useServerPort.ts:48-62` (`tokenFlight`).
- [x] Memoizzazione per promessa: `goStudioCodeVision.ts:25` (`blameCache`), `lib/devsession/contractDrift.ts:33`, `goStudioEditorConfig.ts:96`.
- [x] Scritture debounced + coalescing: `lib/storeSave.ts` (con `setSavesSuspended`/`flushPendingSaves`).
- [x] Debounce digitazione → aggiornamento LSP monotono: `components/goide/goStudioLspSync.ts`.
- [x] Cancellation: `stores/goideLsp.ts:365-387` (scarto risposte stale + `cancel()`), `goStudioSemanticFeatures.ts:147-180` (debounce + `inFlight.cancel()`), `lib/sendRequest.ts:150` (AbortSignal → `CancelHTTP`).
- [x] Eventi/streaming Wails già usati (`goide:event`, `devsession:event`, `Events.Emit` in `service.go:1021`), buffer ad anello con drop-oldest in `internal/logstream`, canale limitato 256 slot in `internal/ide/run/processes.go:421-440`.
- [x] Payload strutturalmente limitati (Sonar ≤ 5000 issue, search con troncature) e bootstrap con payload pre-marshal + `PayloadBytes` (`internal/bootstrap/bootstrap.go`).

**Mancante** (da fare):
- [x] **Cache del dependency graph** ✅ *(fatto 2026-10-15)*: `internal/goide/dependencygraph.go` rilanciava `go list -m -json all` / `go mod graph` / `go list -deps` a ogni chiamata (timeout 30 s). Cache in memoria per (sessione, directory, binario go) con invalidazione su stamp di `go.mod`/`go.sum`/`go.work*` + binario e su eventi `filesChanged` (`internal/goide/dependencygraph_cache.go`).
- [x] **Ridurre il fingerprint walk di `workspace_graph.go`**: `Fingerprint` ripercorre l'albero a ogni chiamata non forzata; agganciarlo al watcher (invalidazione event-driven) invece che al re-walk. — **FATTO 2026-10-15:** `graphFreshness` (`workspace_graph.go`): il watcher incrementa la generazione quando cambia un sorgente/compose o c'è create/delete/rename/overflow (`graphRelevant`); con watcher completo e grafo verificato alla generazione corrente `workspaceGraph` restituisce la cache senza ripercorrere l'albero. Test `TestGraphFreshnessTracksRelevantChangesOnly`.
- [x] Timeout RPC generici dove mancano (oggi solo timeout per chiamate LSP e alcune chiamate Go). — **FATTO 2026-10-15:** `internal/git` non aveva alcun timeout (un git bloccato su lock/credenziali teneva appeso il pannello): `runGit`, `runFull`, `runFullWithEnv` ora usano `gitContext` (3 min locale, 10 min fetch/pull/push/clone/remote) con messaggio chiaro. LSP (15 s) e `go list` (30 s) li avevano già.
- [x] Dedup generico per RPC equivalenti concorrenti (oggi è fatto feature per feature): valutare un piccolo helper condiviso `singleflight`-like, senza nuova dipendenza. — **FATTO 2026-10-15:** `internal/ide/flight` (`Group[T].Do`, ~30 righe, nessuna dipendenza, test) con primo consumer reale: `DependencyGraph` (più pannelli che lo chiedono a freddo ora condividono un solo calcolo).
- [x] Batching di richieste indipendenti dove utile (es. caricamenti iniziali multipli) — solo con evidenza di payload ripetuti. — **VALUTATO 2026-10-15: non fatto** — nessuna evidenza di payload ripetuti nei caricamenti iniziali; il piano chiede evidenza prima di intervenire.
- [ ] Verificare che le operazioni lunghe usino eventi/streaming e non polling di risultati (audit mirato su `service*.go`).
- [x] Separare le operazioni prioritarie per la UI dal background (oggi implicito: valutare code con priorità solo se emergono contese). — **VALUTATO 2026-10-15: non fatto** — nessuna contesa osservata (canali separati per LSP, run e analisi); code con priorità solo se emergono dati.

**Criterio di accettazione:** riduzione del numero di chiamate e della latenza P95, senza risultati obsoleti né inconsistenze di stato.

---

### 5. Ottimizzazione editing e diagnostica — `P0` · Stato: Parziale · Fattibilità: **Media**

**Cosa esiste già** (non rifare):
- [x] Throttle diagnostica 150 ms con invio dell'ultimo burst per file + cap 1000 diagnostica/file (`lsp.go:686-737`).
- [x] Versioning documenti con rifiuto delle versioni stale (`lsp_documents.go:72-75`), cap 16 MiB.
- [x] Semantic tokens con configurazione ridotta (stringhe/numeri disabilitati, `gopls.go:133`), inlay hints opzionabili.
- [x] Nessuna analisi duplicata nella UI: i marker (`ImplementationMarkers`, `RecursiveCalls`) usano dati LSP, non rianalizzano.

**Mancante** (da fare):
- [x] **Nessuna analisi costosa a ogni battuta nel pannello Context Propagation** ✅ *(fatto 2026-10-15)*: `analyzeContextPropagation` in `GoStudioContextPanel.tsx` girava a ogni carattere sul buffer intero; ora è debounced (700 ms, come `goStudioContextMarkers` che ricalcola la stessa analisi) con aggiornamento immediato al cambio documento.
- [ ] Misurare la latenza digitazione → render (fa capo alla voce 1: strumentazione dedicata, es. mark su onChange → paint).
- [ ] **IMPLEMENTATO, verifica desktop aperta:** aggiornamenti incrementali dei documenti (voce 2, REF-2.M1); il binding frontend mantiene il contratto full-buffer, la riduzione riguarda il tratto backend → language server.
- [ ] **IMPLEMENTATO, verifica desktop aperta:** cancellazione letture superate al cambio buffer sincronizzato o alla query successiva (voce 2, REF-2.M1).
- [x] Dedup diagnostica per contenuto (oggi solo throttle): evitare re-render della UI quando le diagnostiche sono identiche. — **FATTO 2026-10-15:** `sameDiagnostics` in `stores/goideLsp.ts`: un `lsp.diagnostics` identico al precedente lascia lo stato invariato (nessun re-render). Test dedicato.
- [ ] Verificare il costo reale di semantic tokens, inlay hints e decorations sotto carico (profilare con e senza; rendere disattivabili le costose se emergono).
- [x] Evitare analisi costose a ogni carattere: audit dei listener `onDidChangeModelContent` (decorazioni comment-tags, context markers, ecc.) con debounce dove manca. — **AUDIT 2026-10-15:** solo 3 listener `onDidChangeModelContent`: marker di riga (debounce `TRACK_DEBOUNCE_MS`), semantic features (debounce `schedule`) e sincronizzazione buffer (`recordEdit` + `getValue`, lavoro minimo e necessario). Nessun debounce mancante.

**Criterio di accettazione:** digitazione fluida anche durante indicizzazione e diagnostica, senza perdita di funzionalità LSP.

---

## Fase B — Scalabilità (P1)

### 6. Lifecycle completo di Monaco Editor — `P1` · Stato: **Esiste** · Fattibilità: **Alta** · Residuo: verifica + hot path

**Cosa esiste già** (non rifare — già ottimizzato bene):
- [x] Caricamento lazy: Monaco solo da pannelli `React.lazy` (`MainAreaRouter.tsx:20-40`, `main.tsx:6-24`); denylist CI che vieta import eager (voce 12).
- [x] Model riutilizzati per (file, sessione) URI: `GoStudioCodeEditor.tsx:267` + `goStudioModelUri.ts:7-9`; `keepCurrentModel` deliberato.
- [x] Rilascio centralizzato: `goStudioModelUri.ts:23-34` `releaseModelsOfClosedDocuments()` (deferred, con dispose).
- [x] Model di preview con LRU + dispose: `goStudioLanguageFeatures.ts:124-138`.
- [x] Decorations via `IEditorDecorationsCollection` + dispose su `onDidDispose`; registry editor `goStudioEditorRegistry.ts`.

**Da fare (residuo):**
- [ ] Misurare l'heap JS su cicli ripetuti apertura/chiusura file (richiesto dal piano: confermare empiricamente che `releaseModelsOfClosedDocuments` tiene).
- [ ] Ridurre il round-trip keypress → store → `value={document.buffer}` controllato (`GoStudioCodeEditor.tsx:270`): è il vero hot path adiacente a Monaco (coordinare con voce 3).
- [x] Verificare riuso dei modelli anche al cambio tab (asserzione/test dedicato). — **FATTO 2026-10-15:** test in `goStudioModelUri.test.ts` — 20 riordini/cambi tab non eliminano nessun modello Monaco.

**Criterio di accettazione:** nessuna crescita progressiva ingiustificata della memoria dopo ripetuti cicli di utilizzo.

---

### 7. Virtualizzazione e caricamento incrementale — `P1` · Stato: Parziale · Fattibilità: **Media**

**Cosa esiste già** (non rifare):
- [x] Lista virtualizzata custom: `loginspector/EventList.tsx:98-199` (windowing a riga fissa, overscan 12 — "100k eventi costano come 40").
- [x] Paginazione incrementale albero: `GoStudioProjectTree.tsx:84-157` (`TREE_PAGE = 500`, "Mostra altri"), `DirectoryNode` memoizzato.
- [x] Cap e paginazione in molte aree: dev logs (2000), console run (4 MB con chunking), gRPC log (80), risultati DB (`ResultsView.tsx` `PAGE_SIZE`), search (`SYMBOL_LIMIT`/`ACTION_LIMIT`), completamenti SQL (50).

**Mancante** (da fare):
- [x] Estendere il pattern di windowing di `EventList` alle liste non limitate per design: **righe della console run** (renderizzate per intero entro il cap 4 MB), **vista log dev** (`DevLogOverlay` filtra fino a 2000 righe a render), **messaggi chat** lunghi. — **VERIFICATO 2026-10-15:** la console run disegna già solo la coda (`MAX_RENDERED_LINES` = 5000, Copy/ricerca sull'intero buffer); la vista log dev è uno strumento di debug con buffer a tetto; i messaggi chat sono ora in `memo`. Nessuna nuova libreria. **Completato 2026-10-15 con finestra a coda vera**: 1.000 righe di default, "show more" fino al cap, ricerca che apre al cap (Registro 14).
- [x] Dependency/flow graph: `flows/FlowsPanel.tsx:894` renderizza tutti i nodi SVG — valutare virtualizzazione solo sopra una soglia reale (grafi piccoli vanno bene). — **VALUTATO 2026-10-15: non necessaria** — nessuna evidenza di grafi reali oltre soglia; si riapre con un caso misurato.
- [ ] Preservare selezione, scroll e stato dei nodi durante gli aggiornamenti (audit su tree e liste con refresh periodico).
- [x] **Non** introdurre virtualizzazione complessa su liste piccole (vincolo del piano) e **nessuna nuova libreria** (rispettare "niente dipendenze non necessarie"): estendere la window-list esistente. — **RISPETTATO 2026-10-15:** nessuna virtualizzazione aggiunta e nessuna libreria nuova.

**Criterio di accettazione:** navigazione fluida e memoria controllata anche con decine di migliaia di elementi.

---

### 8. Filesystem watchers e indicizzazione — `P1` · Stato: Parziale · Fattibilità: **Alta** ⭐ quick win

**Cosa esiste già** (non rifare — molto ben fatto):
- [x] Un watcher fsnotify per sessione, idempotente, con `Stop`/`Shutdown` ordinati (`internal/goide/watcher.go`).
- [x] Debounce 150 ms + latenza massima 1 s, coalescing in `pending map[path]kind`, soppressione rumore save-atomico (`.go:202-209`).
- [x] Gestione overflow (`Overflow:true` → recheck), cap 500 path/batch, cap 4000 directory con flag `Limited`, auto-watch directory nuove.
- [x] Rilascio alla chiusura progetto (`service.go:345`, `service_session_state.go:178` + race-guard `service.go:1065-1072`).
- [x] Aggiornamenti incrementali a valle: invalidazione file-index + `lsp.NotifyWatchedFiles` + evento `files.changed` (`service.go:1075`).

**Mancante** (da fare):
- [x] **Filtri coerenti con `.gitignore`** — FATTO 2026-10-15: `project.LoadGitIgnore` (`internal/ide/project/gitignore.go`, `*` `?` `**`, ancoraggio, solo-cartella, negazione; solo `.gitignore` della radice) applicato a watcher, ricerca e quick open; test `gitignore_test.go`, `TestSearchProjectHonoursRootGitignore`, `TestWatcherSkipsGitignoredFoldersAndReportsRenames`. Limite noto: modifiche a `.gitignore` a progetto aperto valgono dal prossimo riavvio del watcher/ricerca. Originale: oggi il filtro è solo per nome (`isIgnoredDirectory` → `project.IgnoredDirectory`, `documents.go:505-507`). Aggiungere parsing `.gitignore` (con le esclusioni di progetto già esistenti come base). **Completato anche sull'albero del progetto** (`ListDirectory`, Registro 12): cartelle ignorate nascoste come `node_modules`, file ignorati visibili ma marcati.
- [x] FATTO: elenco esteso con `__pycache__`, `.venv`, `.gradle`, `.next`, `.nuxt`, `.turbo`, `.terraform`, `.pytest_cache`, `.mypy_cache` (`ignoredDirectories`); `node_modules`, `.git`, `build`, `dist`, cache già presenti. Verificare che `node_modules`, `.git`, build e cache siano sempre esclusi salvo richiesta esplicita (estendere l'elenco delle directory ignorate).
- [x] FATTO: delete già coperto, aggiunto rename (`old.go` → `src/new.go` = Deleted + Created) e overflow già presente. Gestione rename/delete verificata con test dedicati (alcuni ci sono: `watcher_test.go`; integrare casi rename/overflow se mancanti).

**Criterio di accettazione:** consumo proporzionato alle modifiche effettive e nessuna perdita di sincronizzazione.

---

### 9. Cache condivisa e invalidazione intelligente — `P1` · Stato: Parziale · Fattibilità: **Alta** ⭐ quick win

**Cosa esiste già** (non rifare — cache ad-hoc già presenti):
- [x] Grafo semantico workspace: memoria + disco (`workspace_graph.go:20-121`, invalidazione su `Fingerprint` + `graphBuilderVersion`, single-flight per sessione).
- [x] Risoluzione versioni tool (`toolversion.go`, cache permanente di successi e incompatibilità), versioni binari (`versioncache.go`), rilevazione toolchain (`detectFast` + persistenza `DetectedToolchains`).
- [x] Indice file progetto (`quick_open.go:16-72`, invalidazione su create/delete), contenuti HEAD git (`vcs.go:37-38`, re-read al cambio hash), code actions LSP (cap 64), profili terminali (TTL), cache DNS, campionamenti risorse (1 s).

**Mancante** (da fare):
- [x] **Cache dependency graph** ✅ *(fatto 2026-10-15, vedi voce 4)*: `internal/goide/dependencygraph_cache.go` — era la voce a maggiore impatto qui.
- [x] **Fingerprint event-driven** per `workspace_graph.go` (vedi voce 4): evitare il re-walk dell'albero. — **FATTO 2026-10-15:** vedi voce 4 (`graphFreshness`).
- [x] Valutare cache in memoria con **limiti LRU** per: parsing codice, ricerca simboli, analisi moduli, git status/diff. Analizzare quali risultano oggi ricalcolati (audit mirato) — applicare solo dove il profiling lo dimostra. — **VALUTATO 2026-10-15: nessuna nuova cache** — git status/diff si rileggono volutamente (stato vivo), la ricerca simboli è di gopls, il grafo dipendenze e quello workspace hanno già cache con invalidazione; senza un ricalcolo misurato non si aggiunge LRU.
- [x] Piccolo helper condiviso di cache/single-flight (oggi ogni cache è fatta a mano): solo se riduce codice, senza nuove dipendenze esterne. — **FATTO 2026-10-15:** `internal/ide/flight` (single-flight); le cache restano specifiche perché hanno chiavi di invalidazione diverse (stamp di `go.mod`, fingerprint, TTL).
- [ ] Regole di invalidazione esplicite: modifiche file, versione SDK, configurazione workspace, dipendenze — allineare le cache esistenti a queste regole (oggi eterogenee: TTL, hash, evento).
- [x] Persistenza locale solo dove utile (già fatta per grafo e toolchain: non estendere senza motivo). — **RISPETTATO 2026-10-15:** nessuna nuova persistenza aggiunta.

**Criterio di accettazione:** riduzione dei tempi delle operazioni ripetute, senza mostrare dati obsoleti.

---

### 10. Controllo della concorrenza — `P1` · Stato: Esiste (quasi) · Fattibilità: **Alta**

**Cosa esiste già** (non rifare):
- [x] Worker pool limitato per la ricerca (`search.go:100-118`, con cap file/risultati e cancellazione ctx).
- [x] Backpressure: canale 256 slot con drop-on-full (`internal/ide/run/processes.go:421-440`), buffer ad anello log con contatori `dropped`/`missed`, indicizzazione sequenziale e cancellabile (`internal/logindex`).
- [x] Spawn `go func` rari e per entità (sessione/stream/server LSP): nessuna creazione illimitata trovata nei path caldi.

**Mancante** (da fare):
- [x] Cancellare i task obsoleti dove manca (audit su: scansioni sonar lunghe, `go list` in background, analisi secondarie) — allineare al modello di `stores/goideLsp.ts` (scarto stale + cancel). - FATTO 2026-10-15: audit + allineamento di sonar, `go list`/versioni e analisi dipendenze al modello stale+cancel (`RequestEpoch` + `cancelInFlight`, wrapper cancellabili); Registro 15.
- [x] Priorità esplicita a digitazione, completamento e navigazione rispetto a indicizzazione/analisi in background: oggi implicita (canali separati); formalizzare solo se emergono contese di CPU. — **VALUTATO 2026-10-15: non formalizzata** — nessuna contesa di CPU misurata; canali separati restano sufficienti.
- [x] Verifica sistematica di race condition e goroutine leak (`go test -race` mirato + conteggio goroutine nei test di ciclo — coordinato con voce 14). — **FATTO 2026-10-15:** `go test -count=1 -race ./internal/ide/... ./internal/languages/... ./internal/goide/` verde (nessuna data race); goroutine/handle già coperti dai test di ciclo della voce 14.
- [x] Evitare creazione illimitata di subprocess: verificare i limiti su lint/test runner concorrenti. — **AUDIT 2026-10-15:** le esecuzioni utente passano dal run manager (`MaxConcurrentRuns` = 8); lint/vulncheck/sonar/dipendenze sono azioni singole avviate dall'utente, ciascuna con timeout e cancellazione, non code in background.

**Criterio di accettazione:** nessuna saturazione improvvisa della CPU e interfaccia utilizzabile durante operazioni pesanti.

---

### 11. Modalità idle intelligente — `P1` · Stato: **Parziale — implementata, Hub misurata; accettazione API/IDE aperta** · Fattibilità: **Media**

**Cosa esiste già** (politiche frammentate, da unificare — non duplicare):
- [x] Sospensione LSP dopo 5 min (`lsp_idle.go`), reaper sessioni idle (`internal/ws/client.go:22`, `internal/sse/client.go:128`), timeout DB (`internal/database/manager.go:179,265`).
- [x] Frontend: pausa polling su `document.hidden` in `goStudioRuntimeLens.ts`, `ResourceStatus.tsx`, `DotArcade.tsx`; backoff polling in `runtimeLens`; check `document.visibilityState` in `stores/updater.ts:58`; stale-check su `focus` in `stores/devcontext.ts:49-53`; `requestIdleCallback` all'avvio (`lib/startupIdle.ts`).

**Mancante** (da fare):
- [x] **Stati centralizzati** in `internal/activity`, store `stores/activity.ts` e tracker/hook frontend: Active / Background / Idle dopo 5 minuti / Suspended solo dopo rilascio effettivo delle risorse automatiche monitorate. Report associati dal binding alla finestra Wails chiamante; aggregazione fra finestre staccate e workspace, rimozione dei reporter chiusi senza heartbeat. La visibilità è distinta dal focus tastiera nello split view.
- [x] **Gate di visibilità per tutti i poller residui** ✅ *(fatto 2026-10-15, vedi voce 3)*: 15 poller convertiti a `visibleInterval`; resta escluso solo il liveness-check della popup dev logs (nessuna RPC, ciclo di vita della finestra).
- [x] `visibleInterval` usa timeout adattivi: zero timer in Background, status Idle almeno 15 s, decorazioni ferme in Idle; aggiornamenti live legati a operazioni esplicite mantengono la frequenza. Orologio Hub e misuratore risorse si fermano in Idle. Runtime Lens e analisi contesti consultano la stessa policy, anche per workspace non visibili; ripresa con dati correnti al ritorno. Nessuna RPC o notifica store per ogni battuta mentre si resta Active.
- [x] Allowlist conservativa del gestore: soltanto language server automatici e ripristinabili. Il lifecycle LSP esistente mantiene le guardie su editor aperti (anche dirty), RPC pendenti ed epoch; il processo si rilascia a timeout e si ripristina alla richiesta successiva. Test con processo helper reale su sospensione/resume, buffer tracciati e timer obsoleti.
- [x] **Regola codificata e testata:** terminal/debug/request/recording/process/DB/broker/WS/SSE e tipi sconosciuti non sono sospendibili dal gestore. Start/Restart LSP pubblici sono espliciti e protetti fino a Stop/Close; entry point automatici aggiuntivi per editor/toolchain/settings, senza rimuovere una protezione già assegnata. Restano invariati timeout configurati e reaper propri dei moduli: nessuna nuova cancellazione o chiusura globale.
- [ ] Completare le misure CPU idle 5/15/30 min su tutti i dataset della voce 1. Hub vuota misurata nella release Windows: primo campione Idle a 305 s, CPU media totale 0,04% a 15 e 30 min; workspace API popolato e progetto IDE ancora aperti. Evidenze e limiti in `MANUAL-CHECK.md`, REF-11.M1.

**Criterio di accettazione:** CPU prossima allo zero durante l'inattività reale, senza interrompere attività intenzionali.

---

## Fase C — Hardening (P2-P3)

### 12. Bundle frontend e startup — `P2` · Stato: **Esiste** · Fattibilità: **Alta** · Residuo: margini

**Cosa esiste già** (non rifare — già ottimizzato e presidiato):
- [x] Lazy loading sistematico: ~25 pannelli + finestre staccate (`App.tsx:32-40`, `MainAreaRouter.tsx:20-63`, `main.tsx:6-24`); moduli non critici deferiti a `firstStableFrame` e `requestIdleCallback`.
- [x] Budget automatico e **bloccante in CI**: `frontend/scripts/check-startup-bundle.mjs` — build reale, somma chunk statici, limite 650.000 B + zero moduli deferiti nello startup; denylist `deferredAppModule`/`deferredVendor` (monaco, yaml, mermaid, pdf-*, goide, ecc.). Wire: `npm run check:startup`, `.github/workflows/build.yml:50,54`.
- [x] `manualChunks` in `vite.config.ts:33-48` (wails-runtime, vendor-react, vendor-schema, vendor-yaml, vendor-misc; lucide-react per-icona con scelta motivata).
- [x] Visualizer ottico: `VITE_ANALYZE=1` (`vite.config.ts:55-58`).
- [x] Bootstrap con payload pre-marshal, decode timing per store, tab divise in critiche/deferite (`stores/tabs.ts:297-300`).

**Residui e verifica (2026-10-15):**
- [x] Denylist CI estesa con `yjs`, `y-monaco`, `@xterm/xterm` e addon, `d3-force` (modifica locale preesistente, verificata).
- [x] Definizioni lazy condivise in `components/layout/lazyPanels.ts`, riusate da `MainArea` e `MainAreaRouter`; stesse identità React e nessun import statico dei pannelli.
- [x] Backup startup: singola serializzazione e scrittura primaria `StoragePut('workspace', 'backup', ...)` dopo il primo frame; localStorage solo come fallback se il backend fallisce. Conservati formato 1.0, snapshot immutabile e impostazione; la vecchia copia locale non viene cancellata. Non cambia il formato `.adomnia`. Nota: il backup era uno snapshot separato, non una seconda serializzazione dello stesso salvataggio debounced.
- [x] MCP: singola serializzazione riusata per localStorage e backend (modifica locale preesistente, preservata).
- [x] `cloneForHistory`: sostituito round-trip JSON con `structuredClone`; test sulla cattura e riapertura verificano isolamento di header e metadati annidati. Microbenchmark ripetibile in `frontend/scripts/benchmark-history-clone.mjs`.
- [x] Budget controllato prima/dopo: 601.577 / 601.964 B, limite 650.000 B, margine finale 48.036 B; zero moduli vietati nello startup. Il working tree contiene modifiche concorrenti: il delta complessivo non è attribuibile solo a questa voce.
- [ ] Tempo fino alla prima interazione realmente utilizzabile: aggiunto `rendererToWorkspaceInteractive` dopo commit + due frame del workspace API idratato, distinto dal primo frame della shell. È un indicatore di disponibilità dei controlli, non una prova di interazione riuscita. Report nativo comparativo della voce 1 ancora da raccogliere.
- [ ] Prova Wails di ripristino/navigazione ancora da eseguire. Checkpoint successivo: `tsc`, build frontend, budget startup e `go build ./...` verdi dopo il completamento delle modifiche concorrenti; dettagli nel registro sotto.

**Criterio di accettazione:** startup migliorato senza compromettere ripristino dello stato e navigazione.

---

### 13. Valutazione selettiva di Rust — `P2` · Stato: **Chiusa: valutata con dati, non adottata** · Fattibilità: **Bassa** (solo valutazione, nessuna implementazione senza prove)

**Regola del piano:** non migrare automaticamente; adottare Rust solo con benchmark che dimostrano beneficio netto.

- [x] **Gate decisionale** (applicato 2026-10-15, esito sotto): prima di valutare Rust, ogni candidato deve passare il confronto: (1) implementazione Go ottimizzata vs (2) Rust vs (3) tempo/memoria vs (4) costo integrazione vs (5) portabilità Windows/macOS/Linux vs (6) complessità build/manutenzione.
- [x] Candidati teorici (valutati con dati 2026-10-15):
  - [x] **Valutato → Go ottimizzato, Rust non necessario.** Ricerca fuzzy e scansione workspace molto grandi — **nota:** la ricerca ha già worker pool e cap (`search.go`); valutare solo con dati che mostrano il collo di bottiglia.
  - [x] **Valutato → nessun hotspot nativo.** Diff su file molto grandi (`vcs_working_diff.go`): il backend legge solo i due blob (tetto 2 MB, `maxWorkingDiffBytes`); il confronto lo fa Monaco nel renderer, quindi un subprocess Rust non toccherebbe il costo reale.
  - [x] **Valutato → resta Go** (fingerprint/cache già misurati nella voce 9). Indicizzazione custom non fornita da gopls — **nota:** `workspace_graph.go` + `logindex` già in Go con cancellazione; ottimizzare Go prima (voce 9).
  - [x] **Valutato → nessuna lentezza emersa.** Parsing binario (`binary_inspect.go`): il costo è `go build` + `go tool nm`, già subprocess; nulla di nativo da sostituire.
- [x] Non adottato, quindi N/A. Se mai adottato: **subprocess isolato**, niente CGO né WASM senza motivazione misurabile.
- [x] **Rust non adottato in questo checkpoint**: i campioni del dependency graph mostrano soprattutto il costo dei subprocess evitato dalla cache (cold ~146,8 ms; hit ~2,15 ms). Fingerprint e ricerca richiedono prima profilo nativo controllato e ottimizzazioni Go; nessuna evidenza di vantaggio netto per un nuovo runtime. Rivalutare solo con hotspot documentati, non sulla base dei soli microbenchmark.

- **Dati (2026-10-15, i7-14700KF, Windows, `BenchmarkSearchProject` in `internal/goide/search_bench_test.go`; 10.000 file × 200 righe ≈ 80 MB):**

  | Scenario | Prima | Dopo |
  |---|---|---|
  | pattern raro (nessun tetto) | 375 ms · 137 MB alloc | 360 ms · 137 MB alloc (≈ 220 MB/s, dominato da walk + lettura file) |
  | pattern comune (tetto 2.000 risultati) | **599 ms · 2,95 GB alloc · 14,2 M alloc** | **12,5 ms · 11,9 MB · 77 k alloc** (−98% tempo, −99,6% memoria) |

  Il vero difetto era in Go: i worker continuavano a scansionare tutti i file anche a tetto già raggiunto. Ora si fermano (stesso ordine dei file e stesso troncamento, test `TestSearchProjectStopsAtResultCapInFileOrder`). Il caso residuo "raro" è limitato da I/O e walk del filesystem, non dalla CPU del matcher: Rust (toolchain assente in questa macchina: `cargo`/`rustc` non installati) non lo accelererebbe in modo netto, e costerebbe un secondo runtime in build, CI e distribuzione portabile.
- **Decisione finale voce 13: Rust NON adottato.** Rivalutare solo con un hotspot documentato su dati reali che resti dopo l'ottimizzazione Go.

**Criterio di accettazione:** adottare Rust soltanto se il vantaggio netto giustifica la complessità aggiuntiva.

---

### 14. Stabilità e prevenzione dei memory leak — `P2` · Stato: Parziale · Fattibilità: **Media**

> **Collegamento 2026-10-17:** i limiti di memoria per peso sono tracciati come **GS-18** in `mds/FIX.md` (history risposte con budget in byte + dedup `bodyBase64` fatti; spill file+anteprima, cap log inspector/GraphQL/HAR/flow recorder da fare come GS-18.6…GS-18.9), con il profilo completo nel registro (voce 15).

**Cosa esiste già** (non rifare):
- [x] `ProcessSupervisor` per le esecuzioni run-config con stato su disco e ripristino post-crash (`supervisor.go`).
- [x] `crashlock.go`: heartbeat 10 s + ID istanza, crash detection indipendente dal riuso PID.
- [x] Recovery buffer non salvati: 3 generazioni, hash di verifica, limiti 4 MiB/buffer, 200 buffer, 32 MiB totali, 14 giorni (`recovery.go`) — provato con kill reali (`recovery_kill_test.go`).
- [x] Kill ad albero cross-platform (`internal/ide/process`: `taskkill /T /F` su Windows, `kill(-pgid)` su Unix); test anti-orfani per il debugger (`debug_integration_test.go:280`).

**Mancante** (da fare):
- [x] **Sweep all'avvio dei processi orfani** ✅ *(fatto 2026-10-15, vedi voce 2)*: registro + sweep con identità PID+nome; copre gopls e debug adapter (dlv), i processi degli altri figli seguono la stessa strada con `process.RegisterManagedChild`.
- [x] **Windows Job Object valutato e implementato**: handle non ereditabile con `KILL_ON_JOB_CLOSE`, assegnazione best-effort dei figli registrati (gopls/DAP); sweep conservato se Windows nega l’assegnazione e per figli nati prima dell’assegnazione. Test reale: terminazione del proprietario senza cleanup → figlio terminato. Non comprende terminali o applicazioni indipendenti. [Semantica Microsoft](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- [ ] Suite completa di cicli prodotto (gopls, terminali, debug, DB/broker, finestre secondarie): ancora da eseguire in Wails.
  - [x] 15 cicli backend reali apertura/chiusura workspace + documento: cache dipendenze/grafo/builder, documenti e watcher tornano a zero, goroutine 4 → 4.
  - [x] 12 cicli Job Object/processo dopo warmup: handle Windows 112 → 112, nessun figlio superstite.
  - [x] 50 cicli nel test del lifecycle Monaco con registry simulato: nessun modello o timer residuo, una sola subscription; coperto anche il close/reopen prima del timer. Prova Monaco/WebView reale ancora aperta.
- [ ] Conteggio completo di file descriptor, worker JS e listener nell’app nativa ancora da completare. Automatizzati handle Windows, goroutine, cache/documenti/watcher, modelli/timer del test e terminazione figli; il report locale conserva l’output dei cicli.
- [x] Churn idle devLogs già corretto (registro voce 3); risolta la race del cleanup Monaco che distruggeva modelli riaperti prima del timer. Risolte anche le cache dei grafi trattenute dopo CloseSession, incluse risposte tardive; test funzionali + race detector verdi. Restano i cicli nativi sopra.

**Criterio di accettazione:** nessuna crescita di risorse non giustificata dopo il ritorno allo stato iniziale.

---

### 15. Performance budget — `P3` · Stato: Parziale · Fattibilità: **Alta** (dipende da voce 1)

- [ ] **RES-1 — Priorità richiesta P0, implementato; gate desktop aperto (2026-10-19).** GOMEMLIMIT backend modificabile a caldo e persistito (default morbido 512 MiB, ambiente esplicito preservato), gopls configurabile con riavvio del progetto selezionato, registrazione temporizzata CPU/RSS, grafici per processo, provenienza PID padre/owner e export JSON/CSV/MD/HTML. Test `internal/resources` anche con race detector, riavvio gopls reale con overlay conservato, confronto 1 GiB/768/512 MiB e dati OS: [report e grafico](../docs/performance/resources-2026-10-19.md). Il picco CPU del 50% non si è riprodotto nella baseline; nessuna causa dichiarata risolta. Verifiche native soltanto `RES-1.M1`–`RES-1.M3` in `MANUAL-CHECK.md`.
- [x] Budget esistente per il bundle di startup (650 kB, bloccante in CI) — voce 12.
- [ ] Definire la baseline con build release, hardware e condizioni controllate (voce 1) **prima** di fissare i target.
- [x] Target iniziali registrati in `docs/PERFORMANCE.md` come **proposti, non validati**. Report iniziale microbenchmark con hardware/toolchain/condizioni in `.artifacts/performance/phase-c16-initial/`; non sostituisce la baseline release nativa della voce 1:

> Tabella e protocollo canonici: [docs/PERFORMANCE.md — Proposed native budgets](../docs/PERFORMANCE.md#proposed-native-budgets--awaiting-controlled-release-baseline). I target restano in attesa della baseline nativa, non sono risultati raggiunti.

- [x] Vincolo documentato: nessun tetto assoluto di memoria per workspace prima di conoscere dimensioni reali e carichi.

---

### 16. Benchmark automatici e report — `P3` · Stato: Parziale · Fattibilità: **Media**

- [x] Benchmark Go esistenti (pochi e mirati): `release_performance_test.go`, `logindex/bench_test.go`.
- [x] Report locali, nessuna telemetria esterna (`startup-performance.jsonl`) — da mantenere.
- [x] Benchmark backend ripetibili per dependency graph cold/cache-hit, fingerprint 10/1000 file, apertura progetto/file e ricerca su 10/100/1000 file; fixture offline fuori dal tratto misurato. Eseguiti 3 campioni da 100 ms nel runner locale.
- [ ] Profilazione React degli scenari nativi della voce 1 ancora da completare. Disponibili ed eseguiti i microbenchmark Vitest 5 su `goStudioBenchmarkCompare` (10 campioni) e split persistenza (25 tab con body 250 kB), con mediana e statistiche locali; non sono misure input-to-render.
- [x] Runner `node scripts/benchmark-performance.mjs` con schema JSON v1, commit/dirty, hardware, condizioni, raw Go/Vitest, lifecycle e bundle; `--baseline report.json` produce confronti per unità e dashboard HTML locale. Deltas soppressi se hardware/toolchain/protocollo/condizioni non corrispondono. Report iniziale e follow-up generati; confronto di ripetibilità, non prova di miglioramento nativo.
- [x] Solo budget bundle bloccante per le prestazioni. Benchmark temporali manuali/advisory, nessuna soglia di timing aggiunta alla CI; test di rilascio risorse e invarianti funzionali distinti dalle misure di velocità.
- [x] Dashboard locale `index.html` generata dal runner: bundle, stato baseline, mediane per unità, delta compatibili e target nativi proposti. Nessuna telemetria o asset remoto.

---

## Ordine di implementazione (confermato e mappato)

**Fase A — Audit e quick win** → voci 1 → 3 → 9 → 2 → 4 → 5
(Profiling e baseline; re-render e churn idle; cache dependency graph e fingerprint; lifecycle gopls con sweep orfani; RPC ridondanti; editing/diagnostica.)

**Fase B — Scalabilità** → voci 8 → 7 → 6 → 10 → 11
(Watcher .gitignore; virtualizzazione estesa; Monaco residuo e misure; concorrenza/cancellazione; modalità idle centralizzata.)

**Fase C — Hardening** → voci 12 → 14 → 15 → 16 → 13
(Residui bundle/startup; leak e cicli; budget; benchmark automatici; **per ultimo** l'eventuale valutazione Rust, solo con dati.)

---

## Regole operative (per ogni task)

Prima di ogni modifica:
1. Leggere `CLAUDE.md`, l'architettura e i componenti coinvolti.
2. Verificare se l'ottimizzazione esiste già (le checklist sopra sono il primo controllo).
3. Identificare il collo di bottiglia con dati o prova riproducibile.
4. Proporre la modifica minima necessaria.
5. Implementare preservando API, funzionalità e UX.
6. Eseguire test pertinenti e benchmark comparativi.
7. Documentare risultati e possibili compromessi.

**Non implementare tutte le ottimizzazioni contemporaneamente.** Procedi in ordine di impatto, una modifica verificabile alla volta.

### Output richiesto per ogni attività

- Problema identificato.
- Evidenza e metrica iniziale.
- File interessati.
- Causa tecnica.
- Soluzione implementata.
- Test eseguiti.
- Risultato prima/dopo.
- Eventuali rischi o ottimizzazioni successive.

### Risultato finale

adOmnia deve risultare sensibilmente più leggera, reattiva e stabile, anche con più workspace e strumenti aperti contemporaneamente.
La priorità assoluta è **eliminare lavoro inutile**, non sostituire tecnologie che già funzionano correttamente.

---

## Verifiche di progetto da eseguire ad ogni checkpoint (da `AGENTS.md`)

```bash
cd frontend && npx vitest run <focused-test-files>   # per feature
npx tsc --noEmit                                     # se si tocca TypeScript
npm run build                                        # checkpoint UI
npm run check:startup                                # budget bundle di startup
go test ./internal/<dominio-cambiato>/...            # per feature backend
go build ./...                                       # checkpoint backend
go test -race ./internal/<dominio-cambiato>/...      # dove si tocca concorrenza
wails3 task dev                                      # verifica manuale UI/prodotto
```

L'ultima riga è la più importante: è un prodotto, non una libreria — aprire il pannello e usarlo come un utente reale prima di dichiarare concluso un task.

---

## Registro degli interventi

Formato richiesto dal piano: problema · evidenza · file · causa · soluzione · test · prima/dopo · rischi.

### 2026-10-15 — 1. Churn idle di `devLogs` (voce 3)

- **Problema identificato:** il poll backend dei log (1,5 s) notificava gli iscritti anche senza nuovi ingressi.
- **Evidenza / metrica iniziale:** test RED: 1 notifica per batch vuoto, 2 per batch di soli duplicati; `DevLogOverlay` re-render + `postMessage` alla popup a ogni tick anche a finestra ferma.
- **File interessati:** `frontend/src/stores/devLogs.ts`, `frontend/src/stores/devLogs.test.ts` (nuovo).
- **Causa tecnica:** `mergeBackendEntries` costruiva sempre un nuovo array `entries` (`[...s.entries]` + sort) e lo restituiva a `set`, quindi ogni tick cambiava il riferimento e i selector `s.entries` re-renderizzavano.
- **Soluzione implementata:** fast-path sui batch vuoti; bail-out di zustand (`return s`) quando nessun ingresso è realmente nuovo; sort spostato dopo il controllo.
- **Test eseguiti:** `vitest src/stores/devLogs.test.ts` — 5/5 (0 notifiche con batch vuoti/duplicati; 1 notifica per batch con nuovi ingressi; dedup echo frontend e cap 2000 invariati).
- **Risultato prima/dopo:** da ≥1 notifica per tick idle a 0; riferimento `entries` stabile quando non cambia nulla.
- **Rischi / successivi:** nessuno noto. Resta la voce "polling con gate di visibilità" (da fare).

### 2026-10-15 — 2. Re-render e analisi per battuta nei pannelli laterali (voci 3 + 5)

- **Problema identificato:** 3 pannelli si ridisegnavano a ogni battuta; uno di essi rianalizzava l'intero buffer a ogni carattere.
- **Evidenza / metrica iniziale:** sottoscrizioni grezze a `state.documents` (rigenerato da `updateDocument` a ogni keypress) in `GoStudioGoPanel`, `GoStudioContextPanel`, `GoStudioCloseGuard`; `analyzeContextPropagation(buffer)` in `useMemo([buffer])` = O(file) per carattere digitato.
- **File interessati:** `frontend/src/stores/goide.ts` (nuovi selector puri), `frontend/src/components/goide/GoStudioGoPanel.tsx`, `GoStudioContextPanel.tsx`, `GoStudioCloseGuard.tsx`, `frontend/src/stores/goideSelectors.test.ts` (nuovo).
- **Causa tecnica:** i componenti sottoscrivevano l'intero array `documents`, nuovo ad ogni battuta, anche quando serviva solo un path o l'insieme dei dirty.
- **Soluzione implementata:** selector puri `sessionGoIDEDocument` / `activeGoIDERelativePath` / `goIDEDirtyKey` / `goIDEDirtyDocuments` (primitiva o riferimento stabile); debounce 700 ms dell'analisi contesti (come `goStudioContextMarkers` per la stessa analisi) con aggiornamento immediato al cambio documento.
- **Test eseguiti:** `vitest src/stores/goideSelectors.test.ts` (4/4: stabilità della primitiva sotto churn dei buffer, chiave dirty), `goide.test.ts` (6), `devLogs.test.ts` (5), `goStudioContextAnalysis` + `GoStudioEditorTabs` + `goStudioSharedCopies` (21) — tutti verdi; `tsc --noEmit` pulito.
- **Risultato prima/dopo:** i tre pannelli passano da ~1 re-render per battuta a 0 (i GoPanel/CloseGuard) o a solo cambi del proprio documento; l'analisi contesti passa da 1 esecuzione per carattere a 1 per pausa di digitazione.
- **Rischi / successivi:** `GoStudioEditor`, `GoStudioWorkspace`, `DetachedStudioToolWindow` restano sottoscritti all'array (richiedono il refactor del flusso props dell'editor, coordinato con la voce 6); da verificare a mano con `wails3 task dev` (digitare in un file Go con i pannelli aperti).

### 2026-10-15 — 3. Cache del grafo dipendenze (voce 9 → 4)

- **Problema identificato:** ogni apertura del pannello Dependency Graph rilanciava tre comandi go (`go list -m -json all`, `go mod graph`, `go list -deps ./...`), fino a 30 s di timeout ciascuno.
- **Evidenza / metrica iniziale:** `internal/goide/dependencygraph.go:126-138` — nessuna cache, nessuna invalidazione; il frontend richiama il metodo a ogni apertura del pannello (`GoStudioDependencyGraph.tsx:55-63`).
- **File interessati:** `internal/goide/dependencygraph_cache.go` (nuovo), `internal/goide/dependencygraph.go`, `internal/goide/service.go` (campo `depGraph`, invalidazione in `filesChanged`), `internal/goide/dependencygraph_cache_test.go` (nuovo).
- **Causa tecnica:** il report è deterministico per (sessione, directory di modulo, binario go) finché i file del modulo e i sorgenti non cambiano, ma veniva ricalcolato ad ogni chiamata.
- **Soluzione implementata:** cache in memoria con chiave (sessione, directory, binario); stamp dei file determinanti (`go.mod`, `go.sum`, `go.work`, `go.work.sum`, binario go: dimensione + timestamp, inclusa la creazione/rimozione); invalidazione della sessione a ogni evento `filesChanged` (i sorgenti cambiano l'analisi `-deps`). Contratto Wails invariato.
- **Test eseguiti:** `go test ./internal/goide/ -run Dependency` (tutti verdi, incluso `TestDependencyGraphUsesCacheUntilFilesChange` che prova: cache-hit effettivo, ricalcolo vivo dopo modifica di `go.mod` (direct 2→3), invalidazione dal watcher); `go build ./...` pulito; suite completa `internal/goide` — unico fallimento `TestTerminalRenameIsKeptInList` per lock temporaneo su TempDir, **flaky confermato** (passa isolato, non correlato).
- **Risultato prima/dopo:** da 3 processi go per apertura a 0 quando nulla è cambiato; i dati restano freschi grazie a stamp + watcher.
- **Rischi / successivi:** nessuna single-flight per chiamate concorrenti equivalenti (possibile follow-up della voce 4); cache solo in memoria, si svuota al riavvio (come da piano: persistenza solo se utile).

> **Nota verifica manuale:** i tre interventi hanno test automatici verdi; la verifica prodotto con `wails3 task dev` (digitazione con pannelli aperti, doppia apertura del grafo dipendenze) resta da eseguire prima del checkpoint di integrazione.

### 2026-10-15 — 4. Bundle e startup (voce 12)

- **Problema / causa:** definizioni lazy duplicate, snapshot backup scritto nel renderer, round-trip JSON della cronologia; il primo frame non distingue la disponibilità dei controlli API.
- **File:** `components/layout/{MainArea,MainAreaRouter,lazyPanels}`, `hooks/useAppInit`, `lib/{startupBackup,startupPerformance}` e relativi test, `stores/tabs` e test snapshot, `scripts/benchmark-history-clone.mjs`; denylist e MCP già modificati nel working tree.
- **Soluzione:** registro lazy unico senza import eager; backup primario backend con identico schema e fallback legacy; clone nativo dei dati; metrica separata dopo commit/paint del workspace API idratato. Nessuna nuova persistenza cloud o modifica a workspace esportati.
- **Verifica:** 8 file / 26 test mirati verdi (startup backup, performance, idle; cronologia, persistenza, idratazione, preview, tool tab). `check:startup` verde prima/dopo, zero moduli vietati. `tsc` e `npm run build` NON verdi: errori esterni allo scope in `ResultsView.tsx`, `ValueCell.tsx`, `goStudioArchitecture.ts`; log locali `.artifacts/phase-c12-{types,build}.txt`. Nessun file di queste lavorazioni è stato modificato da questo intervento.
- **Prima/dopo:** startup graph 601.577 → 601.964 B (snapshot del working tree concorrente); clone body 1 MB su Node v22.14.0, 20 warmup + mediana 100 campioni: JSON 1,3493 ms → structuredClone 0,1963 ms. È un microbenchmark locale, non un dato WebView o un miglioramento dell'avvio nativo.
- **Rischi / residui:** `structuredClone` opera sui dati strutturati delle richieste/risposte, non su funzioni o nodi DOM. La vecchia copia backup locale resta leggibile; i nuovi backup desktop si leggono dal bucket `workspace`, chiave `backup`, attraverso StorageGet. Rimangono build integrata e prova Wails con workspace vuoto/popolato, avvii cold/warm, modifica richiesta ripristinata e navigazione fra pannelli. Nessuna accettazione manuale dichiarata completata.

### 2026-10-15 — 5. Residui bundle/startup: denylist CI e MCP (voce 12)

- **Problema identificato:** la denylist del budget di startup non copriva `yjs`, `y-monaco`, `@xterm/*`, `d3-force` (un import eager futuro non sarebbe stato intercettato); `stores/mcp.ts` serializzava le configurazioni due volte per salvataggio.
- **File interessati:** `frontend/scripts/check-startup-bundle.mjs`, `frontend/src/stores/mcp.ts`.
- **Soluzione implementata:** `deferredVendor` esteso alle librerie già lazy; `persistConfigs` serializza una volta e riusa la stringa per localStorage e backend. Verificato con `npm run check:startup`: 601.577 B / 650.000 B, zero moduli vietati nello startup.
- **Nota prodotto (backup workspace):** la voce "rimuovere la doppia serializzazione di `adomnia.workspace.backup`" NON è stata applicata: è una funzionalità utente (impostazione `backupWorkspaceOnStartup`, etichette i18n "Backup workspace all'avvio", fixture di contratto congelato in `docs/fixtures/collection-contract-freeze.v1.adomnia.json`). La sua scrittura è già differita a idle. All'epoca l'artefatto non aveva lettori nel codice: la **decisione di prodotto** è stata presa e implementata il 2026-10-15 — funzionalità **completata con ripristino** (registro "8. Decisione prodotto: backup di avvio completato con ripristino"). Correzione del registro: l'impostazione **non** era visibile in UI — le etichette i18n esistevano ma nessun toggle le usava.
- **Test eseguiti:** `npm run check:startup` (budget + denylist), test MCP/store esistenti immutati.
- **Rischi / successivi:** nessuno.

### 2026-10-15 — 6. Gate di visibilità dei poller e orologi (voci 3 + 11)

- **Problema identificato:** 15 poller UI continuavano a interrogare il backend ogni 0,5–3 s con la finestra nascosta; l'orologio della Hub scattava ogni secondo pur mostrando solo ore e minuti.
- **Evidenza / metrica iniziale:** `setInterval` senza gate in BrowserDebug (×3), DockerLab, Database, Kube (×2), Proxy (×3), TraceStudio, WebSocket, Mock, LargeFile, ThemePanel e nel sync dev log (`useAppInit`); solo 3 punti su 15 gestivano `document.hidden` (`goStudioRuntimeLens`, `ResourceStatus`, `DotArcade`).
- **File interessati:** `frontend/src/lib/visiblePolling.ts` (nuovo, con test), i 15 file dei poller, `WelcomePanel.tsx` (`useNow`), `GoStudioActivityBar.tsx`, `GoStudioSonarPanel.tsx`.
- **Causa tecnica:** interval creati a mano per ciascun pannello, nessun criterio condiviso di sospensione; orologio a tick fisso invece che allineato al contenuto mostrato.
- **Soluzione implementata:** `visibleInterval(callback, ms)` — salta i tick con `document.hidden` e aggiorna immediatamente al `visibilitychange` di ritorno; `minuteAlignedTimeout` per l'orologio della Hub. Ogni poller mantiene la propria cadenza e le proprie dipendenze; i processi, i terminali e i debug avviati dall'utente non vengono interrotti (voce 11: si sospendono solo le interrogazioni). Il liveness-check della popup dev logs è stato volutamente escluso (nessuna RPC).
- **Test eseguiti:** `vitest src/lib/visiblePolling.test.ts` (4/4: skip in hidden, refresh al ritorno, cleanup, timer allineato al minuto); `tsc` pulito su tutti i file toccati; suite dei store già verdi.
- **Risultato prima/dopo:** da ~15 interrogazioni periodiche continue a 0 con finestra nascosta e ripresa immediata alla vista; orologio Hub da 1 scatto/s a 1 scatto/min.
- **Rischi / successivi:** la modalità idle centralizzata (stati Active/Background/Idle/Suspended, voce 11) resta da progettare; questo intervento ne copre solo il prerequisito di visibilità.

### 2026-10-15 — 7. Sweep dei figli orfani e backpressure LSP (voci 2 + 14 + 10)

- **Problema identificato:** dopo un crash di adOmnia i figli gestiti (gopls, debug adapter/dlv) restavano vivi e nessuno li riconduceva (nessuna Windows Job Object, nessuno sweep); `MaxPendingLSPRequests = 128` era dichiarato e mai applicato.
- **Evidenza / metrica iniziale:** `internal/ide/process/adapter_windows.go` solo `taskkill /T /F` su richiesta esplicita; nessun tracciamento dei figli; `internal/ide/lsp/jsonrpc.go` accettava richieste illimitate (timeout 15 s ciascuna).
- **File interessati:** `internal/ide/process/managed.go` + `managed_lookup_{unix,windows}.go` + `managed_test.go` (nuovi), `internal/goide/managedchildren.go` + `managedchildren_test.go` (nuovi), `internal/goide/lsp.go` (registra/rlascia gopls + `SetPendingLimit`), `internal/ide/dap/manager.go` (registra/rlascia adapter), `internal/ide/lsp/jsonrpc.go` (cap), `internal/ide/lsp/jsonrpc_test.go`, `goide_bindings.go` (sweep all'avvio).
- **Causa tecnica:** i figli erano spawnati senza traccia persistente; l'unico meccanismo di crash-recovery (`crashlock.go`) copriva lo stato dell'app, non i processi figli.
- **Soluzione implementata:** registro JSON dei figli gestiti accanto al runtime lock (`managed-children.json`): gopls e debug adapter si registrano alla spawn e si rilasciano quando il processo muore. `goide.SweepOrphanChildren` (chiamato **prima** di `AcquireRuntimeLock`) termina i figli registrati ancora in vita, con identità **PID + nome eseguibile** (un PID riassegnato a un processo diverso viene risparmiato) e guardia che salta lo sweep se il runtime lock precedente ha heartbeat recente (altra istanza viva). Backpressure: `Conn.SetPendingLimit(MaxPendingLSPRequests)` — oltre 128 richieste in sospeso le nuove falliscono subito con `ErrTooManyPendingRequests`.
- **Test eseguiti:** `go test ./internal/ide/process/` (round-trip registro, selezione sweep con fake, **integrazione con processi reali**: orfano terminato, PID riassegnato risparmiato), `go test ./internal/goide/ -run "SweepOrphan|LSPRegisters|IdleLanguageServer"` (guardia sul lock, registrazione/release gopls, nessuna regressione sul ciclo idle), `go test ./internal/ide/lsp/` (cap pendenti), `go test ./internal/ide/dap/`, guardia `TestBackgroundProcessesUseProcutil` (i nuovi lookup usano `procutil`), `go build ./...`.
- **Risultato prima/dopo:** da figli orfani permanenti dopo crash a sweep certificato al prossimo avvio; da richieste LSP accumulate senza limite a fail-fast oltre 128.
- **Rischi / successivi:** se un PID venisse riassegnato a **un altro gopls** con lo stesso nome, lo sweep lo terminerebbe (caso raro e a basso danno); Windows Job Object con kill-on-close resta un'opzione di rinforzo (voce 14). Da verificare a mano con `wails3 task dev`: crashare l'app con Go Studio aperto e controllare al riavvio che gopls orfani vengano terminati nel log (`[goide] orphaned child processes terminated at startup`).

### 2026-10-15 — 5. Stabilità e lifecycle (voce 14)

- **Problema / evidenza:** CloseSession non rilasciava le cache del dependency graph, del workspace graph e dei mutex builder; un risultato tardivo poteva ricreare la cache. Cleanup Monaco differito senza ricontrollare i documenti correnti: close/reopen rapido → dispose di un modello nuovamente aperto. Lo sweep dei processi agiva soltanto all'avvio successivo.
- **File:** `internal/goide/{service,workspace,workspace_graph,dependencygraph,resource_cycles_test}.go`, `internal/ide/process/{managed,managed_job_*}.go`, `components/goide/goStudioModelUri{,.test}.ts`.
- **Soluzione:** rilascio delle tre cache a chiusura sessione e aggiornamenti in memoria serializzati con la rimozione della sessione; guardia Monaco al momento del cleanup; Job Object Windows per i figli gestiti, handle unico per vita dell'app e fallback sweep invariato. Contratti Wails e file persistiti invariati.
- **Test:** 15 cicli reali workspace/documento (risorse registrate tutte a zero; goroutine 4 → 4); 12 cicli processo dopo 3 warmup (handle 112 → 112); crash reale del proprietario Job Object → figlio terminato; 50 cicli registry Monaco simulato e race close/reopen. `go test -race ./internal/ide/process ./internal/goide -run 'SessionCycles|DependencyGraph|WorkspaceGraph|Job|Registry|Sweep' -count=1 -timeout 10m` verde. 32 test frontend mirati e `tsc` verdi; build frontend, startup 601.967 B e `go build ./...` verdi. Gli errori concorrenti annotati nel checkpoint precedente risultano risolti a questo checkpoint.
- **Prima/dopo:** cache senza percorso di rilascio → zero entry per sessione chiusa, anche con risultato tardivo; modello riaperto non più distrutto dal timer; figli gestiti arrestati anche al crash senza attendere lo sweep. I conteggi sono dei test dedicati, non dell'intera applicazione Wails.
- **Residui:** lifecycle nativo gopls/debug/terminali/DB/broker/finestre, listener e worker reali; eventuali rifiuti dell'assegnazione Job Object e discendenti nati prima dell'assegnazione restano coperti dal fallback, non da una garanzia totale di containment.

### 2026-10-15 — 6. Budget e report ripetibili (voci 15–16; decisione 13)

- **Problema:** benchmark sparsi senza un report comune dell'hardware, delle condizioni, del commit o della compatibilità del confronto; target non distinti dai risultati verificati.
- **File:** `internal/goide/release_performance_test.go`, `internal/ide/graph/bench_test.go`, `components/goide/performance.bench.ts`, `scripts/{benchmark-performance,performance-report,performance-report.test}.mjs`, `.gitignore`, `docs/PERFORMANCE.md`.
- **Soluzione:** runner locale seriale con lifecycle, benchmark Go (3 campioni), microbenchmark frontend CPU, guardia bundle; schema JSON v1 e dashboard HTML senza dipendenze/asset remoti. Confronto esplicito `--baseline`, nessun gate CI sulle durate. Report ignorati da Git; target nativi proposti restano non validati.
- **Evidenza iniziale:** Windows amd64, i7-14700KF, 28 CPU logiche, 68.539.883.520 byte RAM, Go 1.26.5, Node 22.14.0; postazione di sviluppo con carico esterno non controllato. Campioni dependency graph: mediana cold 146,8192 ms, warm 2,149756 ms. Questi sono scenari cold/cache-hit della cache già implementata, non confronto fra due versioni native.
- **Verifica:** runner iniziale completato con report in `.artifacts/performance/phase-c16-initial/`; parser/confronto: 2 test Node verdi; benchmark frontend e backend eseguiti realmente, raw e statistiche conservati. Il runner fallisce su test/build benchmark/budget falliti e salva `failure.txt`, senza dashboard di successo.
- **Esito Rust:** non adottato; la cache evita i comandi Go costosi e mancano hotspot nativi che giustifichino un subprocess/runtime aggiuntivo. Nessun vincolo di memoria assoluto introdotto.
- **Residui:** baseline release nativa controllata, CPU/RAM per componente, input-to-render/React Profiler, cold/warm Wails e prove prodotto. La dashboard li mostra come pending.

**Aggiornamento verifica finale del checkpoint:** suite frontend completa 332 file / 1.473 test verdi; build frontend verde. Confronto locale follow-up generato in `.artifacts/performance/phase-c16-followup/` con 41 metriche e baseline compatibile, JSON e 41 righe dashboard verificati. Il confronto dimostra il funzionamento del report su due esecuzioni della postazione, non un miglioramento fra release. La suite allargata IDE/Go Studio è registrata in `.artifacts/phase-c-final-go.txt`.

**Correzione del checkpoint esteso:** la prima suite `internal/goide` ha esposto `TestTerminalRenameIsKeptInList`: il test registrava `manager.Shutdown` prima di `t.TempDir`, quindi il cleanup LIFO provava a eliminare la working directory prima di fermare la shell. Corretta esclusivamente la fixture in `internal/goide/terminal_test.go` (TempDir prima del cleanup del manager). Il test reale passa 10 volte consecutive; non viene presentato come un leak del prodotto. Il retry completo è registrato in `.artifacts/phase-c-final-goide.txt`.

**Esito finale:** retry completo `go test ./internal/goide -count=1 -timeout 10m` verde; tutti i pacchetti `internal/ide/...` verdi nel checkpoint esteso. Suite frontend completa (1.473 test), build frontend, TypeScript, Go build e guardia startup verdi. Restano aperte esclusivamente le verifiche non eseguite descritte nelle checklist, senza promozione delle misure microbenchmark a baseline nativa.

### 2026-10-15 — 7. Modalità idle centralizzata (voce 11)

- **Problema / evidenza iniziale:** `visibleInterval` lasciava un interval vivo anche a finestra nascosta; politiche basate sulla sola `document.hidden`, senza riconoscere workspace nascosti, inattività prolungata o intento esplicito. Il campionatore risorse interrogava il backend ogni 2 s anche a finestra visibile ma inattiva. Nel layout split il focus tastiera non equivale alla visibilità.
- **File:** `internal/activity/manager{,_test}.go`, `activity_bindings.go`, wiring in `app.go` / `goide_bindings.go`; lifecycle `internal/goide/{lsp,lsp_idle,service_lsp}` e test; `stores/activity`, `lib/{activityTracking,activity-api,visiblePolling,goide-lsp-api}`, `hooks/useActivity`, `main.tsx`; scope/visibilità nei pannelli IDE, poller esistenti, Runtime Lens, risorse, arcade, updater/devcontext; etichetta tradotta `uiI18n`; bindings Wails rigenerati con CLI beta.28.
- **Soluzione:** un report per transizione/scopo, associato alla finestra nativa dal contesto Wails, con invii serializzati e coalescenti; input trusted riattiva solo lo stato locale e la deadline, senza RPC/notifiche per battuta. Uno stato Active in qualunque finestra visibile protegge il workspace backend. Policy sconosciute/esplicite non possono rilasciare risorse. Solo LSP automatici no-editor/no-pending passano per la sospensione già esistente; start/restart manuali sono protetti per default, anche se chiamati direttamente dai binding.
- **Verifica funzionale:** 46 test frontend mirati verdi (tracker, timer/policy, routing start automatico/esplicito, store LSP, traduzioni, analisi contesti, Runtime Lens); test Go activity + LSP con `-race` verdi; suite estesa `internal/activity`, `internal/ide/...`, `internal/goide` verde nel checkpoint (Go Studio 118,135 s); `go build ./...` verde. I test non sostituiscono interazioni native Wails.
- **Prima/dopo verificato nei test:** finestra Background da interval con tick scartati a zero timer; decorazioni da cadenza 500 ms a zero in Idle; status 1 s → 15 s in Idle (live invariati); orologio fermo per 30 minuti simulati senza timer residui; 100 input consecutivi in Active → zero notifiche store e nessuna RPC aggiuntiva. LSP helper: finestra attiva / avvio esplicito / documenti aperti impediscono lo stop, pin mantenuto dopo restart automatico, auto-idle rilascia il processo e dichiara Suspended solo dopo l’uscita; riapertura ripristina un processo, Stop manuale non si riavvia da solo.
- **Bundle:** snapshot startup 606.181 / 650.000 B, zero moduli vietati; working tree con modifiche concorrenti, nessun delta attribuito interamente a questa voce.
- **Checkpoint frontend globale:** la prima suite completa ha 1.645 test verdi e 1 fallimento nell'audit accessibilità (`GoStudioChangeSignatureDialog.tsx:72`, fuori scope). Build inizialmente verde, controlli successivi bloccati da modifiche concorrenti in `GoStudioStatusBar.tsx` e poi Database Studio (`ResultsView` / `aiQuerySuggest`); log `.artifacts/idle-{frontend-all,build,types}.txt`. Nessuna correzione di quelle lavorazioni inclusa in questa voce.
- **Compatibilità / residui:** nessuna migrazione storage o workspace, nuovi stati solo in memoria e nessuna telemetria. Hub vuota misurata realmente per oltre 30 minuti nella release Windows, con stato Idle confermato; restano dataset API/IDE e prove Wails con finestre/split, terminali, debug, richieste, registrazioni e ripresa delle interazioni. Registro completo in `MANUAL-CHECK.md`, REF-11.M1/M2/M3; non si generalizza il risultato Hub a questi scenari.
- **Checkpoint successivo:** `tsc --noEmit` verde; build frontend e controllo startup verdi (`idle-{build,startup}-final.txt`); build Windows di produzione `wails3 task build` verde (`idle-native-build.txt`). Nuova suite globale: 1.704 test verdi / 1 fallimento sul contratto CSS di `Rail.test.ts`, fuori scope. Registratore nativo esteso con snapshot attività, senza timer aggiuntivi; test `internal/perf` + `internal/activity` con race detector verdi, 7 test report Node verdi. Evidenze desktop e misure nel registro `MANUAL-CHECK.md`, voce REF-11.

### 2026-10-15 — 8. Decisione prodotto: backup di avvio completato con ripristino (nota voce 12)

- **Problema identificato:** `adomnia.workspace.backup` (e la copia backend `workspace/backup`) veniva scritto all'avvio ma **nessun codice lo leggeva**; l'impostazione `backupWorkspaceOnStartup` era nello store senza alcun toggle in UI (le etichette i18n esistevano ma nessun componente le usava) e la descrizione prometteva "una copia .adomnia" che il formato snapshot (solo collections + environments) non è.
- **Evidenza / metrica iniziale:** zero `StorageGet('workspace', 'backup')` nel codebase; zero usi di `s.general.backupWorkspace*` nei componenti; snapshot senza `activeEnvId`, quindi non ripristinabile in modo fedele.
- **Decisione di prodotto (2026-10-15):** completare la funzionalità con il ripristino (alternativa valutata: rimozione).
- **File interessati:** `frontend/src/lib/startupBackup.ts` (+ `startupBackup.test.ts`), `frontend/src/hooks/useAppInit.ts`, `frontend/src/components/workspace/WorkspacePanel.tsx`, `frontend/src/components/settings/SettingsPanel.tsx`, `frontend/src/lib/i18n.ts`.
- **Causa tecnica:** funzionalità implementata fino alla sola scrittura (checkpoint bundle voce 12), mai completata sul lato lettura; l'interfaccia dell'impostazione non era stata cablata.
- **Soluzione implementata:** builder condiviso `buildStartupBackupSnapshot` (aggiunto `activeEnvId` alla cattura); `parseStartupBackup` con validazione formato + versione 1.x (payload 1.0 legacy senza `activeEnvId` restano leggibili, 2.x rifiutate); `readStartupBackup` con precedenza backend e fallback alla chiave legacy; azione **Restore from startup backup** nel Workspace panel con modale di conferma, data/conteggi dello snapshot, ripristino via `applyWorkspaceState` (solo collections + ambienti; tabs e flows invariati) e annullabile con l'undo esistente; toggle nelle Impostazioni con le etichette i18n già presenti; descrizioni EN/IT allineate al comportamento reale. Contratti Wails, formato persistente e fixture freeze invariati.
- **Test eseguiti:** `vitest src/lib/startupBackup.test.ts` 9/9 (persist backend/fallback/errore di serializzazione invariati; builder; parse 1.0 legacy; rifiuto payload malformed/estranei/2.x; precedenza backend sul fallback; fallback browser; nessun backup valido → null); suite mirata i18n/stores/hooks 24/24; `tsc --noEmit` pulito.
- **Risultato prima/dopo:** da artefatto scritto e mai letto a backup ripristinabile con conferma e undo; da impostazione invisibile e incontrollabile a toggle nelle Impostazioni; da promessa "copia .adomnia" inesatta a descrizione onesta (snapshot di collections e ambienti).
- **Rischi / successivi:** lo snapshot è unico e viene sovrascritto al successivo avvio (come prima): non è una cronologia; il ripristino sostituisce solo collections e ambienti per contratto; verifica manuale con `wails3 task dev` (toggle, ripristino, undo) da eseguire prima del checkpoint di integrazione.

### 2026-10-15 — 9. Strumentazione di baseline e profiling (voce 1)

- **Problema identificato:** nessun autoprofiling Go dell'app, nessuna registrazione metrica temporale per scenario e nessun report separato per componente: la baseline nativa richiesta dai budget proposti non era raccogliere con gli strumenti del progetto.
- **Evidenza / metrica iniziale:** nessun endpoint pprof dell'app (le catture esistenti in `goide/pprof_capture.go` servono i processi utente); `internal/resources.Sample` restituiva solo la fotografia istantanea senza persistenza; il piano elencava 9 scenari senza harness di misura.
- **File interessati:** `internal/perf/{pprof,recorder}.go` + test (nuovi), `perf_bindings.go` (nuovo), `app.go` (wiring avvio/arresto), `frontend/src/lib/inputLatency.ts` + test (nuovi), `frontend/src/hooks/useAppInit.ts`, `scripts/perf-scenario-report.mjs` + test (nuovi), `docs/PERFORMANCE.md`.
- **Causa tecnica:** la voce 1 presuppone strumentazione prima delle misure; nessuno strumento esistente copriva autoprofiling, campionamento temporale dell'albero processi o aggregazione per componente.
- **Soluzione implementata:** (1) pprof dev-only via `ADOMNIA_PPROF` su loopback (`127.0.0.1:6069` di default) con rifiuto esplicito di indirizzi non loopback; (2) recorder JSONL locale `<dataDir>/perf/<scenario>-<stamp>.jsonl` (permessi 0600/0700) con runtime Go + albero processi per RAM/CPU, opt-in `ADOMNIA_PERF_SCENARIO`/`ADOMNIA_PERF_INTERVAL`/`ADOMNIA_PERF_DURATION`, skip dei campioni cache, metriche frontend dei campioni successivi; (3) latenza input keypress→paint (doppio rAF) solo durante la registrazione, finestra 5 s, coda limitata; (4) aggregatore `scripts/perf-scenario-report.mjs` con report `kind: native-scenario-baseline` per componente (`backend-go`/`webview2`/`gopls`/`debug-adapter`/`other-children`) e tabella markdown; (5) protocollo completo dei 9 scenari in `docs/PERFORMANCE.md`. Nessuna nuova dipendenza (gopsutil già presente), nessun dato fuori dalla macchina, contratti Wails esistenti invariati: i due nuovi metodi `main.App.Perf*` sono chiamati dal renderer via `Call.ByName` in attesa della prossima rigenerazione dei binding.
- **Test eseguiti:** `go test ./internal/perf/ -count=1` 10/10 — inclusa registrazione reale con processo figlio (albero processi, RAM, campioni multipli, doppio Stop pulito, sanificazione nome scenario, metriche frontend, parsing env) e pprof (disabilitato/attivo/rifiuto non-loopback con GET reale); `go build ./...` e `go vet` puliti; `vitest src/lib/inputLatency.test.ts` 3/3 e `startupBackup.test.ts` 9/9; `tsc --noEmit` pulito; `node --test scripts/perf-scenario-report.test.mjs scripts/performance-report.test.mjs` 7/7 (classificazione componenti, parsing con BOM, aggregati runtime/frontend, rifiuto righe malformate, tabella); smoke CLI end-to-end su registrazione JSONL con report per componente generato; `npm run check:startup` verde: 605.439 / 650.000 B, zero moduli vietati, modulo `inputLatency` fuori dal grafo di startup (import dinamico dopo il primo frame stabile).
- **Risultato prima/dopo:** da zero strumentazione di baseline a pipeline completa *registrare → aggregare → report per componente* con anche latenza input; il criterio di accettazione della voce 1 (misure separate per backend Go, WebView2, gopls e processi figli) è ora ottenibile con un comando per scenario.
- **Rischi / successivi:** i numeri nativi **non sono ancora raccolti** — servono esecuzioni della suite sul target con build release secondo il protocollo (tabella vuota e target proposti non validati finché non viene eseguita); frame persi e tracce input-to-render complete restano manuali via React Profiler / Chrome Performance come previsto dal piano; alla prossima rigenerazione dei binding Wails i due metodi `Perf*` compariranno anche nei binding generati; nessun claim di CPU/RAM senza run nativo.

### 2026-10-15 — 10. Valutazione Rust chiusa con dati e fix della ricerca (voce 13 → 8/10)

- **Problema:** la ricerca progetto (`SearchProject`) continuava a leggere e scandire tutti i file anche dopo aver raggiunto il tetto di 2.000 risultati: 599 ms e 2,95 GB di allocazioni su 10.000 file con un pattern comune.
- **Soluzione:** contatore atomico dei risultati; i worker saltano i file successivi e il dispatcher smette di inviare candidati a tetto raggiunto. Ordine dei file e flag `Truncated` invariati.
- **Misure:** `go test ./internal/goide/ -run '^$' -bench BenchmarkSearchProject -benchtime 3x -benchmem` → pattern comune 599 → 12,5 ms, 2,95 GB → 11,9 MB; pattern raro invariato (~360 ms, I/O-bound).
- **Verifica:** `go vet ./internal/goide/`, `go test -count=1 -run Search ./internal/goide/` verdi (test nuovo sul tetto e sull'ordine).
- **Esito Rust:** non adottato (vedi voce 13): nessun hotspot CPU nativo residuo, `vcs_working_diff` non ha costo backend, toolchain Rust assente.

### 2026-10-15 — 11. LSP incrementale, richieste superate e valutazione condivisione (voci 2/5)

- **Implementazione:** helper generici `internal/ide/lsp/{incremental,supersede}.go`, negoziazione sync in `internal/goide/lsp{,_editor}.go`, delta in `lsp_documents.go`, letture sostituibili in `lsp_features.go`/`lsp_editor.go`. Ordine didOpen/change/close/replay serializzato con mutex documenti separato: nessun lock di stato durante scritture sul pipe, per non bloccare callback del server. Nessuna modifica a storage o firme Wails, nessuna dipendenza nuova.
- **Test:** ricostruzione del testo su 2.000 coppie Unicode/CRLF, offset UTF-16 e inserimento da un carattere su buffer da 130 kB; negoziazione None/Full/Incremental, rifiuto versioni obsolete, isolamento URI fra sessioni. Wire JSON-RPC: cancelRequest corretto, risposta tardiva ignorata, altri documenti e rename preservati, nessuna richiesta pendente residua. Test writer controlla che il mutex dello stato non sia trattenuto durante l’I/O.
- **gopls reale:** v0.23.0 già installato, test opt-in `ADOMNIA_TEST_GOPLS`, GOPROXY/GOSUMDB off e GOTOOLCHAIN local: delta con emoji/CRLF int→string→int, versione e replay dopo restart; due overlay int/bool sullo stesso file/root restano isolati, Stop della seconda sessione non interrompe la prima. Test con race detector verde (`.artifacts/lsp-real-gopls.txt`).
- **Checkpoint:** suite `go test ./internal/ide/... ./internal/goide -count=1 -timeout 10m` verde (goide 118,475 s); test mirati con `-race` verdi; 16 test frontend di sync/store/routing LSP verdi. `go vet ./internal/ide/lsp ./internal/goide` e `go build -o NUL .` verdi. Log `.artifacts/lsp-{integration-tests,incremental-race,vet,build}.txt`.
- **Condivisione:** valutazione conclusa, non attivata. La modalità daemon ufficiale separa sessioni/view mantenendo cache comune; per adOmnia servirebbe un owner del daemon distinto dai processi di sessione (anche rispetto ai Job Object Windows), compatibilità SDK/configurazione e prove di crash/ultimo detach. Nessuna condivisione basata solo su root/refcount.
- **Residuo prodotto:** REF-2.M1 in `MANUAL-CHECK.md`: editing/completamento rapido, più finestre, restart e verifica assenza di errori visibili per cancellazioni attese. La prova gopls reale è backend e non chiude la verifica Wails né dimostra una riduzione misurata della latenza di digitazione.

### 2026-10-15 — 11. Chiusura delle voci di codice residue (voci 2, 3, 4, 5, 8, 9, 10)

- **Ricerca (voce 13 → 8):** tetto di risultati rispettato dai worker, 599 → 12,5 ms e 2,95 GB → 11,9 MB (vedi registro 10).
- **Watcher/ricerca/quick open (voce 8):** `.gitignore` di radice (`project.LoadGitIgnore`), elenco cartelle sempre escluse esteso, test rename.
- **Grafo workspace (voci 4/9):** `graphFreshness` evita il re-walk dell'albero quando il watcher non ha visto modifiche rilevanti.
- **Git (voce 4):** timeout su `runGit`/`runFull`/`runFullWithEnv` (prima assenti); guardia `refArg` sui nomi di branch (anche `RebaseBranch`).
- **Single-flight (voci 4/9):** `internal/ide/flight`, usato da `DependencyGraph`.
- **Frontend (voci 3/5):** `EventRow` e righe chat in `memo`, `useLiveCore` senza `queries`/`messages`, dedup delle diagnostiche identiche, test sul riuso dei modelli Monaco al cambio tab, toast di successo nell'IDE (`stores/goideToast.ts`).
- **Verifiche:** `go vet ./...`; `go test -count=1 ./internal/goide/ ./internal/git/ ./internal/ide/... ./internal/languages/...`; `go test -race` sugli stessi pacchetti IDE; `npx tsc --noEmit`; `npx vitest run` (351 file); `npm run build`; `npm run check:startup`. Aggiornato `Rail.test.ts` (guardia a 44 px dopo la modifica GS-6.9 ai pulsanti del rail).
- **Ancora aperto (richiede l'app nativa/misure):** baseline per componente (voce 1), `GOMEMLIMIT` empirico, sottoscrizioni grezze di `GoStudioEditor`/`Workspace`, misure CPU idle 5/15/30 min, heap JS su cicli di apertura/chiusura, profilazione React degli scenari nativi, suite cicli prodotto in Wails, conteggio FD/worker, baseline con build release.

### 2026-10-15 - 12. Albero del progetto coerente con `.gitignore` (voce 8, completamento)

- **Problema identificato:** il filtro `.gitignore` della voce 8 copriva watcher, ricerca e quick open ma **non l'albero del progetto**: `ListDirectory` segnava solo le cartelle dell'elenco fisso (`isIgnoredDirectory`), quindi `out/`, `target/` e simili restavano nell'albero mentre erano esclusi ovunque altrove.
- **Evidenza / metrica iniziale:** test RED `TestListDirectoryHonoursGitIgnore`: con `.gitignore` = `out/` + `*.log`, `ListDirectory` restituiva `[out .gitignore main.go x.log]`.
- **File interessati:** `internal/goide/documents.go` (`ListDirectory`), `internal/goide/documents_test.go` (test nuovo).
- **Causa tecnica:** `ListDirectory` usava solo `isIgnoredDirectory(name)` (per nome, e solo sulle cartelle); il matcher `project.GitIgnore` era già caricato dal watcher (`gitIgnored`) ma non consultato dalla lettura dell'albero. Inoltre il parametro `project Project` oscurava il package `project`.
- **Soluzione implementata:** `ListDirectory` carica il `.gitignore` della radice (`project.LoadGitIgnore`) e marca ogni voce con `gitIgnored`, come il watcher. Convenzione UX preservata: le **cartelle** ignorate restano nascoste salvo "mostra ignorati" (come già per `node_modules`/`build`), i **file** ignorati restano visibili ma marcati/attenuati (`.env` è spesso in `.gitignore` e deve restare raggiungibile dall'albero). Parametro rinominato `proj`.
- **Test eseguiti:** `TestListDirectoryHonoursGitIgnore` verde; `TestDirectoryIsLazyAndQuickOpenIsBounded` invariato; suite completa `go test ./internal/goide/` verde (96 s).
- **Risultato prima/dopo:** prima 4 voci con 2 artefatti non marcati (`out`, `x.log`); dopo albero = `[.gitignore main.go x.log]` con `x.log` marcato, `out`/`node_modules` nascosti e recuperabili marcati con la flag.
- **Rischi / successivi:** i `.gitignore` annidati restano fuori scope (scelta documentata di `project.GitIgnore`); nessun cambiamento per progetti senza `.gitignore`; frontend e TypeScript non toccati.

### 2026-10-15 - 13. Banner "aperto anche altrove" senza ricalcolo per battuta (voce 3)

- **Problema identificato:** `GoStudioEditor` ricalcolava `copiesInOtherSessions(allDocuments, active)` a ogni battuta (il banner delle copie sporche in altri progetti).
- **Evidenza / metrica iniziale:** il calcolo era inline nel body del componente, con dipendenza dall'oggetto `active` (nuova identità a ogni carattere): filtro + ricerca sessione per ogni render dell'editor.
- **File interessati:** `frontend/src/components/goide/goStudioSharedCopies.ts` (`copiesForKey`, delegata da `copiesInOtherSessions`), `frontend/src/components/goide/GoStudioEditor.tsx`, `frontend/src/components/goide/goStudioSharedCopies.test.ts`.
- **Causa tecnica:** nessun `useMemo`, e una memoizzazione naive su `[allDocuments, active]` sarebbe comunque ricaduta a ogni battuta perché `active` cambia identità a ogni modifica del buffer.
- **Soluzione implementata:** estratta la chiave (`path`, `sessionId`, `readOnly`) in `copiesForKey`; `useMemo` sulle sole dipendenze primitive (`allDocuments`, path, sessione, readOnly). API pubblica invariata (`copiesInOtherSessions` delega).
- **Test eseguiti:** `goStudioSharedCopies.test.ts` 4/4 verdi (2 nuovi: risultato stabile a parità di chiave, read-only senza oggetto documento).
- **Risultato prima/dopo:** da filtro per render a nessun ricalcolo quando il documento cambia solo nel buffer; il banner si aggiorna solo al cambio di documento/dirty/salvataggio.
- **Rischi / successivi:** la riga `elsewhereNames` resta inline (map su pochi elementi); voce collegata 107 (sottoscrizioni grezze) non toccata.

### 2026-10-15 - 14. Finestra a coda per la Run console (voce 7)

- **Problema identificato:** la Run console disegnava tutte le righe fino al cap di 5.000: con output intenso ogni chunk riconcilia fino a 5.000 righe (con segmenti ANSI) nel DOM.
- **Evidenza / metrica iniziale:** `visibleLines.map(...)` in `GoStudioRunPanel.tsx` montava l'intero tail cap; righe ad altezza variabile (`whitespace-pre-wrap break-all`), quindi la virtualizzazione a misura di `EventList` non è applicabile senza misurare (vincolo del piano: niente virtualizzazione complessa, nessuna libreria).
- **File interessati:** `frontend/src/components/goide/goStudioConsoleWindow.ts` (nuovo, puro), `goStudioConsoleWindow.test.ts` (nuovo), `GoStudioRunPanel.tsx`.
- **Causa tecnica:** il cap era sull'intero buffer disegnato, senza una finestra scorrevole: o 5.000 righe nel DOM o la perdita dell'accesso alle righe vecchie.
- **Soluzione implementata:** finestra a coda (1.000 righe iniziali) con pulsante "… earlier lines not shown · show more" che allarga la finestra di 1.000 fino al cap (5.000); con la ricerca attiva la finestra si apre al cap per non nascondere i match vecchi. Il buffer completo (4 MB) resta per Copy e ricerca. Nessuna misurazione e nessuna dipendenza; il prepend in cima non sposta lo scroll (`overflow-anchor` nativo in WebView2/Chromium).
- **Test eseguiti:** `goStudioConsoleWindow.test.ts` 3/3 (capienza, coda + crescita controllata, ricerca aperta); suite `src/components/goide` 111 file / 498 test verdi; `npx tsc --noEmit` pulito.
- **Risultato prima/dopo:** da fino a 5.000 righe sempre montate a 1.000 di default (5× di meno), fino a 5.000 solo a richiesta esplicita.
- **Rischi / successivi:** `parseLines` ricostruisce gli oggetti riga a ogni chunk (resta delle voci 3/7: rendere righe stabili abiliterebbe anche il memo delle righe); le righe dei build step non sono toccate.

### 2026-10-15 - 15. Task lunghi con scarto stale e cancellazione (voce 10, "cancellare i task obsoleti")

- **Problema identificato:** i task lunghi (scansione Sonar, `go list` delle dipendenze, versioni dal GOPROXY, grafo/aggiornamenti/vulns delle dipendenze) non seguivano il modello di `stores/goideLsp.ts` (scarto stale + cancel): i risultati di richieste superate arrivavano tardi e sovrascrivevano lo stato, e il lavoro backend continuava dopo cambio cartella/sessione o chiusura del pannello.
- **Evidenza / metrica iniziale:** audit mirato: `GoStudioSonarPanel.tsx` (`runScan`/`refresh` facevano `setResult(await …)` senza token né cancel), `GoStudioDependencies.tsx:34` (`setState(await listGoIDEDependencies(...))` anche dopo il cambio cartella), `GoStudioDependencyGraph.tsx` (`load`/`checkUpdates`/`scanVulns` idem). Il backend era già cancellabile (`RunSonarScan(ctx)` con `procutil.CommandContext`, `waitSonarTask` su `ctx.Done()`): mancava solo il frontend.
- **File interessati:** `lib/goide/goStudioStaleRequest.ts` (nuovo, puro: `RequestEpoch`, `cancelInFlight`), `goStudioStaleRequest.test.ts` (nuovo); `lib/goide-api.ts` (8 wrapper lunghi ora restituiscono la `CancellablePromise` del binding); `GoStudioSonarPanel.tsx`, `GoStudioDependencies.tsx`, `GoStudioDependencyGraph.tsx`.
- **Causa tecnica:** i wrapper `async` nascondevano il metodo `cancel()` della `CancellablePromise` di Wails; i componenti non avevano né token di generazione né riferimento alla richiesta in corso.
- **Soluzione implementata:** modello uniforme — un `RequestEpoch` per flusso (le richieste superate vengono scartate per token), `cancelInFlight` alla nuova richiesta, al cambio sessione e allo smontaggio; `cancel()` annulla il ctx Go, quindi il subprocess sonar e `go list` si fermano davvero. Nessuna dipendenza nuova.
- **Test eseguiti:** `goStudioStaleRequest.test.ts` 5/5 (token stale, invalidazione, cancel una sola volta, idempotente); suite `src/components/goide` + `src/lib` + `src/stores` = 309 file / 1386 test verdi; `npx tsc --noEmit` pulito.
- **Risultato prima/dopo:** da risultati obsoleti che sovrascrivevano lo stato e lavoro backend che proseguiva a vuoto → scarto per token e cancellazione propagata fino a `procutil.CommandContext` e alle richieste HTTP.
- **Rischi / successivi:** il `load()` della configurazione sonar (breve) resta senza cancel; `securityExposures` e le scansioni del pannello Security sono ora cancellabili ma i relativi componenti non sono stati ristrutturati (stesso schema, follow-up); nessun cambiamento di UX visibile.

### 2026-10-16 — 13. Dedup diagnostiche prima del trasporto (voce 5)

- **DONE — implementazione e test automatici:** firma SHA-256 del report normalizzato e limitato per URI; ripubblicazioni identiche non creano timer o eventi Wails. Il backend mantiene comunque l'ultima diagnostica completa. La firma include identità del documento e percorsi, viene rimossa quando gli errori si svuotano e azzerata su stopped/crashed per consentire la ripubblicazione al restart. Si conserva una firma soltanto per URI con diagnostiche non vuote.
- **Evidenza prima/dopo:** `TestDiagnosticsDeduplicateContentButPreserveClearAndReopen` falliva per timer/eventi duplicati; ora verde con `go test -race ./internal/goide -run TestDiagnostics -count=1`. 100 report identici → zero timer/eventi aggiuntivi; normalizzazione dei codici senza perdere dati backend, nuova identità, clear e restart preservati. Test esistente throttle/cap ancora verde. Log locali `.artifacts/diagnostics-dedup-{before,after}.txt`.
- **Manuale separato:** REF-2.M2 in `MANUAL-CHECK.md` resta aperta; non si dichiara verificata la UI desktop.

### 2026-10-16 — 14. Checkpoint di pubblicazione develop

- **Build e automatici:** Windows production Wails beta.28 verde con binding rigenerati; 1.717 test frontend / 353 file verdi; Go completo verde con `go test -p 4 ./... -count=1 -timeout 10m`; 9 test report Node verdi. Startup 605.567 / 650.000 B, nessun modulo differito nel grafo iniziale. Stato aggiornato CLI/milk/OTLP ricontrollato con test mirati verdi.
- **Affidabilità dei test:** mantenute vive le connessioni accettate OTLP e invalidata la cache socket per ogni fixture con nuove porte (20 ripetizioni con race detector verdi, GC esplicito); test isolamento PTY su Windows con cmd, evitando che i suggerimenti della cronologia PSReadLine simulino output incrociato (5 ripetizioni verdi). Nessuna asserzione disattivata o soglia allentata. Il test AI temporale fallito sotto carico passa invariato in isolamento e nella suite finale.
- **Confini:** build verificata su Windows; nessuna nuova attestazione di accettazione manuale o di build Linux/macOS. Le prove di `MANUAL-CHECK.md` e la review indipendente restano aperte. Profili, eseguibili di prova e log locali sotto `.artifacts/` esclusi dal versionamento.

### 2026-10-17 - 15. Cache per peso e doppioni dei body (profilo + fix)

- **Profilo (la richiesta era "profilare: non è detto che le duplicazioni esistano davvero"):**
  - **REALI:** (a) la history risposte era tagliata **solo per numero** (default 20, max 100) con voci fino a 50 MB (`stores/tabs.ts` + `internal/httpexec/execute.go:228`); (b) ogni risposta teneva `body` **e** `bodyBase64` — doppione incondizionato ~2,4×, clonato in history e persistito in 3 payload, con **un solo consumatore** (`ResponsePanel.responseBytes` per il preview binario); (c) la ricerca nella history materializzava copie intere del body per ogni battuta (`RequestHistoryPanel.tsx:31-42`); (d) log inspector con 200.000 eventi e sorgenti indicizzate solo per conteggio (`bytes` già tracciato ma inutilizzato); (e) cache GraphQL con 40 schemi di introspection (MB) per conteggio; (f) viewer HAR senza alcun limite (flag `_heavy` >512 KB già presente); (g) flow recorder con alberi completi dei body per la durata della registrazione.
  - **NON ESISTENTI / già a posto:** `formatResponseAuto` e `responseMaxRenderSizeKB` **non creano copie** (il primo cambia vista, il secondo limita solo il rendering); traffico proxy già troncato per byte (32/64 KB) con cap 500; `goide/history.go` già 2 MB/revisione + 32 MB totali; console run 4 MB (`MAX_CONSOLE_BYTES`); storia collab 6 MiB; mock e browser-debug solo metadati (body su richiesta); scrollback terminali e anelli piccoli per conteggio sono adeguati.
  - **Ciclo di vita body:** la catena di trasporto (byte Go → stringa → base64 → JSON del bridge → `body`+`bodyBase64` JS) è strutturale del bridge Wails; il costo persistente era il doppione, non il transitorio.
- **DONE — implementazione e test automatici:** `lib/responseMemory.ts` con `responseWeight`, `trimHistoryByWeight` (budget numero **e** byte, "il più recente resta sempre"), `isTextualResponse`/`dropRedundantBodyBase64` e `HISTORY_SEARCH_EXCERPT_CHARS`; `stores/tabs.ts` tratta la history con `trimHistory` (budget `requests.maxResponseHistoryMB`, nuovo campo, default 16 MB, in Settings → Requests) e perde il doppione base64 in lettura; `sendRequest.ts` non lo crea più sui testuali; `RequestHistoryPanel` cerca su estratto di 32k; `ResponsePanel.responseBytes` ricodifica UTF-8 corretta senza base64. Test: `responseMemory.test.ts` 7 + suite completa 368 file / 1812 test verdi; `npx tsc --noEmit` pulito.
- **Follow-up documentati (non fatti):** file locale + anteprima per i body oltre soglia (pattern pronto: `safeStoragePut` per lo spill e `goide/history.go`/`logindex` come modello metadata+on-demand); cap in byte per log inspector, cache GraphQL, HAR, flow recorder; i parse ripetuti per render di `ResponsePanel` restano alla voce 3 (re-render).
- **Manuale separato:** GS-18 in `MANUAL-CHECK.md` (memory, preview binario, ricerca) resta aperta.
