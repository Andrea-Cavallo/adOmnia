# adOmnia Collaboration Engine

> Roadmap tecnica per collaborazione in tempo reale tra Go Studio (l'IDE, qui indicato anche come "cO Studio") e API Studio.
>
> **Obiettivo:** permettere a due o più sviluppatori di condividere progetti, collection API, debug e test, mantenendo adOmnia **local-first** e senza account cloud obbligatorio.

---

## Stato verificato — 2026-10-10

Le spunte indicano lavoro implementato e verificato con le evidenze specificate. Una fase resta aperta quando manca la sua accettazione desktop; una build o un test unitario non sostituiscono la prova tra due computer.

| Area | Implementato | Verificato | Ancora da fare / testare |
|---|---|---|---|
| 6.1–6.3 Sessione, pairing, inbox | Host/guest, TLS con pinning, inviti monouso, ruoli, revoca, payload filtrati | Test Go del trasporto e dei permessi | Accettazione LAN su due computer |
| 6.4 Collection ed environment | Import nuovo, replace confermato, merge per campo, protezione preview obsoleta, hash canonico, opt-in per variabile | Test merge e filtro Go, TypeScript/build | Provare import/replace/merge nella UI desktop e conflitti con modifiche locali |
| 6.5 Editor live e presence | Yjs, relay opaco, Monaco host/guest, cursori e selezioni, buffer host collegato al normale salvataggio | Test convergenza/idempotenza, late sync, viewer/downgrade, race detector | Due editor reali, split/tab, SaveDocument e modifica esterna mentre il CRDT è attivo |
| 6.6 Progetto remoto | Selezione di una sessione Go Studio, albero/file read-only, root confinato, esclusioni, guest senza gopls | Trasferimento TLS, traversal rifiutato, filtro file/contenuti | Symlink/junction reali su Windows: il test symlink è **SKIP** su questo host per privilegio non disponibile; prova desktop del guest |
| 6.7 Sync e recovery | Snapshot collection su opt-in, merge manuale, resume temporaneo da seq, replay limitato, risync Yjs | Test batching/stop offline, resume/revoca/scadenza, recupero testo renderer | Interruzione rete reale, replay oltre limite, crash del processo/app e recupero persistente; il resume attuale vive solo in memoria |
| P1 / P2 | Nessuna consegna completata | — | Follow/review, terminal/debug/Git autorizzati, test collaborativi, versioning, correlazione API/debug, proxy LSP, mDNS, cross-modulo, relay opzionale e diagnostica |

Verifiche automatiche più recenti: **15 test frontend Collaboration superati**, `go build ./...` e test `internal/collab` / `internal/collectionfs` con `-race` superati. Build frontend e budget startup superati: **590698 byte** iniziali. La suite Go completa non è attestata da questi controlli mirati.

### Aggiornamento UI richiesto insieme alla roadmap

- [x] Stato vuoto della risposta nello stile Nothing: titolo Doto, glyph SVG a puntini, testo e scorciatoia coerenti; colori da palette.
- [x] Tab API più leggibili: maggiore larghezza minima, badge metodo, indicatore attivo, stato dirty discreto, overflow con tab attivo visibile; eliminata la ripetizione del metodo nel titolo.
- [x] Verifica nel frontend locale: apertura di 8 tab, overflow, rinomina, tema scuro, tema chiaro e accento viola. Screenshot: `.artifacts/api-nothing-dark.png`, `.artifacts/api-nothing-light.png`, `.artifacts/api-nothing-accent.png`.
- [ ] Smoke test dello stesso restyling nel nuovo eseguibile Wails; drag/reorder/detach e navigazione da tastiera da verificare nel runtime desktop.

---

## Checklist residua — cosa manca per chiudere

Riepilogo ordinato per priorità degli item ancora aperti. Ogni voce richiama la sezione di origine.

### A. Accettazione P0 (bloccante — due computer reali)

- [ ] **A1 — Accettazione LAN** (6.1–6.3): due istanze su computer diversi condividono una collection senza account cloud, con permessi verificati dal backend.
- [ ] **A2 — Import/replace/merge in UI** (6.4): provare `Import as new` / `Replace` / `Compare & Merge` nella UI desktop, incluse modifiche locali concorrenti durante la preview.
- [ ] **A3 — Editor live su due macchine** (6.5): due editor reali, split/tab, `SaveDocument` dell'host e modifica esterna (watcher) mentre il CRDT è attivo (nessuna sovrascrittura silenziosa).
- [ ] **A4 — Guest remoto** (6.6): apertura file, cursori, downgrade ruolo e salvataggio host su due computer; symlink/junction reali su Windows (test attualmente SKIP per privilegi mancanti).
- [ ] **A5 — Recovery reale** (6.7): interruzione rete reale, replay oltre limite, crash del processo/app e **recupero persistente** (il resume vive oggi solo in memoria).
- [ ] **A6 — Accettazione P0 formale** (riga 282): condividere, importare/sincronizzare modifiche e collaborare sullo stesso file tra due computer.

### B. Sicurezza trasversale (§5)

- [ ] **B1** (232): esclusione di default di `.env`, token, password, chiavi private, certificati, credenziali DB (riuso `vault` + `redactSecrets`).
- [ ] **B2** (233): validazione path e symlink per impedire accessi fuori dal workspace autorizzato.
- [ ] **B3** (235): crash/reconnect senza perdita silenziosa; conflitti non risolvibili sempre segnalati.
- [ ] **B4** (236): audit delle esecuzioni insieme al gateway terminal/debug/Git (6.9).

### C. UI — smoke test desktop

- [ ] **C1** (riga 29): smoke test del restyling API nell'eseguibile Wails (drag/reorder/detach + navigazione da tastiera).

### D. Fase P1 — collaborazione avanzata

- [ ] **D1** (6.8): Follow mode (05) + Live Code Review (08, ancore `Y.RelativePosition`).
- [ ] **D2** (6.9): terminale (06), debugger (07) e Git (09) condivisi con controllo autorizzato (sopra `devsession` + `supervisor`).
- [ ] **D3** (6.10): API testing collaborativo (15), shared test runner (19), collection versioning (17, via git su `collectionfs`).
- [ ] **D4** (6.11): correlazione request API ↔ sessione di debug (16).
- [ ] **D5** (6.12): LSP proxy host → guest.
- [ ] **D6** (6.13): discovery mDNS LAN (`grandcat/zeroconf`) con fallback `ip:port`.
- [ ] **D7** (riga 293): accettazione P1 (breakpoint osservato da un secondo developer; nessuna esecuzione/mutazione Git senza autorizzazione).

### E. Fase P2 — esperienza integrata

- [ ] **E1** (6.14): Workspace collaboration cross-modulo (20).
- [ ] **E2** (6.15): relay self-hosted opzionale per reti differenti.
- [ ] **E3** (6.16): diagnostica, metriche, UX multiutente e gestione sessioni.
- [ ] **E4** (riga 301): accettazione P2 (vista coerente tra reti diverse, relay configurabile, nessun cloud obbligatorio).

### F. Funzionalità API Studio non ancora spuntate (sezione 2)

- [ ] **F1** (12): Live Collection Sync.
- [ ] **F2** (15): Collaborative API Testing.
- [ ] **F3** (16): Shared API Debugging.
- [ ] **F4** (17): API Collection Versioning.
- [ ] **F5** (18): Collection Import & Merge (agganciato ad A2).
- [ ] **F6** (19): Shared Test Runner.
- [ ] **F7** (20): Workspace Collaboration.

---

## Runbook accettazione LAN (A1) — due computer

Procedura minima per chiudere A1. Prerequisiti: due computer sulla stessa LAN, entrambi con `wails3 task dev` avviato; firewall Windows dell'host che consente la porta scelta (prima richiesta → consenti).

1. **Host** (macchina A): apri la panel **Live Collaboration**, imposta "Il tuo nome", seleziona l'IP LAN (non `127.0.0.1`) in **Ospita una sessione** → **Ospita**.
   - Atteso: badge "Host", indirizzo `IP:porta`, impronta TLS visibile.
2. **Invito** (A): in **Invita** scegli ruolo `Editor`, TTL 15 min → **Nuovo invito** → copia il codice `adomnia-collab://IP:porta?t=…&fp=…`.
3. **Guest** (macchina B): incolla il codice in **Partecipa** → **Partecipa**.
   - Atteso: badge "Connesso"; entrambi vedono 2 partecipanti (Host + guest).
4. **Condivisione** (A): in **Condividi** scegli una collection, **Anteprima** (verifica che i segreti siano "rimossi"), poi **Invia ai partecipanti**.
5. **Ricezione** (B): in **Ricevuti** appare la collection da A → **Importa** → la collection compare in API Studio.
6. **Inverso** (B→A): B condivide una request; A la riceve e la apre in una nuova tab.
7. **Permessi/revoca** (A): cambia il ruolo del guest a `Viewer` (B non può più condividere) e poi **Rimuovi** → B riceve "l'host ti ha rimosso".

Criterio di accettazione: nessun segreto appare in chiaro nel payload ricevuto; l'invito non è riutilizzabile; il revoke chiude la connessione. Fallimento tipico: porta bloccata dal firewall (l'host deve accettare la richiesta, o usare una porta già consentita).

