# adOmnia — Live Development Session (Go Studio ↔ API Workspace ↔ tutto il resto)

Creato 2026-09-30. Obiettivo: adOmnia non è una raccolta di tool ma **un ambiente context-aware**.
Il developer percepisce "sto lavorando su `users-service`", non "ora uso Go Studio / ora uso l'API Client".

Loop da rendere senza attrito: **codice → servizio in esecuzione → API → breakpoint → codice → response**.

Regole: `[x]` = implementato **e** coperto da test automatici (Go `-race`, vitest, render test, e2e con Delve reale).
La verifica nell'app avviata ha una sezione a parte per fase e resta aperta finché non la fai a mano.
Niente coupling diretto fra moduli: API Workspace e Go Studio passano da `internal/devsession`, dallo store
`devSession`, dall'entity router e da eventi DOM.

Guida utente e architettura: [`docs/LIVE-SESSION.md`](docs/LIVE-SESSION.md). Branch: `feat/devsession`.

---

## Stato di partenza (già in codice, riusato)

- [x] **Entity router** `frontend/src/lib/entities/` — usato per Database, Kafka, route.
- [x] **Developer Context** `internal/devcontext` — esteso: ogni route ora punta alla **dichiarazione** dell'handler (`declFile`/`declLine`/`declName`).
- [x] **Code → API** CodeLens esistenti — estesi con i lens sull'handler.
- [x] **Delve/DAP** `internal/goide/dap` — usato dal session manager (stack, step, stop).
- [x] **Run configurations** — la `PORT` della configurazione è la prima fonte della porta.
- [ ] Verificare che le voci sopra reggano il flusso reale (M7, M13 in `todo-ide.md`).

---

## Concetti (modello dati condiviso)

- [x] **Service** — nome dichiarato nel drawer del servizio (salvato per cartella progetto, bbolt `devsession/services`) o nome della cartella; route, datasource, topic e contract dal Developer Context.
- [x] **Target** — Local run (segue la porta), porta Docker Compose, URL remoto; per servizio, in `adomnia.devsession`.
- [x] **Live Development Session** — `internal/devsession/types.go` `Session` (PID, porta + origine, stato, pausa con stack), non persistita.
- [x] **Request Run** — `RequestRun` con correlation id, stato sent/paused/completed/error, hit, contatori log/query/messaggi.
- [x] **Linked Request** — `{{service:users-service}}/users/123`, risolto dal target scelto.
- [x] Workspace graph **derivato** (devcontext + session manager), nessun DB nuovo.

## Architettura

- [x] `internal/devsession` — owner delle sessioni; non importa `goide`, riceve gli eventi dal binding.
- [x] Binding sottile `devsession_bindings.go` (+ `_tools_`, `_sources_`) registrato in `main.go`; bindings rigenerati con `wails3@v3.0.0-beta.25`.
- [x] Eventi `devsession:event`: `service.started|updated|stopped` · `debug.started|paused|resumed|stopped` · `request.started|updated|completed` · `breakpoint.hit` · `log.received` · `database.query` · `kafka.produced`.
- [x] Store `stores/devSession.ts` (+ `devSessionModel.ts` puro e testato); caricato dopo il primo frame, fuori dal bundle d'avvio (`check:startup` verde, 616 KB).
- [x] Ogni evento porta `sessionId`.

---

# Phase 1 — Go Studio ↔ API Workspace (MVP)

### Backend
- [x] Sessione creata su Run/Debug di Go Studio e chiusa su Stop/uscita/chiusura progetto.
- [x] Porta: `PORT` della run config → indirizzo stampato dal servizio (`listening on 127.0.0.1:8080`, `http://…`, `addr=[::]:8443`) → nuovo socket in ascolto non di tooling → a mano dalla debug bar.
- [x] Readiness: connessione TCP (IPv4 e IPv6 loopback) + **path HTTP opzionale** per servizio (risposta < 500).
- [x] Stato Delve → `debug.paused {file, line, function, stack}` / `resumed` / `stopped` (stack letto fuori dalla goroutine DAP).
- [x] Continue / Step Over / Into / Out / Pause / Stop dal session manager.
- [x] Correlazione request ↔ pausa: `likely` con una request in volo, `probable` (la più recente) con più request.
- [x] Header `X-AdOmnia-Request-ID` (disattivabile nel drawer del servizio).
- [x] Timeout: sotto debugger la request ha 30 minuti invece del timeout normale. *ponytail: non è una sospensione vera del timer; basta per lo stepping.*

