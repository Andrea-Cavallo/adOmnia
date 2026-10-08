# adOmnia Collaboration Engine

> Roadmap tecnica per collaborazione in tempo reale tra Go Studio (l'IDE, qui indicato anche come "cO Studio") e API Studio.
>
> **Obiettivo:** permettere a due o più sviluppatori di condividere progetti, collection API, debug e test, mantenendo adOmnia **local-first** e senza account cloud obbligatorio.

---

## 0. Grounding nel codice (cosa esiste già e dove agganciarsi)

Questa sezione risponde alle domande aperte della vecchia sezione 7 e **è da rileggere prima di ogni decisione**. È il risultato dello studio del repository: la feature va costruita **sopra** questi mattoni, non in parallelo.

### Editor e documenti

- L'editor è **Monaco**: `frontend/src/lib/monacoSetup.ts` (`@monaco-editor/react` + `monaco-editor`), usato da `frontend/src/components/goide/GoStudioEditor.tsx` e `GoStudioCodeEditor.tsx`. Il modello del documento vive in `frontend/src/lib/goide/` e nei componenti `goide/goStudioEditor*`.
- I **documenti e i salvataggi sono centralizzati in Go**, non nel DOM: `internal/goide/documents.go`, `document_observer.go`, `files.go`, `fileops.go`. Gli eventi del filesystem arrivano da `internal/goide/watcher.go`.
- Esiste già un concetto di **cursore/caret** (ma solo locale): `frontend/src/components/goide/goStudioCursor.ts`, `GoStudioCaretPopup.tsx`. La "presence" remota si aggancia qui.
- **Conseguenza per il CRDT:** il binding Monaco↔Yjs è `y-monaco`/`@monaco-editor/react`-compatibile; il motore di sync deve stare in Go (come oggi stanno i salvataggi) e ricevere le delta dall'editor tramite binding, non nel componente React.

### Collection, environment e request

- Le **collection sono persistite in bbolt** (`internal/collectionsstore/store.go`, bucket `collections`, schema v3: `index-v3` + `workspace:<id>`), con snapshot legacy `collections/all` in v2. Il frontend le legge via binding e `frontend/src/stores/collections.ts`.
- Esiste già un **formato file proiettato e git-friendly** per le collection: `internal/collectionfs/collectionfs.go` (formato `adomnia.collection.v1`), che scrive `collection.json`, `folders/…`, `.adomnia-sync.json` e un **`SyncHash`** (v. `DriftReport.SyncHash`). È pensato **esattamente** per import/merge e versioning su file: le feature 17–18 vanno costruite su `collectionfs`, non da zero.
- Il `.adomnia` workspace (`frontend/src/lib/collectionTransfer.ts`, `collectionExport.ts`, `internal/collectionfs`) è il veicolo di import/export esistente per "Quick Collection Share" (feature 11) e "Share Single Request" (13): una sessione può scambiare **file**, più che diff in tempo reale, per la prima release.
- Le **environment** vivono nel payload workspace (e nel file `.adomnia`); `frontend/src/lib/interopHub.ts` ha già `redactSecrets` e la regex `SECRET_KEY` per filtrare i segreti, più `frontend/src/lib/secretScanner.ts`. Il **filtraggio segreti** (feature 14) riusa queste, non regex nuove.

### Trasporto, sidecar, event bus

- Il backend espone un **sidecar HTTP locale** su `127.0.0.1:0` con **token per-istanza** (`X-Sidecar-Token`, origin allowlist, body 10 MB): `internal/sidecar/server.go` + `auth.go`. Ogni dominio registra i propri handler sul mux (`RegisterHandlers`). **Questo è il pattern da estendere**: il Collaboration Engine aggiungerà un listener/servizio di rete suo, riusando lo stesso approccio di token + limiti.
- `internal/ws/client.go` è un **client** WebSocket (per il tool WebSocket), **non** un server: non è riutilizzabile come trasporto server-side. Serve un nuovo `internal/collab/transport` (gorilla/websocket è già in `go.mod`).
- **Non esistono** mDNS/zeroconf, WebRTC, libp2p, Yjs, CRDT, relay nel codice: vanno introdotti (v. §Rischi).
- L'event bus "reale" più vicino è **`internal/devsession`** (la "Live Development Session", feature D11 del catalogo): un `Manager` con `emit(func(Event))`, `Snapshot()`, eventi tipizzati (`service.started`, `debug.paused`, `request.completed`, …) e un modello `Session`/`RequestRun`. È la **fonte di verità single-machine** che lega run/debug gO alle request API. **La collaborazione cross-machine va modellata come "replica degli eventi di `devsession` + nuovi canali (editor, presence, collection)"**, non come un secondo sistema di stato.
- `frontend/src/lib/entities/openers.ts` (con `registerOpener`, `handoffToPanel`, `useEntityHandoff`) è il **router cross-panel**: "apri la collection/request ricevuta" si fa con `handoffToPanel`, non con nuovi `CustomEvent`.

### LSP, DAP, terminale, processi

- Tutto centralizzato in Go, esposto via Wails `goide_bindings.go` → `internal/goide/Service` (`service.go`, `service_lsp.go`, `service_debug.go`, `service_terminal.go`, `service_run.go`, `service_session_state.go`):
  - **LSP**: `internal/ide/lsp/*` (jsonrpc, gopls `ServerSpec`) + `internal/goide/lsp*.go`.
  - **DAP**: `internal/ide/dap/*` (adapter, manager, transport) + `internal/goide/debug*.go`, Delve.
  - **Terminale**: `internal/goide/terminal.go` + `service_terminal.go`, frontend `GoStudioTerminalPanel.tsx` / `goStudioTerminalBus.ts`.
  - **Processi**: `internal/goide/supervisor.go` (lifecycle), `internal/ide/process/*` (adapter cross-OS), `internal/ide/run/*`.
- **Modello di autorizzazione già presente**: ogni feature che lancia un processo verifica `session.Project.Authorization == AuthorizationPermitted` (`internal/goide/types.go`, costante `"tooling-permitted"`). La **Smart Permissions** (feature 04) e l'**Execution Gateway** devono stratificare i ruoli collaborativi **sopra** questo flag, mai bypassarlo.
- **Conseguenza:** "Collaborative Debugging" (07) e "Shared API Debugging" (16) non richiedono un nuovo debugger: richiedono di **streammare lo stato di `devsession` + DAP manager** e di autorizzare i comandi step/resume in modo granulare.

### Segreti e sicurezza

- `internal/vault/vault.go` è il vault di crittografia già usato da broker/database/AI (riferimenti `vault:`). Il **filtraggio segreti e l'audit** (feature 14, §5) devono risolverlo/riusarlo; nessun segreto va serializzato in chiaro in un payload condiviso.
- Il pattern di **pairing sicuro** esiste concettualmente nel sidecar (token random + origin allowlist) e nell'OAuth PKCE (`internal/oauth`); un codice breve di invito va sempre abbinato a un canale autenticato (v. §5).

### Sintesi operativa

| Domanda | Risposta (con riferimento) |
|---|---|
| Editor reale? | Monaco (`lib/monacoSetup.ts`); documenti/salvataggi in Go (`internal/goide/documents.go`). |
| Dove persistono collection/env/request? | bbolt `collections` (`internal/collectionsstore`); proiezione file `internal/collectionfs` con `SyncHash`. |
| Event bus / WS / servizi Go riusabili? | Sidecar HTTP tokenizzato (`internal/sidecar`); `devsession.Manager` (eventi tipizzati); `internal/ws` è solo client. |
| LSP/DAP/terminale/processi? | In Go: `internal/ide/lsp`, `internal/ide/dap`, `internal/goide/terminal.go`, `supervisor.go`, con gate `AuthorizationPermitted`. |
| Conflitto host/guest sullo stesso file? | Da definire (v. §Rischi): CRDT per l'editor, merge esplicito (già `collectionfs` + git) per collection/metadati. |
| Cosa resta locale vs materializzato sul guest? | Vedere "Host-authoritative" e la matrice "locale vs remoto" in §Architettura. |

---

## Principi architetturali

- Un solo **Collaboration Engine in Go** (`internal/collab/*`), riutilizzabile da Go Studio, API Studio e moduli futuri. **Niente logica di rete nei componenti React**: gli adapter (editor, collection, debug) espongono delta/eventi al motore.
- **LAN/VPN first**: discovery locale, sessioni autenticate e traffico cifrato; relay Internet self-hosted opzionale in una fase successiva.
- **Host-authoritative** per filesystem, terminale, debugger ed esecuzione dei servizi: l'host è l'unico che tocca dischi, processi e porte.
- **Due modelli di coerenza, non uno solo:**
  - **CRDT** (Yjs) solo per il testo in editing simultaneo (feature 01);
  - **sincronizzazione versionata + merge esplicito** per collection, configurazioni e metadati (riusa `collectionfs` + `SyncHash` e git).
- **Secure by default**: inviti a scadenza, ruoli, controlli lato backend, filtri sui segreti (vault + `redactSecrets`) e autorizzazioni granulari sopra `AuthorizationPermitted`.
- **Riusare** le integrazioni esistenti (sidecar, devsession, entity router, collectionfs) senza riscrivere editor, API client o runtime.

---

## 1. Go Studio (cO Studio) — collaborazione IDE (10 funzionalità)

- [ ] **01. Live Code Editing (P0).** Due o più sviluppatori modificano lo stesso file. CRDT Yjs legato a Monaco (`y-monaco`); il sync vive in Go e media con `internal/goide/documents.go` e `watcher.go` (salvataggi atomici e modifiche esterne).
- [ ] **02. Live Cursor & Presence (P0).** Cursori, selezioni, nome e file attivo per partecipante; aggancio in `goStudioCursor.ts`. Cleanup garantito su disconnect (ephemeral, mai persistito).
- [ ] **03. Share Project (P0).** Pulsante `Share Workspace` (session create + invito). Il guest può partecipare senza clonare: riceve lo stato condiviso, non un checkout completo.
- [ ] **04. Smart Permissions (P0).** Ruoli `Viewer`/`Editor`/`Controller` con permessi indipendenti su scrittura, terminale, debug, Git. Validazione **server-side**, stratificata su `AuthorizationPermitted`.
- [ ] **05. Follow Developer (P1).** Seguimento opzionale di navigazione/file/cursore/selezione, interrompibile (stato solo-UI, nessuna persistenza).
- [ ] **06. Shared Terminal (P1).** Stream dell'output (`goStudioTerminalBus.ts` ↔ `service_terminal.go`); l'esecuzione comandi richiede permesso esplicito dell'host (gate sull'Execution Gateway).
- [ ] **07. Collaborative Debugging (P1).** Replica dello stato `devsession` (breakpoint, stack, variabili, log); un solo controller alla volta per step/resume (lock del ruolo `Controller`).
- [ ] **08. Live Code Review (P1).** Commenti sulle righe e suggerimenti applicabili, ancorati a revisioni stabili del documento.
- [ ] **09. Shared Git Operations (P1).** Diff/branch/stato condivisi (`internal/goide/vcs*.go`); commit/merge/rebase/push subordinati a conferma e permessi.
- [ ] **10. Session Recovery (P0).** Riconnessione, ripresa e recupero modifiche; rilevamento/risoluzione conflitti con modifiche esterne.

