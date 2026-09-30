# adOmnia — Live Development Session (Go Studio ↔ API Workspace ↔ tutto il resto)

Creato 2026-09-30. Obiettivo: adOmnia non è una raccolta di tool ma **un ambiente context-aware**.
Il developer percepisce "sto lavorando su `users-service`", non "ora uso Go Studio / ora uso l'API Client".

Loop da rendere senza attrito: **codice → servizio in esecuzione → API → breakpoint → codice → response**.

Regole: le voci si spuntano solo quando fatte **e** verificate nell'app avviata. Niente coupling diretto
fra moduli (API Workspace non importa Go Studio e viceversa): tutto passa da session manager + eventi + entity router.

---

## Stato di partenza (già in codice, da riusare — non rifare)

- [x] **Entity router** `frontend/src/lib/entities/` (`openEntity`, openers, parked handoff) — spec `docs/superpowers/specs/2026-09-28-devcontext-p0-p1-design.md`.
- [x] **Developer Context** `internal/devcontext`: route Go (net/http, gin, echo, fiber, chi, gorilla), gRPC, Kafka topic, tabelle SQL, WebSocket, compose, `.env`, contract.
- [x] **Code → API** CodeLens "Open GET /x in API Client" + "Go to handler" dalla palette.
- [x] **Delve/DAP** `internal/goide/dap`: launch, attach, remote, breakpoint, step, variabili, goroutine.
- [x] **Run configurations** con env file, porte, port check, before/after launch task.
- [ ] Verificare che le voci sopra reggano il flusso reale (M7, M13 in `todo-ide.md`) prima di costruirci sopra.

---

## Concetti (modello dati condiviso)

- [ ] **Service** — oggetto centrale: `{id, name, projectRoot, targets[], linkedCollections[], datasources[], topics[], logSources[]}`.
  Nasce da devcontext (`package main` / compose service) + dichiarazione esplicita in Go Studio ("questo progetto è `users-service`").
- [ ] **Target** — `{kind: local-run | docker | remote, baseUrl, port, pid?, sessionId?}`. Il local-run si aggiorna da solo quando cambia porta.
- [ ] **Live Development Session** (runtime, non persistita):
  `{id, serviceId, goSessionId, processId, pid, port, env, debugger: {state: running|paused|stopped, file, line, fn, threadId}, activeRequest?, startedAt}`.
- [ ] **Request Run** — `{id, requestId (tab/collection item), sessionId?, correlationId, method, url, startedAt, state: sent|paused|completed|error, response?, hits: BreakpointHit[]}`.
- [ ] **Linked Request** — una request salva `serviceRef` invece di host hardcoded: `{{service:users-service}}/users/123` risolto dal target selezionato.
- [ ] Workspace graph = **derivato**, non un DB nuovo: Service → Target/Route/Datasource/Topic costruiti da devcontext + session manager. Nessuna persistenza extra finché non serve.

---

## Architettura

```text
Go Studio ─┐                         ┌─ API Workspace
Logs ──────┤   Dev Session Manager   ├─ Database Studio
Kafka ─────┤  (backend, Go, owner)   ├─ Broker Studio
Proxy ─────┘   + event bus (Wails)   └─ Global Debug Bar / Switcher (frontend store)
```

- [ ] `internal/devsession` — owner delle sessioni live; si abbona agli eventi di `internal/goide` (process/debug) e non li duplica.
- [ ] Binding sottile `devsession_bindings.go` + registrazione in `main.go`; bindings rigenerati con `wails3@v3.0.0-beta.25`.
- [ ] Eventi Wails tipizzati (unico canale, prefisso `devsession:`):
  `service.started` · `service.stopped` · `debug.started` · `debug.paused` · `debug.resumed` · `debug.stopped` ·
  `request.started` · `request.completed` · `breakpoint.hit` · poi `log.received` · `database.query` · `kafka.produced` · `kafka.consumed`.
- [ ] Store frontend `stores/devSession.ts` (Zustand): unica fonte per Debug Bar, API Workspace, switcher. Go Studio resta lazy (non importato da `App.tsx`; `npm run check:startup`).
- [ ] Ogni evento porta `sessionId`: nessuno stato attraversa sessioni.

---

# Phase 1 — Go Studio ↔ API Workspace (MVP)

**Cosa**: sessione live, Debug Bar globale, Send verso il servizio in esecuzione, stato PAUSED nell'API Workspace, Open in Go Studio, Debug Request base, route → handler e handler → request.