### Frontend
- [x] **Global Debug Bar** in ogni strumento tranne Go Studio (che ha la sua toolbar): servizio, porta modificabile, stato, `file:line`, controlli, request in volo, split view, log, Go Studio. Tasti F9/F8/F7/Shift+F8/Ctrl+F2.
- [x] Selettore **Target** per le request collegate (striscia sotto la URL bar) + *Link to service*.
- [x] **PAUSED AT BREAKPOINT** nella response: posizione, `Request ──●── Response`, Open in Go Studio, Continue, Step Over, Step Into, Split view, Replay, Stop, "Waiting for debugger…".
- [x] **Open in Go Studio**: progetto, file, riga e debugger giusti; il tab API resta.
- [x] **Debug Request** accanto a Send (Send resta il default): trova o avvia il servizio sotto Delve (anche con Go Studio mai aperto: montato nascosto), riavvio con conferma se gira senza debugger, readiness, invio; avanzamento a step visibile.
- [x] **Handler** nella request: `UserHandler.UpdateUser · user_handler.go:71 · Open handler` (dichiarazione della funzione).
- [x] Gutter/CodeLens sull'handler: `⇄ PUT /users/{id}` · Run · Debug request · Last response · History.
- [x] **Request Context** nel debugger di Go Studio (tab Request): params, query, header mascherati, body, Request ID, Open full request.
- [x] **Keep Context**: Go Studio e API Workspace restano montati (nascosti) dopo la prima apertura; le loro scorciatoie funzionano solo quando visibili.
- [x] Scorciatoie strumenti: **Alt+Shift+1…5** (Go Studio, API, Database, Broker, Logs). *Alt+cifra resta a Go Studio (Alt+1 Project, Alt+5 Debug…): conflitto evitato.*
- [x] Command palette: Debug this request · Go to handler · Go to current request · Go to current breakpoint · Go to service · Go to logs · Split view · Continue/Step/Stop.

### Linguaggio visivo
- [x] Un solo punto: verde running · giallo paused · rosso error · accento (viola) = collegato alla sessione. Niente muri di badge.

### Rischi (gestiti)
- [x] Correlazione euristica senza id → etichette `likely`/`probable`, `id`/`time` su log, query e messaggi.
- [x] Porta non nota → quattro fonti + modifica a mano (la porta mostra da dove arriva).
- [x] `go run` → binario figlio: la porta si rileva dal socket del figlio o dall'output, non dal PID di `go`.
- [x] **Bug trovato dal test e2e e corretto**: su Windows Delve inoltra l'output del programma come `console` e il parser prendeva "127" come porta.

### Verifica automatica
- [x] `internal/goide/devsession_integration_test.go`: servizio Go reale sotto Delve reale → porta dall'output → request → breakpoint legato alla request → la response aspetta → Continue → 200 → riga di log legata per id. (Saltato senza `dlv` nel PATH; con `%APPDATA%/adomnia/goide/tools/bin` passa.)
- [x] Render test di barra, stato PAUSED, riepilogo e Request Context (credenziali mascherate).

### Verifica manuale Phase 1 (da fare nell'app)
- [ ] Scenario completo `users-service`: breakpoint in `UpdateUser` → Run with Debug → API Workspace `PUT /users/123` → Debug Request → PAUSED in API Workspace e nella Debug Bar → Open in Go Studio sulla riga giusta → Step Over dalla Debug Bar restando in API Workspace → Continue → 200.
- [ ] Debug Request con il servizio fermo e Go Studio mai aperto nella sessione.
- [ ] Porta cambiata nella run config → la request collegata segue senza modifiche.
- [ ] Stop dalla Debug Bar → nessun processo orfano (Task Manager).
- [ ] Temi dark/light e finestra piccola: barra, striscia, card PAUSED, drawer.

---

# Phase 2 — + Logs

