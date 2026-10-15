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
| 13 | Valutazione Rust | **P2** | Da dimostrare | Bassa | ? | — (solo valutazione) |
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
- [ ] Endpoint pprof **dell'app stessa** (opzionale/dev-only, bind su 127.0.0.1): oggi non c'è autoprofiling Go (heap, goroutine, CPU).
- [ ] Suite di scenari ripetibili come da piano: avvio freddo/caldo · Hub senza workspace · Go Studio progetto piccolo e grande · 3-5 workspace contemporanei · digitazione continua + completamento + diagnostica · file grandi / JSON complessi · cambio rapido moduli/tab · 10 cicli apertura/chiusura progetto · idle 5/15/30 min.
- [ ] Metriche per scenario: CPU, RAM privata/RSS, heap, goroutine, processi figli, latenza RPC, frame persi, latenza input.
- [ ] Report baseline separato per backend Go / WebView2 / gopls / processi figli (strumenti: pprof, runtime trace, React Profiler, Chrome Performance, Windows Performance Counters).
- [ ] Documentare il report in `mds/` (o `docs/PERFORMANCE.md`) come riferimento stabile.

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
- [ ] **Condivisione gopls per workspace**: oggi due sessioni sullo stesso root = due processi (`lspKey` è per sessione). Valutare key per `Project.RealPath` con refcount.
- [ ] Valutare la sospensione con editor aperti ma inattivi (oggi deliberatamente esclusa: `lsp_idle.go:15` non sospende con documenti aperti/dirty). Decisione da prendere con dati: se i buffer restano preservati il rischio è basso.
- [ ] Applicare `GOMEMLIMIT` con verifica empirica (profilare heap gopls sotto carico; oggi il valore è statico e non validato).
- [ ] Sincronizzazione documenti **incrementale**: oggi `didChange` invia sempre il testo intero (`lsp_documents.go:84-87`). Introdurre content-change incrementali (o almeno un diff a riga) per payload ridotti su file grandi.
- [ ] Cancellazione richieste LSP superate (supersede): oggi solo timeout fisso (15 s, `lsp.go:27`) + `$/cancelRequest` a scadenza (`internal/ide/lsp/jsonrpc.go:125-157`). Un nuovo completamento dovrebbe cancellare il precedente.
- [ ] Evitare riavvii per cambiamenti irrilevanti (verificare che `filesChanged` → `NotifyWatchedFiles` non causi re-init).

**Criterio di accettazione:** nessun processo gopls duplicato o orfano (anche dopo crash), riattivazione affidabile, riduzione misurabile del consumo a inattività.

---