## Runbook import/replace/merge (A2) — due finestre

Per chiudere A2 senza un secondo computer è sufficiente **una sola macchina** con due istanze (due processi `wails3 task dev`, o host+guest sullo stesso processo via IP `127.0.0.1`). A2 non richiede la LAN reale: verifica solo la UI di import.

1. **Host e guest** si connettono (vedi runbook A1, usando IP `127.0.0.1` se è la stessa macchina).
2. **Host** condivide una collection; **guest** riceve in **Ricevuti** → clicca **Importa**.
3. Nel riquadro "Importa…" prova i tre modi:
   - **Importa come nuova**: crea una collection con nome `… (da <host>)` e ID nuovi; la collection esistente resta intatta.
   - **Sostituisci**: scegli una destinazione → **Conferma sostituzione**; nome e ID locali restano, i contenuti diventano quelli ricevuti.
   - **Confronta e unisci**: scegli una destinazione → appaiono le differenze (Locale vs Ricevuto), con i conflitti marcati; seleziona i valori da applicare → **Applica**. I campi non selezionati restano locali; nessuna cancellazione implicita.
4. **Conflitto con modifiche locali**: mentre il riquadro è aperto, modifica la collection di destinazione in un'altra view → su **Applica** deve comparire "La collection locale è cambiata…" e non deve essere applicato nulla.