- [x] stdout/stderr (anche `console` di Delve, filtrati i messaggi di Delve) → `log.received`; livello da JSON (slog/zap/zerolog) o testo.
- [x] Ring buffer 5000 righe per sessione; niente persistenza.
- [x] Correlazione per `X-AdOmnia-Request-ID` nella riga, altrimenti per tempo (anche fino a 1 s dopo la response).
- [x] Response: tab `Response · Logs · Debug · Timeline · DB · Kafka`.
- [x] Da una riga: **request** (torna al tab) e **code** (`file.go:N` in Go Studio).
- [x] Integrazione con il **Log Inspector**: la sessione diventa una sua sorgente live; dal tab Logs apre il Log Inspector filtrato sul Request ID.
- [x] Drawer log del servizio (debug bar, palette, Alt+Shift+5) con filtro "solo righe legate a request".
- [ ] Verifica manuale: servizio che logga il Request ID e servizio che non lo propaga.

---

# Phase 3 — + Database / Kafka

- [x] **SQL dai log** (GORM, sqlx, pgx, logger JSON con `sql`/`query`).
- [x] **Proxy SQL** opt-in, solo loopback, Postgres (simple + extended query) e MySQL (COM_QUERY/PREPARE); byte inoltrati identici; pacchetti di auth mai letti; TLS rifiutato lato servizio (test con server finti).
- [x] **Kafka watch** opt-in: consumer di partizione dal newest offset, **nessun consumer group** (offset reali intatti); match per header `X-AdOmnia-Request-ID` o tempo.
- [x] Datasource e topic precompilati dal Developer Context.
- [x] "Open in Database": query in un nuovo tab di Database Studio, **non eseguita**, con *Open request* per tornare.
- [x] "Open in Kafka": topic in Broker Studio con partizione/offset e *Open request*.
- [ ] Verifica manuale: proxy con Postgres e MySQL reali (DSN puntato al proxy), watch con un broker reale.

### NON fatto (motivato)
- Mongo/Redis, query plan, eventi consumati da altri servizi, SQL via instrumentation.
- Broker Kafka con SASL/TLS nel watch: solo plaintext (sviluppo locale).

---

# Phase 4 — Full Development Context / Request Timeline

- [x] **Request Timeline** locale: sent → frame dello stack → ● breakpoint → SQL → messaggi → log di errore → response.
- [x] **Request Completed summary**: status, durata, percorso nel codice (dallo stack), query, eventi, log, breakpoint; *Mock this response*.
- [x] **Split Debug View**: Go Studio | API Workspace affiancati, ridimensionabili; si apre da sola al breakpoint se sei nell'API Workspace (disattivabile); il pannello cliccato riceve la tastiera.
- [x] **Context Switcher** Ctrl+Tab: codice al breakpoint · request · SQL · messaggio Kafka · log.
- [x] **Service view** nel drawer: progetto, REST (route cliccabili), runtime e target, database (cattura SQL), Kafka (watch), log, debugger, preferenze, nome servizio.
- [ ] *Opzionale, non fatto*: breakpoint "solo su questa request" — richiederebbe riscrivere i breakpoint dell'utente a ogni invio; rinviato.
- [ ] *Opzionale, non fatto*: ricevitore OTLP locale per una timeline precisa (§14/§32 di `gO-Studio-2027-todo.md`).
- [ ] Verifica manuale: split view su finestra piccola, Ctrl+Tab con tutti gli elementi presenti.

---

## Idee ambiziose

- [x] **Replay al breakpoint**: dalla card PAUSED, copia del tab inviata mentre l'originale aspetta.
- [x] **Mock da runtime**: *Mock this response* nel riepilogo.
- [x] **Contract drift live**: route servita dal codice ma assente dall'OpenAPI del servizio → avviso nella striscia.
- [x] **Browser → servizio**: le request di una pagina sotto Browser Debug verso il servizio entrano nella sessione (per tempo).
- [x] **Proxy/Interceptor come sorgente**: il traffico verso il servizio diventa Request Run, con header di correlazione iniettato.

---

## Documentazione

- [x] `docs/LIVE-SESSION.md` (guida + architettura + limiti).
- [x] `docs/adomnia-feature-catalog.en.md` (D11), `docs/ISSUES.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md` [Unreleased].
- [x] `gO-Studio-2027-todo.md`: rimandi a questo piano.
- [ ] `docs/GO-STUDIO.md` e `README.md`: da aggiornare dopo il merge — su `master` hanno modifiche locali non committate, non li ho toccati per non creare conflitti.