### Backend
- [ ] `internal/devsession`: crea la sessione su Run/Debug di Go Studio (servizio, PID, porta, env, debugger) e la chiude su Stop/uscita processo.
- [ ] Rilevamento porta: da run config / port check; fallback scan porte in ascolto del PID (riusa `/ports/listening` di Net Tools).
- [ ] Health/readiness: attesa TCP connect sulla porta (timeout configurabile, default 15 s); path HTTP opzionale.
- [ ] Inoltro stato Delve → `debug.paused {file, line, fn, goroutine}` / `debug.resumed` / `debug.stopped`.
- [ ] Comandi globali Continue / Step Over / Step Into / Step Out / Stop esposti dal session manager (delegano a `goide`).
- [ ] Correlazione request ↔ pausa: la request HTTP parte dal backend (`internal/httpexec`); se durante il volo arriva `debug.paused` sulla stessa sessione → `breakpoint.hit {requestRunId}`. Euristica temporale, dichiarata come tale.
- [ ] Header `X-AdOmnia-Request-ID` aggiunto alle request verso un servizio linkato (disattivabile in Settings).
- [ ] Timeout request **sospeso** mentre il debugger è in pausa (altrimenti la request scade al breakpoint).

### Frontend
- [ ] **Global Debug Bar** persistente (sotto la title bar / sopra la status bar), visibile in tutti i pannelli:
  `● users-service :8080 · PAUSED user_handler.go:84 · ▶ ↷ ↓ ↑ ■`. Compare solo con sessione attiva. Token del tema, niente colori hardcoded.
- [ ] API Workspace: selettore **Target** nella URL bar per request linkate (`● Local Run :8080 / ○ Docker :8090 / ○ DEV`).
- [ ] Stato **PAUSED AT BREAKPOINT** nel response panel: file:line, funzione, mini-timeline `Request ──●── Response`, azioni Open in Go Studio / Continue / Step Over / Stop; response mostra "Waiting for debugger…".
- [ ] **Open in Go Studio**: entity router → progetto giusto, file, riga, sessione debugger giusta; il tab della request resta aperto.
- [ ] Bottone **Debug Request** accanto a Send (Send resta il default):
  servizio running? → altrimenti avvia con Debug → attende readiness → invia → segue → mostra pausa → riceve response. Ogni passo visibile come stato (niente spinner muto).
- [ ] Pannello **Handler** nella request: "UpdateUser · user_handler.go:71 · Open handler" (match method+path contro route devcontext).
- [ ] Gutter Go Studio sull'handler: icona API → Open linked request / Run / Debug request / Last response / History.
- [ ] **Request Context** nel debugger (tab accanto a Variables): method, path params, query, header (Authorization mascherato), body, Request ID; "Open full request" torna al tab.
- [ ] **Keep Context**: cambiare pannello non smonta Go Studio né API Workspace (file, riga, variabili espanse, scroll, tab). Verificare e correggere dove oggi si perde stato.
- [ ] Shortcut: `Alt+1` Go Studio · `Alt+2` API Workspace · `Alt+3` Database · `Alt+4` Kafka · `Alt+5` Logs (controllare conflitti con keymap esistente).
- [ ] Command palette: Go to current breakpoint · Go to current request · Go to handler · Go to service · Debug this request · Continue/Step/Stop.

### Linguaggio visivo
- [ ] Un solo punto di stato: verde running · giallo paused · rosso error · accento = collegato alla sessione attiva. Niente badge ovunque: un dot + testo.

### Rischi / difficoltà
- [ ] La correlazione pausa ↔ request è euristica senza instrumentazione: con richieste concorrenti può sbagliare → mostrare "probabile" quando >1 request in volo.
- [ ] Porta non nota (servizio che legge `PORT` da env/flag) → fallback scan porte del PID + scelta manuale ricordata per servizio.
- [ ] Processo figlio (`go run` → binario) → PID reale da usare è il figlio; riusa il process tree di `goide`.

### NON ancora
- Split Debug View, Context Switcher, Request Timeline, logs/DB/Kafka, servizi multipli in debug contemporaneo, persistenza delle sessioni.

### Verifica manuale Phase 1
- [ ] Scenario completo `users-service`: breakpoint in `UpdateUser` → Run with Debug → API Workspace `PUT /users/123` → Debug Request → PAUSED visibile in API Workspace e in Debug Bar → Open in Go Studio sulla riga giusta → Step Over dalla Debug Bar restando in API Workspace → Continue → response 200.
- [ ] Porta cambiata nella run config → la request linkata segue senza modifiche.
- [ ] Stop dalla Debug Bar → nessun processo orfano (Task Manager).

---

# Phase 2 — + Logs

**Cosa**: log del servizio collegati alla request e alla sessione.

### Backend
- [ ] Stdout/stderr del processo in sessione instradati come `log.received {sessionId, ts, line, level?, correlationId?}` (riusa Run console; parsing JSON log slog/zap/zerolog per `request_id`/`correlation_id`/`trace_id`).
- [ ] Ring buffer per sessione (limite righe) — niente persistenza.
- [ ] Correlazione: match sul `X-AdOmnia-Request-ID` se il servizio lo logga; altrimenti finestra temporale della request (marcata "by time").

### Frontend
- [ ] Response panel con tab `Response · Logs · Debug · Timeline`; Logs filtrati per service + request + correlationId.
- [ ] Da una riga di log: Open request · Go to code (se la riga contiene `file.go:N`).
- [ ] Integrazione con Log Inspector esistente (`lib/loginspector`) invece di un secondo viewer.