### 3. Riduzione dei re-render React — `P0` · Stato: Parziale · Fattibilità: **Alta** ⭐ quick win

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
- [ ] `GoStudioEditor.tsx:42` ricalcola `copiesInOtherSessions(allDocuments, ...)` a ogni battuta: memoizzare sulle sole dipendenze necessarie.
- [x] **Orologio Hub** ✅ *(fatto 2026-10-15)*: `WelcomePanel` (`useNow`) ora scatta allineato al cambio di minuto (`minuteAlignedTimeout` in `lib/visiblePolling.ts`), non ogni secondo: la Hub mostra solo ore e minuti.
- [x] **Ticker `GoStudioActivityBar` e `GoStudioSonarPanel`** ✅ *(fatto 2026-10-15)*: i timer 500 ms degli indicatori di progresso saltano i tick con finestra nascosta (`visibleInterval`), oltre a restare già limitati ai soli toast visibili.
- [x] **Gate di visibilità condiviso per i poller dei pannelli** ✅ *(fatto 2026-10-15)*: `visibleInterval` (`frontend/src/lib/visiblePolling.ts`, testato) sostituisce 15 `setInterval` a mano in BrowserDebug (×3), DockerLab, Database, Kube (×2), Proxy (×3), TraceStudio, WebSocket, Mock, LargeFile, ThemePanel e nel sync dei dev log: nessun tick con finestra nascosta, refresh immediato al ritorno visibile. Processi, terminali e debug avviati dall'utente non vengono toccati.
- [ ] Memoizzare `EventRow` (`loginspector/EventList.tsx:237`) e le righe messaggi chat — oggi la lista re-renderizza tutte le righe visibili a ogni frame di scroll e i thread chat si rigenerano per chunk di streaming.
- [ ] Streaming chat (`stores/copilot.ts:93-97`, `stores/agentChat.ts:103-106`, `stores/claudeCode.ts`): sostituire il replace dell'intero array con append/patch dell'ultimo messaggio.
- [ ] `useLiveCore()` (`stores/devSession.ts:132-134`) sottoscrive 9 slice: stringere ai soli campi usati dai 3 consumer (`CommandPalette`, `LiveRequestStrip`, `DebugBar`).
- [ ] Applicare `React.memo` (oggi solo 10 usi su 396 componenti) **solo dove il profiling dimostra benefici** — come da piano.
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
- [ ] **Ridurre il fingerprint walk di `workspace_graph.go`**: `Fingerprint` ripercorre l'albero a ogni chiamata non forzata; agganciarlo al watcher (invalidazione event-driven) invece che al re-walk.
- [ ] Timeout RPC generici dove mancano (oggi solo timeout per chiamate LSP e alcune chiamate Go).
- [ ] Dedup generico per RPC equivalenti concorrenti (oggi è fatto feature per feature): valutare un piccolo helper condiviso `singleflight`-like, senza nuova dipendenza.
- [ ] Batching di richieste indipendenti dove utile (es. caricamenti iniziali multipli) — solo con evidenza di payload ripetuti.
- [ ] Verificare che le operazioni lunghe usino eventi/streaming e non polling di risultati (audit mirato su `service*.go`).
- [ ] Separare le operazioni prioritarie per la UI dal background (oggi implicito: valutare code con priorità solo se emergono contese).

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
- [ ] Aggiornamenti incrementali dei documenti (vedi voce 2, `didChange` full-text).
- [ ] Cancellazione richieste superate a nuova digitazione (supersede, vedi voce 2).
- [ ] Dedup diagnostica per contenuto (oggi solo throttle): evitare re-render della UI quando le diagnostiche sono identiche.
- [ ] Verificare il costo reale di semantic tokens, inlay hints e decorations sotto carico (profilare con e senza; rendere disattivabili le costose se emergono).
- [ ] Evitare analisi costose a ogni carattere: audit dei listener `onDidChangeModelContent` (decorazioni comment-tags, context markers, ecc.) con debounce dove manca.

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
- [ ] Verificare riuso dei modelli anche al cambio tab (asserzione/test dedicato).

**Criterio di accettazione:** nessuna crescita progressiva ingiustificata della memoria dopo ripetuti cicli di utilizzo.

---

### 7. Virtualizzazione e caricamento incrementale — `P1` · Stato: Parziale · Fattibilità: **Media**

**Cosa esiste già** (non rifare):
- [x] Lista virtualizzata custom: `loginspector/EventList.tsx:98-199` (windowing a riga fissa, overscan 12 — "100k eventi costano come 40").
- [x] Paginazione incrementale albero: `GoStudioProjectTree.tsx:84-157` (`TREE_PAGE = 500`, "Mostra altri"), `DirectoryNode` memoizzato.
- [x] Cap e paginazione in molte aree: dev logs (2000), console run (4 MB con chunking), gRPC log (80), risultati DB (`ResultsView.tsx` `PAGE_SIZE`), search (`SYMBOL_LIMIT`/`ACTION_LIMIT`), completamenti SQL (50).