## 2. API Studio — condivisione e collaborazione API (10 funzionalità)

- [ ] **11. Quick Collection Share (P0).** Trasferimento rapido di collection REST/SOAP/GraphQL/gRPC via LAN + invito/codice temporaneo; Internet via relay opzionale. **Veicolo iniziale: file `collectionfs` / `.adomnia`**, non diff live.
- [ ] **12. Live Collection Sync (P0).** Sincronizzazione di cartelle/endpoint/URL/headers/body/metadata tra partecipanti; gestione modifiche concorrenti (merge esplicito su `collectionfs`).
- [ ] **13. Share Single Request (P0).** Inviare una singola request senza esportare la collection, con **preview dei dati inclusi** e redazione (`redactSecrets`) prima della condivisione.
- [ ] **14. Shared Environments (P0).** Condivisione di nomi/valori non sensibili DEV/TEST/STAGING; segreti/token/password/chiavi esclusi di default (vault + regex `SECRET_KEY`).
- [ ] **15. Collaborative API Testing (P1).** Stream di status/response/header/durata/risultati dei test di un developer autorizzato (riusa gli eventi `devsession`/runner).
- [ ] **16. Shared API Debugging (P1).** Collegare una request API Studio alla sessione di debug di Go Studio per osservare request → breakpoint → variabili → response (correlazione via `X-AdOmnia-Request-ID`, già in `devsession`).
- [ ] **17. API Collection Versioning (P1).** Revisioni, diff, cronologia, rollback; identificatori stabili (gli `id`/`SyncHash` di `collectionfs`).
- [ ] **18. Collection Import & Merge (P0).** `Import as new`, `Replace`, `Compare & Merge` con preview dei conflitti (riusa `collectionTransfer.ts` + `collectionfs.DriftReport`).
- [ ] **19. Shared Test Runner (P1).** Esecuzione condivisa di suite/workflow/stress con streaming risultati e permessi sulle risorse coinvolte.
- [ ] **20. Workspace Collaboration (P2).** Sessione unificata: progetto IDE, collection, OpenAPI/WSDL, connessioni e documentazione, condivisi selettivamente.