Criterio di accettazione: nessuna cancellazione implicita di elementi locali; gli ID locali vengono conservati (in merge); i nomi ambigui appaiono come conflitto, non vengono risolti a caso.

---

## 0. Grounding nel codice (cosa esiste già e dove agganciarsi)

Questa sezione risponde alle domande aperte della vecchia sezione 7 e **è da rileggere prima di ogni decisione**. È il risultato dello studio del repository: la feature va costruita **sopra** questi mattoni, non in parallelo.

### Editor e documenti

- L'editor è **Monaco**: `frontend/src/lib/monacoSetup.ts` (`@monaco-editor/react` + `monaco-editor`), usato da `frontend/src/components/goide/GoStudioEditor.tsx` e `GoStudioCodeEditor.tsx`. Il modello del documento vive in `frontend/src/lib/goide/` e nei componenti `goide/goStudioEditor*`.
- I **documenti e i salvataggi sono centralizzati in Go**, non nel DOM: `internal/goide/documents.go`, `document_observer.go`, `files.go`, `fileops.go`. Gli eventi del filesystem arrivano da `internal/goide/watcher.go`.
- Esiste già un concetto di **cursore/caret** (ma solo locale): `frontend/src/components/goide/goStudioCursor.ts`, `GoStudioCaretPopup.tsx`. La "presence" remota si aggancia qui.
- **Conseguenza per il CRDT (corretta dopo verifica):** `DocumentManager` in Go gestisce solo open/save/check su disco (`OpenDocument`, `SaveDocument` con `diskToken`); il **buffer non salvato vive nel modello Monaco del renderer**. Non esiste un port Go maturo di Yjs. Quindi: **Yjs gira nel renderer** (`y-monaco`), il backend Go fa da **relay opaco** degli update binari Yjs (non li interpreta) e resta l'unico che scrive su disco via `SaveDocument` sull'host.