**Mancante** (da fare):
- [ ] Estendere il pattern di windowing di `EventList` alle liste non limitate per design: **righe della console run** (renderizzate per intero entro il cap 4 MB), **vista log dev** (`DevLogOverlay` filtra fino a 2000 righe a render), **messaggi chat** lunghi.
- [ ] Dependency/flow graph: `flows/FlowsPanel.tsx:894` renderizza tutti i nodi SVG — valutare virtualizzazione solo sopra una soglia reale (grafi piccoli vanno bene).
- [ ] Preservare selezione, scroll e stato dei nodi durante gli aggiornamenti (audit su tree e liste con refresh periodico).
- [ ] **Non** introdurre virtualizzazione complessa su liste piccole (vincolo del piano) e **nessuna nuova libreria** (rispettare "niente dipendenze non necessarie"): estendere la window-list esistente.

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
- [ ] **Filtri coerenti con `.gitignore`**: oggi il filtro è solo per nome (`isIgnoredDirectory` → `project.IgnoredDirectory`, `documents.go:505-507`). Aggiungere parsing `.gitignore` (con le esclusioni di progetto già esistenti come base).
- [ ] Verificare che `node_modules`, `.git`, build e cache siano sempre esclusi salvo richiesta esplicita (estendere l'elenco delle directory ignorate).
- [ ] Gestione rename/delete verificata con test dedicati (alcuni ci sono: `watcher_test.go`; integrare casi rename/overflow se mancanti).

**Criterio di accettazione:** consumo proporzionato alle modifiche effettive e nessuna perdita di sincronizzazione.

---

### 9. Cache condivisa e invalidazione intelligente — `P1` · Stato: Parziale · Fattibilità: **Alta** ⭐ quick win

**Cosa esiste già** (non rifare — cache ad-hoc già presenti):
- [x] Grafo semantico workspace: memoria + disco (`workspace_graph.go:20-121`, invalidazione su `Fingerprint` + `graphBuilderVersion`, single-flight per sessione).
- [x] Risoluzione versioni tool (`toolversion.go`, cache permanente di successi e incompatibilità), versioni binari (`versioncache.go`), rilevazione toolchain (`detectFast` + persistenza `DetectedToolchains`).
- [x] Indice file progetto (`quick_open.go:16-72`, invalidazione su create/delete), contenuti HEAD git (`vcs.go:37-38`, re-read al cambio hash), code actions LSP (cap 64), profili terminali (TTL), cache DNS, campionamenti risorse (1 s).

**Mancante** (da fare):
- [x] **Cache dependency graph** ✅ *(fatto 2026-10-15, vedi voce 4)*: `internal/goide/dependencygraph_cache.go` — era la voce a maggiore impatto qui.
- [ ] **Fingerprint event-driven** per `workspace_graph.go` (vedi voce 4): evitare il re-walk dell'albero.
- [ ] Valutare cache in memoria con **limiti LRU** per: parsing codice, ricerca simboli, analisi moduli, git status/diff. Analizzare quali risultano oggi ricalcolati (audit mirato) — applicare solo dove il profiling lo dimostra.
- [ ] Piccolo helper condiviso di cache/single-flight (oggi ogni cache è fatta a mano): solo se riduce codice, senza nuove dipendenze esterne.
- [ ] Regole di invalidazione esplicite: modifiche file, versione SDK, configurazione workspace, dipendenze — allineare le cache esistenti a queste regole (oggi eterogenee: TTL, hash, evento).
- [ ] Persistenza locale solo dove utile (già fatta per grafo e toolchain: non estendere senza motivo).

**Criterio di accettazione:** riduzione dei tempi delle operazioni ripetute, senza mostrare dati obsoleti.

---

### 10. Controllo della concorrenza — `P1` · Stato: Esiste (quasi) · Fattibilità: **Alta**

**Cosa esiste già** (non rifare):
- [x] Worker pool limitato per la ricerca (`search.go:100-118`, con cap file/risultati e cancellazione ctx).
- [x] Backpressure: canale 256 slot con drop-on-full (`internal/ide/run/processes.go:421-440`), buffer ad anello log con contatori `dropped`/`missed`, indicizzazione sequenziale e cancellabile (`internal/logindex`).
- [x] Spawn `go func` rari e per entità (sessione/stream/server LSP): nessuna creazione illimitata trovata nei path caldi.

**Mancante** (da fare):
- [ ] Cancellare i task obsoleti dove manca (audit su: scansioni sonar lunghe, `go list` in background, analisi secondarie) — allineare al modello di `stores/goideLsp.ts` (scarto stale + cancel).
- [ ] Priorità esplicita a digitazione, completamento e navigazione rispetto a indicizzazione/analisi in background: oggi implicita (canali separati); formalizzare solo se emergono contese di CPU.
- [ ] Verifica sistematica di race condition e goroutine leak (`go test -race` mirato + conteggio goroutine nei test di ciclo — coordinato con voce 14).
- [ ] Evitare creazione illimitata di subprocess: verificare i limiti su lint/test runner concorrenti.

**Criterio di accettazione:** nessuna saturazione improvvisa della CPU e interfaccia utilizzabile durante operazioni pesanti.

---

### 11. Modalità idle intelligente — `P1` · Stato: **Mancante** · Fattibilità: **Media**

**Cosa esiste già** (politiche frammentate, da unificare — non duplicare):
- [x] Sospensione LSP dopo 5 min (`lsp_idle.go`), reaper sessioni idle (`internal/ws/client.go:22`, `internal/sse/client.go:128`), timeout DB (`internal/database/manager.go:179,265`).
- [x] Frontend: pausa polling su `document.hidden` in `goStudioRuntimeLens.ts`, `ResourceStatus.tsx`, `DotArcade.tsx`; backoff polling in `runtimeLens`; check `document.visibilityState` in `stores/updater.ts:58`; stale-check su `focus` in `stores/devcontext.ts:49-53`; `requestIdleCallback` all'avvio (`lib/startupIdle.ts`).

**Mancante** (da fare):
- [ ] **Stati logici centralizzati** come da piano: `Active` / `Background` (workspace non visibile) / `Idle` (assenza prolungata) / `Suspended` (risorse rilasciate). Un gestore unico (backend `internal/` + piccolo store/hook frontend) che le politiche attuali consultano.
- [x] **Gate di visibilità per tutti i poller residui** ✅ *(fatto 2026-10-15, vedi voce 3)*: 15 poller convertiti a `visibleInterval`; resta escluso solo il liveness-check della popup dev logs (nessuna RPC, ciclo di vita della finestra).
- [ ] Ridurre frequenza di polling, aggiornamenti decorativi e analisi secondarie negli stati Idle/Background.
- [ ] Sospendere solo risorse ripristinabili (modello già collaudato in `lsp_idle.go`: stato preservato, solo processo rilasciato).
- [ ] **Mai** interrompere terminali, debug, richieste, registrazioni o processi avviati esplicitamente dall'utente (vincolo del piano: codificare come regola nel gestore).
- [ ] Misurare la CPU negli stati idle 5/15/30 min (scenario della voce 1).

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
- [ ] Checkpoint build e prova Wails di ripristino/navigazione: bloccati dagli errori TypeScript nelle modifiche concorrenti Database Studio / `goStudioArchitecture.ts`; dettagli nel registro sotto.

**Criterio di accettazione:** startup migliorato senza compromettere ripristino dello stato e navigazione.

---

### 13. Valutazione selettiva di Rust — `P2` · Stato: Da dimostrare · Fattibilità: **Bassa** (solo valutazione, nessuna implementazione senza prove)

**Regola del piano:** non migrare automaticamente; adottare Rust solo con benchmark che dimostrano beneficio netto.

- [ ] **Gate decisionale**: prima di valutare Rust, ogni candidato deve passare il confronto: (1) implementazione Go ottimizzata vs (2) Rust vs (3) tempo/memoria vs (4) costo integrazione vs (5) portabilità Windows/macOS/Linux vs (6) complessità build/manutenzione.
- [ ] Candidati teorici (dall'analisi del codice, in ordine di plausibilità):
  - [ ] Ricerca fuzzy e scansione workspace molto grandi — **nota:** la ricerca ha già worker pool e cap (`search.go`); valutare solo con dati che mostrano il collo di bottiglia.
  - [ ] Diff su file molto grandi (`vcs_working_diff.go`) — candidato più credibile.
  - [ ] Indicizzazione custom non fornita da gopls — **nota:** `workspace_graph.go` + `logindex` già in Go con cancellazione; ottimizzare Go prima (voce 9).
  - [ ] Parsing binario / grandi moli di dati (`binary_inspect.go`) — solo se emergono lentezze reali.
- [ ] Se adottato: **subprocess isolato**, niente CGO né WASM senza motivazione misurabile.
- [ ] Documentare il rifiuto se il vantaggio netto non giustifica la complessità (esito accettabile e probabile).

**Criterio di accettazione:** adottare Rust soltanto se il vantaggio netto giustifica la complessità aggiuntiva.

---

### 14. Stabilità e prevenzione dei memory leak — `P2` · Stato: Parziale · Fattibilità: **Media**

**Cosa esiste già** (non rifare):
- [x] `ProcessSupervisor` per le esecuzioni run-config con stato su disco e ripristino post-crash (`supervisor.go`).
- [x] `crashlock.go`: heartbeat 10 s + ID istanza, crash detection indipendente dal riuso PID.
- [x] Recovery buffer non salvati: 3 generazioni, hash di verifica, limiti 4 MiB/buffer, 200 buffer, 32 MiB totali, 14 giorni (`recovery.go`) — provato con kill reali (`recovery_kill_test.go`).
- [x] Kill ad albero cross-platform (`internal/ide/process`: `taskkill /T /F` su Windows, `kill(-pgid)` su Unix); test anti-orfani per il debugger (`debug_integration_test.go:280`).

**Mancante** (da fare):
- [x] **Sweep all'avvio dei processi orfani** ✅ *(fatto 2026-10-15, vedi voce 2)*: registro + sweep con identità PID+nome; copre gopls e debug adapter (dlv), i processi degli altri figli seguono la stessa strada con `process.RegisterManagedChild`.
- [ ] Valutare **Windows Job Object** con kill-on-close per legare la vita dei figli ad adOmnia (alternativa/supplemento allo sweep).
- [ ] Test di ciclo ripetuto come da piano: apertura/chiusura workspace · creazione/distruzione modelli Monaco · avvio/stop gopls · apertura/chiusura terminali · avvio/stop debug · connessione/disconnessione DB e broker · finestre secondarie.
- [ ] Controlli su: file descriptor, handle Windows, goroutine, worker JS, event listener, processi orfani — automatizzare il conteggio prima/dopo ogni ciclo.
- [ ] Chiudere i buchi noti residui delle voci 3/6 (churn devLogs, model Monaco) come parte della verifica leak.

**Criterio di accettazione:** nessuna crescita di risorse non giustificata dopo il ritorno allo stato iniziale.

---

### 15. Performance budget — `P3` · Stato: Parziale · Fattibilità: **Alta** (dipende da voce 1)

- [x] Budget esistente per il bundle di startup (650 kB, bloccante in CI) — voce 12.
- [ ] Definire la baseline con build release, hardware e condizioni controllate (voce 1) **prima** di fissare i target.
- [ ] Registrare i target iniziali da validare (tabella del piano, da spostare in `docs/PERFORMANCE.md`):

| Indicatore | Obiettivo |
|---|---|
| CPU idle totale | < 2% sul sistema di test, senza task attivi |
| RAM idle | −20% rispetto alla baseline, dove esistono sprechi |
| Startup | riduzione P95, senza regressioni funzionali |
| Latenza digitazione | P95 < 50 ms input-to-render negli scenari concordati |
| Apertura file | riduzione P95 vs baseline |
| Cicli apertura/chiusura | nessun leak persistente |
| Processi figli | nessun orfano dopo chiusura |
| Regressioni funzionali | zero nei workflow coperti dai test |

- [ ] Nessun tetto assoluto di memoria per workspace prima di conoscere dimensioni reali e carichi (vincolo del piano).

---

### 16. Benchmark automatici e report — `P3` · Stato: Parziale · Fattibilità: **Media**

- [x] Benchmark Go esistenti (pochi e mirati): `release_performance_test.go`, `logindex/bench_test.go`.
- [x] Report locali, nessuna telemetria esterna (`startup-performance.jsonl`) — da mantenere.
- [ ] Estendere i benchmark backend alle operazioni calde emerse (dependency graph, workspace graph fingerprint, ricerca, apertura file).
- [ ] Benchmark frontend ripetibili (base: `goStudioBenchmarkCompare.ts` + React Profiler su scenari della voce 1).
- [ ] Confronto baseline vs post-intervento a ogni modifica (formato report standard, salvato localmente).
- [ ] Controlli CI **solo** dove le misurazioni sono stabili — **mai** blocchi CI su benchmark rumorosi (vincolo del piano). Candidati sicuri: dimensioni bundle (già presente), conteggi di chiamate RPC, statistiche di re-render.
- [ ] Collegare i report alle voci 15 (budget) come dashboard locale.

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
- **Nota prodotto (backup workspace):** la voce "rimuovere la doppia serializzazione di `adomnia.workspace.backup`" NON è stata applicata: è una funzionalità utente (impostazione `backupWorkspaceOnStartup` visibile in UI, etichette i18n "Backup workspace all'avvio", fixture di contratto congelato in `docs/fixtures/collection-contract-freeze.v1.adomnia.json`). La sua scrittura è già differita a idle. L'artefatto non ha lettori nel codice: decidere se completare la funzionalità (lettura/ripristino) o rimuoverla è una **decisione di prodotto**, non un refactor.
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