---

## 3. Esperienza utente prevista

1. Il developer A apre `payment-service` in Go Studio.
2. Seleziona `Share > Live collaboration` e genera un invito limitato nel tempo (codice + canale autenticato).
3. Il developer B apre adOmnia sul secondo computer e accetta la sessione (pairing, non solo codice).
4. A modifica `PaymentService.go`; B vede cursori e modifiche in tempo reale (Yjs).
5. B apre API Studio e ottiene, previa autorizzazione, la collection `Payment APIs` (file/stream).
6. B esegue `POST /payments` tramite un endpoint condiviso con accesso controllato.
7. A vede breakpoint e stato backend; B vede la response (correlazione `devsession`).
8. Il proprietario può revocare permessi o chiudere la sessione in qualunque momento.

---

## 4. Architettura proposta (allineata al codice)

```text
adOmnia Desktop (Wails 3 + React 19)   [ogni istanza ha il suo backend Go]

cO Studio / API Studio (UI)
  +-- Editor Monaco → y-monaco (delta Yjs)
  +-- Presence / Remote Cursors (goStudioCursor.ts)
  +-- Entity router (lib/entities/openers.ts: handoffToPanel)
  +-- Sidecar fetch (useServerPort.ts → sidecarFetch)

        │  Wails bindings (goide_bindings.go, *_bindings.go)
        ▼
internal/collab  ← NUOVO, unico motore riusabile
  +-- Session Manager       (creazione, join, revoca, scadenza, ruoli)
  +-- Identity / Pairing    (invito + canale autenticato, stile sidecar/OAuth PKCE)
  +-- Discovery             (mDNS LAN — nuova dipendenza)
  +-- Transport             (WebSocket server su TLS — gorilla/websocket già in go.mod)
  +-- Sync (CRDT Yjs)       (bridge Monaco ↔ rete ↔ documents.go)
  +-- Collection Sync       (sopra collectionfs: SyncHash, merge, versioning)
  +-- Execution Gateway     (autorizza terminale/debug/test/porte; sopra AuthorizationPermitted)
  +-- Secret Filtering      (vault + redactSecrets) e Audit locale (devlog/bbolt)

internal già esistenti (non riscrivere)
  +-- sidecar (pattern token/limiti)   devsession (eventi tipizzati + DAP/LSP/terminal)
  +-- collectionsstore / collectionfs  vault / secretScanner
  +-- goide Service (lsp/dap/terminal/supervisor)  ide/* (core language-agnostic)
```