### Rischi
- [ ] Servizi che non propagano l'header → correlazione solo temporale; dirlo in UI, non fingere precisione.

### NON ancora
- Log da Docker/remoti, indicizzazione persistente, ricerca full-text cross-sessione.

---

# Phase 3 — + Database / Kafka

**Cosa**: "Last DB operation" e "Produced event" legati alla request.

### Backend
- [ ] **DB**: niente driver wrapper nel codice utente. Opzioni in ordine: (1) query nei log se il servizio le logga, (2) proxy TCP locale Postgres/MySQL opzionale verso la datasource del servizio → `database.query {sessionId, sql, durationMs, rows?}`. Decidere dopo spike su (2).
- [ ] **Kafka**: consumer passivo sui topic noti del servizio (da devcontext) durante la request → `kafka.produced {topic, partition, offset, key, headers}`; match su header `X-AdOmnia-Request-ID` se propagato, altrimenti per finestra temporale.
- [ ] Datasource/topic del servizio = entità devcontext già esistenti (compose/.env) → nessuna config nuova.

### Frontend
- [ ] Nel debugger (su repository call) e nella response: "Last DB operation · UPDATE users … · Open in Database" (DB Studio sulla connessione del servizio, query precompilata non eseguita).
- [ ] "Produced event · user.updated · p2 · offset 82912 · Open in Kafka" → Broker Studio posizionato su quel messaggio.
- [ ] Ritorno inverso: da DB Studio / Broker Studio "Open originating request" quando esiste il collegamento.

### Rischi
- [ ] Proxy DB = intercettazione di traffico con credenziali: solo opt-in, solo localhost, mai loggare password.
- [ ] Consumer Kafka non deve spostare offset di gruppi reali (consumer senza group / group dedicato effimero).

### NON ancora
- Mongo/Redis, query plan, eventi consumati da altri servizi, SQL tracing via instrumentation.

---

# Phase 4 — Full Development Context / Request Timeline

**Cosa**: il riepilogo completo del flusso di una request e la navigazione per contesto.

- [ ] **Request Timeline** locale: `Sent → Router → UpdateUser() ● → UserService.Update() → Repository → Response 200`, costruita da breakpoint hit + stack Delve + eventi DB/Kafka/log (non tracing distribuito).
- [ ] **Request Completed summary**: status, durata, file toccati (dallo stack), N query, N eventi, N log, N breakpoint.
- [ ] **Split Debug View**: Go Studio (editor + variables) | API request (headers, body, response in attesa). Si apre in automatico al primo `breakpoint.hit` (opzione in Settings), chiudibile, non modalità di default.
- [ ] **Context Switcher** (`Ctrl+Tab`): elementi del flusso corrente, non pagine — `users-service handler.go:84 ↔ PUT /users/123 ↔ users-db users ↔ Kafka user.updated ↔ Logs corr-7812`. MRU per sessione.
- [ ] **Service view**: albero `users-service → Go Project · REST API · localhost:8080 · users-db · user-events · Logs · Debugger` come punto d'ingresso unico (può vivere nel rail o nella Hub).
- [ ] Opzionale: breakpoint condizionato sul Request ID ("ferma solo su questa request") iniettando la condizione Delve su handler noti.
- [ ] Opzionale: OTLP receiver locale per servizi già instrumentati → timeline precisa invece che euristica (vedi §14/§32 in `gO-Studio-2027-todo.md`).

### Rischi
- [ ] La timeline dallo stack Delve vede solo dove ci si è fermati: senza OTLP è parziale → dirlo.
- [ ] Split view su finestre piccole: definire larghezza minima e fallback a tab.

### NON ancora
- Tracing distribuito multi-servizio, replay/time-travel, APM, dashboard generiche, AI.

---

## Idee ambiziose da valutare (solo se utili davvero)

- [ ] **Replay request al breakpoint**: dalla pausa, "Re-send same request" con body modificato senza lasciare il debugger.
- [ ] **Mock da runtime**: la response reale ottenuta in debug diventa un endpoint Mock Server con un click.
- [ ] **Contract drift live**: route vista a runtime/devcontext ma assente dall'OAS del servizio → avviso nella request.
- [ ] **Browser → servizio**: request partita dalla pagina (Browser Debugging) che colpisce il servizio locale → stessa correlazione e stesso stato PAUSED.
- [ ] **Proxy/Interceptor come sorgente**: traffico catturato verso `localhost:8080` diventa Request Run della sessione.

---

## Documentazione da aggiornare quando si chiude una fase

- [ ] `docs/GO-STUDIO.md` (sessione live, Debug Bar, shortcut).
- [ ] `docs/adomnia-feature-catalog.en.md` e `README.md` (feature visibili).
- [ ] `docs/ISSUES.md` (stato), `docs/ARCHITECTURE.md` (`internal/devsession` + eventi).
- [ ] `gO-Studio-2027-todo.md` §14 / §32 / P2 "Distributed Request Debugger" → rimandare qui.