### Collection, environment e request

- Le **collection sono persistite in bbolt** (`internal/collectionsstore/store.go`, bucket `collections`, schema v3: `index-v3` + `workspace:<id>`), con snapshot legacy `collections/all` in v2. Il frontend le legge via binding e `frontend/src/stores/collections.ts`.
- Esiste già un **formato file proiettato e git-friendly** per le collection: `internal/collectionfs/collectionfs.go` (formato `adomnia.collection.v1`), che scrive `collection.json`, `folders/…`, `.adomnia-sync.json` e un **`SyncHash`** (v. `DriftReport.SyncHash`). È pensato **esattamente** per import/merge e versioning su file: le feature 17–18 vanno costruite su `collectionfs`, non da zero.
- Il `.adomnia` workspace (`frontend/src/lib/collectionTransfer.ts`, `collectionExport.ts`, `internal/collectionfs`) è il veicolo di import/export esistente per "Quick Collection Share" (feature 11) e "Share Single Request" (13): una sessione può scambiare **file**, più che diff in tempo reale, per la prima release.
- Le **environment** vivono nel payload workspace (e nel file `.adomnia`); `frontend/src/lib/interopHub.ts` ha già `redactSecrets` e la regex `SECRET_KEY` per filtrare i segreti, più `frontend/src/lib/secretScanner.ts`. Lato Go `collectionfs.exportableVariables` svuota già le variabili `Secret`. Il **filtraggio segreti** (feature 14) riusa queste, non regex nuove; il filtro autorevole sta **in Go** (all'origine, prima della rete), quello renderer serve solo per la preview.

### Trasporto, sidecar, event bus

- Il backend espone un **sidecar HTTP locale** su `127.0.0.1:0` con **token per-istanza** (`X-Sidecar-Token`, origin allowlist, body 10 MB): `internal/sidecar/server.go` + `auth.go`. Ogni dominio registra i propri handler sul mux (`RegisterHandlers`). **Questo è il pattern da estendere**: il Collaboration Engine aggiungerà un listener/servizio di rete suo, riusando lo stesso approccio di token + limiti.
- `internal/ws/client.go` è un **client** WebSocket (per il tool WebSocket), **non** un server: non è riutilizzabile come trasporto server-side. Serve un nuovo `internal/collab/transport` (gorilla/websocket è già in `go.mod`).
- **Non esistono** mDNS/zeroconf, WebRTC, libp2p, Yjs, CRDT, relay nel codice: vanno introdotti (v. §Rischi).
- L'event bus "reale" più vicino è **`internal/devsession`** (la "Live Development Session", feature D11 del catalogo): un `Manager` con `emit(func(Event))`, `Snapshot()`, eventi tipizzati (`service.started`, `debug.paused`, `request.completed`, …) e un modello `Session`/`RequestRun`. È la **fonte di verità single-machine** che lega run/debug gO alle request API. **La collaborazione cross-machine va modellata come "replica degli eventi di `devsession` + nuovi canali (editor, presence, collection)"**, non come un secondo sistema di stato.
- `frontend/src/lib/entities/` (`router.ts` → `registerOpener`, `dispatch.ts` → `handoffToPanel`, usati da `openers.ts`) è il **router cross-panel**: "apri la collection/request ricevuta" si fa con `handoffToPanel`, non con nuovi `CustomEvent`.

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

## 0.1 Studio di fattibilità (verificato sul codice, 2026-10-08)

Tutti i path citati in §0 esistono (`internal/collab` no: è il nuovo package). `gorilla/websocket v1.5.3` è in `go.mod`; nessuna dipendenza CRDT/mDNS presente.

| # | Feature | Fattibilità | Sforzo | Note / blocchi reali |
|---|---|---|---|---|
| 11 | Quick Collection Share | ✅ alta | S | `collectionfs.Export/ImportCollection` + WS. Valida tutto il trasporto. |
| 13 | Share Single Request | ✅ alta | S | `collectionfs.ExportRequest` esiste già. |
| 14 | Shared Environments | ✅ alta | S | `exportableVariables` (Go) + `redactSecrets` (preview). |
| 18 | Import & Merge | ✅ alta | M | `InspectDrift`/`SyncHash` danno il diff; manca solo la UI "Compare & Merge". |
| 04 | Smart Permissions | ✅ alta | M | Check server-side nel gateway di `internal/collab`, sopra `AuthorizationPermitted`. |
| 02 | Presence / cursori | ✅ alta | S | Gratis con Yjs awareness una volta che c'è 01. |
| 05 | Follow Developer | ✅ alta | S | Solo UI sopra awareness. |
| 15/16 | API testing / debug condiviso | ✅ media-alta | M | Replica eventi `devsession.Manager.publish` (+ `X-AdOmnia-Request-ID` già presente). |
| 07 | Collaborative Debugging | 🟡 media | M | Stato in lettura facile (replica eventi DAP); controllo step/resume = comandi via gateway con lock. |
| 06 | Shared Terminal | 🟡 media | M | Output in stream facile; input remoto = rischio sicurezza, solo con conferma host. |
| 09 | Shared Git | 🟡 media | M | Lettura (`vcs.go`) facile; mutazioni via gateway + conferma. |
| 01 | Live Code Editing | 🟡 media | L | Yjs nel renderer + relay Go opaco. Difficile: riconciliare save/`diskToken`/watcher con il doc Yjs. |
| 03 | Share Project (guest senza clone) | 🟠 bassa-media | L | Go Studio oggi assume un `RootPath` locale: serve un "remote file provider" per albero/apertura file. **gopls/LSP sul guest non ci sono** → o proxy LSP dall'host (molto lavoro) o editing senza intelligenza. |
| 10 | Session Recovery | 🟡 media | M | Yjs rende il replay del testo semplice; per eventi serve seq number + snapshot. |
| 08 | Live Code Review | 🟡 media | M | Ancoraggio commenti: usare `Y.RelativePosition`. |
| 12 | Live Collection Sync | 🟡 media | L | Merge per-campo su collection: rischio conflitti; partire da "push snapshot + merge esplicito". |
| 17 | Collection Versioning | ✅ alta | S-M | Più semplice delegarlo a git su `collectionfs` (già esiste Git Sync). |
| 19 | Shared Test Runner | 🟡 media | M | Stesso pattern di 15. |
| 20 | Workspace Collaboration | 🟠 bassa | XL | Somma di tutto: solo dopo P1. |
| — | mDNS discovery | 🟡 media | S | `grandcat/zeroconf`; firewall Windows è il vero problema → MVP con `ip:port`. |
| — | Relay Internet | 🟠 bassa | L | Binario self-hosted separato; P2. |

**Verdetto:** il piano è sano e l'ordine P0 è giusto. Due correzioni importanti:
1. **CRDT nel renderer, non in Go** (v. §0 corretto): Go fa solo relay di byte + salvataggio host. Evita di scrivere/portare un Yjs in Go.
2. **Feature 03 è sottostimata**: "guest senza clone" richiede remote FS + (opzionale) LSP proxy. Per P0 accettare: il guest vede albero e file condivisi in un editor Monaco **senza gopls**; LSP proxy → P1.

**Sicurezza trasporto (scelta concreta):** l'host genera un certificato self-signed per sessione; l'invito contiene `ip:port` + token monouso + fingerprint SHA-256 del certificato → il guest fa pinning. Niente CA, niente account.

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

- [x] **11. Quick Collection Share (P0).** Trasferimento rapido di collection REST/SOAP/GraphQL/gRPC via LAN + invito/codice temporaneo; Internet via relay opzionale. **Veicolo iniziale: file `collectionfs` / `.adomnia`**, non diff live.
- [ ] **12. Live Collection Sync (P0).** Sincronizzazione di cartelle/endpoint/URL/headers/body/metadata tra partecipanti; gestione modifiche concorrenti (merge esplicito su `collectionfs`).
- [x] **13. Share Single Request (P0).** Inviare una singola request senza esportare la collection, con **preview dei dati inclusi** e redazione (`redactSecrets`) prima della condivisione.
- [x] **14. Shared Environments (P0).** Condivisione di nomi/valori non sensibili DEV/TEST/STAGING; segreti/token/password/chiavi esclusi di default (vault + regex `SECRET_KEY`).
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

- [x] Pairing sicuro: codice breve + canale autenticato; protezione anti-brute-force (limite tentativi, backoff). Un codice da solo non è una credenziale.
- [x] Cifratura in transito e verifica dell'identità della controparte; nessuna porta esposta pubblicamente di default (listener su interfacce LAN solo su scelta esplicita).
- [x] Inviti a scadenza, revocabili, legati alla sessione, privilegi minimi.
- [ ] Esclusione di default di `.env`, token, password, chiavi private, certificati, credenziali DB: riuso di `vault` + `redactSecrets` (`lib/interopHub.ts`, `lib/secretScanner.ts`).
- [ ] Validazione di path e symlink per impedire lettura/scrittura fuori dal workspace autorizzato (come già fatto in `collectionfs`).
- [x] Limiti su dimensione/frequenza messaggi, file trasferibili e numero partecipanti (riusa lo stile di `sidecar` con `MaxBytesReader`).
- [ ] Crash/reconnect senza perdita silenziosa; conflitti non risolvibili automaticamente sempre segnalati.
- [x] Audit locale in devlog per le operazioni disponibili: host/join, inviti, ruoli, revoche, uscita e condivisione. Nessun token, invito, valore condiviso o titolo nei log. L’audit delle esecuzioni sarà aggiunto insieme al gateway terminal/debug/Git (6.9).

---

## 6. Piano di implementazione

### Fase P0 — MVP (ordine di dipendenza, non di preferenza)

- [x] **6.1 `internal/collab`: contratti + Session Manager + autorizzazione.**
  - [x] Tipi `Session`, `Participant`, `Role` (`Viewer`/`Editor`/`Controller`), `Permission`, `Event` (envelope tipizzato con `seq`), `Snapshot`.
  - [x] Session Manager: create / join / revoke / expiry / lista partecipanti (stile `devsession.Manager`: `emit`, `Snapshot()`).
  - [x] Check permessi **server-side** in un solo punto (gateway), sopra `AuthorizationPermitted`.
  - [x] Test Go: join con token scaduto/errato rifiutato, revoca chiude la connessione, permesso negato per ruolo.
- [x] **6.2 Transport + pairing.**
  - [x] Listener WS separato dal sidecar (gorilla/websocket), TLS con cert self-signed per sessione.
  - [x] Invito = `ip:port` + token monouso + fingerprint cert; pinning lato guest.
  - [x] Anti-brute-force (limite tentativi + backoff), heartbeat, limiti dimensione/frequenza messaggi.
  - [x] Listener solo su scelta esplicita dell'utente (default: nessuna porta aperta).
  - [x] Binding Wails `collab_bindings.go` + wrapper `frontend/src/lib/collab-api.ts`; bindings rigenerati.
  - [x] UI minima: "Share" (crea invito, copia codice), "Join" (incolla invito), lista partecipanti, revoca.
- [x] **6.3 Quick Collection Share + Share Single Request (11, 13).**
  - [x] Payload JSON della collection/request (filtro segreti in Go all'origine: `collab.Redact`, re-applicato dall'host su ciò che inviano i guest).
  - [x] Preview dei dati inclusi + `redactSecrets` prima dell'invio.
  - [x] Ricezione in una inbox con consenso esplicito: collection → `importCollection` (ID nuovi), request → nuova tab, environment → nuovi environment; avviso se contiene script.
- [ ] **6.4 Collection Import & Merge + Shared Environments (18, 14).**
  - [ ] `Import as new` / `Replace` / `Compare & Merge` con preview conflitti (`InspectDrift`/`SyncHash`).
    - [x] Inbox: scelta destinazione, import come nuova, sostituzione confermata e confronto per campo con selezione esplicita; protezione da cambiamenti locali durante la preview.
    - [x] Test automatici: conservazione ID locali, aggiunte annidate, nessuna cancellazione implicita, nomi ambigui trattati come conflitti; build frontend superata (2026-10-09).
    - [x] Revisioni SHA-256 canoniche condivise con `collectionfs.HashJSON`, ricalcolate dall’host prima del relay; test indipendente dall’ordine delle chiavi superato.
    - [ ] Verificare il flusso in due finestre desktop.
  - [x] Environment condivisi senza segreti per default (privati esclusi, valori secret svuotati).
  - [x] Opt-in esplicito per singola variabile segreta: checkbox per variabile e anteprima esatta; filtro autorevole Go esclude environment privati e riferimenti vault anche se selezionati. Test Go di default, opt-in e relay superati (2026-10-09).
- [ ] **6.5 Live Code Editing + Presence (01, 02).**
  - [x] Dipendenze `yjs` + `y-monaco` + `y-protocols` caricate con gli editor condivisi, fuori dallo startup: build e `check:startup` superati, 649955 byte iniziali (2026-10-09).
  - [x] Provider Yjs custom e binding Monaco: relay Go opaco, room create solo dall’host, permessi editor/viewer verificati dal server, update raggruppati e limiti di memoria; test convergenza, idempotenza, late sync e downgrade superati (2026-10-09).
  - [ ] Host salva via `SaveDocument`; modifiche esterne (watcher) → "outside change" esplicito, mai sovrascrittura silenziosa.
  - [x] Awareness Yjs per cursori/selezioni/nome/file attivo; cleanup alla chiusura del provider e rimozione dei partecipanti. Collegata agli editor host e guest; verifica desktop multiutente ancora da eseguire.
- [ ] **6.6 Share Project lato guest (03).**
  - [x] Remote file provider: albero + apertura file serviti dall’host, root derivato da una sessione Go Studio aperta; check `EnsureWithin` + `EvalSymlinks`, file privati/binari/credenziali esclusi, limiti e richieste correlate. Test trasferimento TLS e traversal superati (2026-10-09); test symlink saltato per privilegio Windows non disponibile, da recuperare nell’accettazione.
  - [x] Editor remoto guest senza avvio di gopls né comandi host: snapshot in sola lettura, live solo per i file abilitati dall’host e i ruoli autorizzati. TypeScript/build superati (2026-10-09).
  - [ ] Verifica desktop su due computer: apertura file, cursori, downgrade ruolo e salvataggio da parte dell’host.
- [ ] **6.7 Live Collection Sync + Session Recovery (12, 10).**
  - [x] Reconnect esplicito con credenziale temporanea in memoria, pinning TLS, stessa identità e ruolo autorevole; replay limitato da `seq` con avviso se la cronologia è esaurita. Yjs recupera anche il testo locale non inviato. Test Go di ripresa/revoca/scadenza e test renderer di ripresa editor/viewer superati (2026-10-09).
  - [x] Collection: opt-in per snapshot delle modifiche future, invii raggruppati, stop su disconnessione/downgrade, inbox aggiornata per origine senza applicazione automatica; merge esplicito con conflitti visibili. Test frontend di batching, nessun reinvio invariato e stop offline superato (2026-10-09).
  - [ ] Verifica desktop di interruzione rete, ripresa e merge degli snapshot su due computer.

- [ ] **Accettazione P0:** due istanze adOmnia su computer diversi condividono una collection, importano/sincronizzano modifiche e collaborano sullo stesso file, senza account cloud, con permessi verificati dal backend.

### Fase P1 — collaborazione avanzata

- [ ] 6.8 Follow mode (05) e live code review (08, ancore `Y.RelativePosition`).
- [ ] 6.9 Terminale (06), debugger (07) e Git (09) condivisi con controllo autorizzato (sopra `devsession` + `supervisor`).
- [ ] 6.10 API testing collaborativo (15), shared test runner (19), collection versioning (17, via git su `collectionfs`).
- [ ] 6.11 Correlazione request API ↔ sessione di debug (16).
- [ ] 6.12 LSP proxy host → guest (diagnostica/hover/completamento per il guest).
- [ ] 6.13 Discovery mDNS LAN (`grandcat/zeroconf` o equivalente), con fallback `ip:port`.

- [ ] **Accettazione P1:** un developer invia una request da API Studio mentre l'altro osserva un breakpoint nel servizio host; nessun guest può eseguire comandi o mutazioni Git senza autorizzazione.

### Fase P2 — esperienza integrata

- [ ] 6.14 Workspace collaboration cross-modulo (20) (IDE, API, documentazione, connessioni selezionate).
- [ ] 6.15 Relay self-hosted opzionale per reti differenti.
- [ ] 6.16 Diagnostica, metriche, UX multiutente e gestione sessioni.

- [ ] **Accettazione P2:** una sessione mantiene una vista coerente di codice e strumenti anche tra reti diverse, con relay configurabile e nessun cloud obbligatorio.

---

## 7. Rischi e decisioni da prendere prima di iniziare

Proposta di default tra parentesi (da confermare spuntando).

- [x] **7.1 Naming.** "cO Studio" vs "Go Studio" nel codice. *(Proposta: resta "Go Studio"; correggere il doc.)*
- [x] **7.2 Trasporto vs sidecar.** Sidecar loopback-only, non va esteso: listener separato in `internal/collab` che riusa il **pattern** (token + limiti). *(Deciso dal codice: `sidecar/server.go` ascolta su `127.0.0.1:0`.)*
- [x] **7.3 Discovery.** *(Proposta: MVP `ip:port` esplicito; mDNS in P1.)*
- [x] **7.4 CRDT: Yjs vs Automerge, dove gira.** *(Proposta: Yjs nel renderer + `y-monaco`, Go relay opaco. Motivo: buffer non salvato è nel renderer, nessun Yjs Go maturo.)*
- [x] **7.5 Conflitto host/guest sullo stesso file.** *(Proposta: CRDT per merge live; watcher/git → "outside change" riconciliato esplicitamente.)*
- [x] **7.6 `devsession` vs `collab`.** *(Proposta: `collab` sottoscrive gli eventi di `devsession.Manager` e li replica; nessuno stato duplicato. ADR breve.)*
- [x] **7.7 Segreti.** Filtro all'origine in Go prima della serializzazione; mai `vault:` risolti nel payload. *(Proposta: riusare `exportableVariables` + check `secretScanner` in preview.)*
- [x] **7.8 Ordine consegne.** *(Proposta: 6.1 → 6.2 → 6.3 come primo slice spedibile.)*
- [x] **7.9 Guest senza LSP in P0.** *(Proposta: accettato; LSP proxy in P1.)*

---

**Indicazione finale:** la prima consegna utile è `internal/collab` con Session Manager + transport autenticato + Quick Collection Share file-based; Live Code Editing (CRDT) è il traguardo più duro e va affrontato solo a trasporto e modello di autorizzazione già chiusi.