### Contratti e responsabilità

- **Transport:** messaggi tipizzati (v. eventi `devsession`), ordinamento, heartbeat, autenticazione, backpressure; **non** è `internal/ws` (quello è un client).
- **Session Manager:** create/join/revoke/expiry/partecipanti/ruoli; emette snapshot + delta.
- **IDE Adapter:** collega editor/filesystem (`documents.go`, `watcher.go`) e debug (`devsession`) al motore senza logica di rete nella UI.
- **API Adapter:** serializzazione/validazione/import-merge/versioning delle collection via `collectionfs`.
- **Execution Gateway:** autorizza terminale/debugger/test runner/porte locali; mai accesso indiscriminato all'host; ogni comando rispetta `AuthorizationPermitted`.
- **Recovery:** ripresa dopo interruzione, replay/idempotenza eventi, riconciliazione revisioni (`SyncHash`).

### Matrice "locale vs materializzato sul guest"

| Risorsa | Resta solo sull'host | Materializzabile sul guest |
|---|---|---|
| File di progetto | — | sì, come stato condiviso (non necessariamente su disco) |
| Terminale / processi / porte | **sempre** | mai (solo stream + comandi autorizzati) |
| Debugger (Delve) | **sempre** | mai (solo stato replicato) |
| Collection / env non sensibili | — | sì (import/merge locale) |
| Segreti / vault / .env | **sempre** | mai (filtro all'origine) |

---

## 5. Sicurezza e affidabilità, criteri trasversali

- [ ] Pairing sicuro: codice breve + canale autenticato; protezione anti-brute-force (limite tentativi, backoff). Un codice da solo non è una credenziale.
- [ ] Cifratura in transito e verifica dell'identità della controparte; nessuna porta esposta pubblicamente di default (listener su interfacce LAN solo su scelta esplicita).
- [ ] Inviti a scadenza, revocabili, legati alla sessione, privilegi minimi.
- [ ] Esclusione di default di `.env`, token, password, chiavi private, certificati, credenziali DB: riuso di `vault` + `redactSecrets` (`lib/interopHub.ts`, `lib/secretScanner.ts`).
- [ ] Validazione di path e symlink per impedire lettura/scrittura fuori dal workspace autorizzato (come già fatto in `collectionfs`).
- [ ] Limiti su dimensione/frequenza messaggi, file trasferibili e numero partecipanti (riusa lo stile di `sidecar` con `MaxBytesReader`).
- [ ] Crash/reconnect senza perdita silenziosa; conflitti non risolvibili automaticamente sempre segnalati.
- [ ] Audit locale per join/inviti/revoche/esecuzione comandi/condivisione dati (devlog o bbolt).

---

## 6. Piano di implementazione

### Fase P0 — MVP (ordine di dipendenza, non di preferenza)

1. **`internal/collab`: contratti + Session Manager + modello autorizzazione.** Definire `Session`, `Participant`, `Role`, `Permission`, `Event` (riusando i tipi di `devsession`) e il `Snapshot`/delta.
2. **Transport + pairing.** WebSocket server su TLS (gorilla/websocket), token per-sessione, inviti a scadenza. Discovery mDNS in un secondo momento: per l'MVP accettare `ip:port` esplicito (scelta che riduce il rischio).
3. **Quick Collection Share + Share Single Request** (feature 11, 13): scambio di file `collectionfs`/`.adomnia` con anteprima + `redactSecrets`. Questo valida il pairing end-to-end senza dipendere dal CRDT.
4. **Collection Import & Merge + Shared Environments** (feature 18, 14): su `collectionfs.SyncHash`/`DriftReport` e `collectionTransfer.ts`.
5. **Live Code Editing + Presence** (feature 01, 02): `y-monaco` + bridge Go ↔ `documents.go`; presenza su `goStudioCursor.ts`. **È il task più rischioso: va isolato dopo aver chiuso il trasporto.**
6. **Live Collection Sync** (feature 12) e **Session Recovery** (feature 10): riconciliazione e replay eventi.

**Accettazione P0:** due istanze adOmnia su computer diversi condividono una collection, importano/sincronizzano modifiche e collaborano sullo stesso file, senza account cloud, con permessi verificati dal backend.

### Fase P1 — collaborazione avanzata

7. Follow mode (05) e live code review (08).
8. Terminale (06), debugger (07) e Git (09) condivisi con controllo autorizzato (sopra `devsession` + `supervisor`).
9. API testing collaborativo (15), shared test runner (19), collection versioning (17).
10. Correlazione request API ↔ sessione di debug (16).

**Accettazione P1:** un developer invia una request da API Studio mentre l'altro osserva un breakpoint nel servizio host; nessun guest può eseguire comandi o mutazioni Git senza autorizzazione.

### Fase P2 — esperienza integrata

11. Workspace collaboration cross-modulo (20) (IDE, API, documentazione, connessioni selezionate).
12. Relay self-hosted opzionale per reti differenti.
13. Diagnostica, metriche, UX multiutente e gestione sessioni.

**Accettazione P2:** una sessione mantiene una vista coerente di codice e strumenti anche tra reti diverse, con relay configurabile e nessun cloud obbligatorio.

---

## 7. Rischi e decisioni da prendere prima di iniziare

1. **Naming/posizionamento.** Il documento dice "cO Studio"; nel codice l'IDE è "Go Studio" (`internal/goide`, `components/goide`). Confermare il nome finale e aggiornare doc/UI di conseguenza.
2. **Trasporto vs sidecar.** Il sidecar è loopback-only e tokenizzato: non va esteso a listener di rete. Serve un listener separato in `internal/collab` che riusa **il pattern** (token + origin + limiti), non il server stesso.
3. **Discovery.** mDNS non esiste nel repo: serve una libreria Go (o un'announce manuale `ip:port` per l'MVP). Valutare `grandcat/zeroconf` o equivalente. **Rischio di compatibilità Windows/macOS/Linux → mitigare partendo da `ip:port` esplicito.**
4. **CRDT: Yjs vs Automerge, e dove gira.** Editor = Monaco ⇒ `y-monaco` è il percorso a minor attrito; ma il sync deve passare per Go per rispettare salvataggi atomici e `watcher.go`. **Da decidere:** Yjs gira nel renderer (peer-to-peer tra renderer) oppure nel backend Go (binding verso un provider Yjs)? La seconda è più coerente con "backend = fonte di verità", ma più lavoro di bridge.
5. **Conflitto host/guest sullo stesso file.** Definire la semantica: il CRDT risolve i merge automatici; le modifiche esterne (git, watcher) generano un "outside change" che il motore deve riconciliare esplicitamente (mai sovrascrivere silenziosamente).
6. **Vecchio stato `devsession` vs nuovo `collab`.** `devsession` è single-machine e accoppiato a gO. Non duplicarlo: il motore `collab` deve **replicare** i suoi eventi e aggiungere solo gli adapter di rete, oppure `devsession` va estratto/riusato. Decisione architetturale da fissare in un ADR.
7. **Secrets su disco.** bbolt e localStorage sono in chiaro (documentato in CLAUDE.md). Un payload condiviso non deve mai contenere `vault:` riferimenti risolti né segreti; il filtro va **all'origine** (prima della serializzazione).
8. **Ordine delle consegne.** Iniziare con **Quick Collection Share via file + Collaboration Engine minimale (sessioni/identità/permessi)**; poi riusare lo stesso modello per l'editing live. Evitare implementazioni di networking distinte per ciascun modulo — è la tesi dell'intero documento.

---

**Indicazione finale:** la prima consegna utile è `internal/collab` con Session Manager + transport autenticato + Quick Collection Share file-based; Live Code Editing (CRDT) è il traguardo più duro e va affrontato solo a trasporto e modello di autorizzazione già chiusi.
