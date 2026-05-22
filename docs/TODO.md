# TODO.md — adOmnia — Cosa manca

2026-05-15 — basato su analisi reale del codice (Go backend + React frontend).

---

## 🔴 BACKEND — Bug da fixare

### vault.go
- `vault.go:141-154` — `unlock` genera identity random invece di usare la scrypt identity derivata dalla passphrase. `_ = identity` → usare `identity` direttamente.

---

## 🟡 FRONTEND — Da implementare

### 1. Flows / Visual Flow Builder (priorità: ALTA)
- Pannello React attivo in `frontend/src/components/flows/FlowsPanel.tsx`
- Completato 2026-05-17: salvataggio/ricarica locale, salvataggio dentro workspace `.adomnia`, step request/condition/wait/script, assertions per step, variabili estratte, export JSON/Markdown, fallimento step-by-step
- Da fare post-Stable: UX visuale piu completa, drag/drop e canvas.

### 2. Composer — configurazione richiesta (priorità: MEDIA)
- [ ] **Timeout per-tab**: input numerico nel composer (ms), passato alla fetch via AbortController
- [ ] **Toggle Follow Redirects**: checkbox nel composer, passato alla fetch
- [ ] **Load Test inline button**: già presente `onLoadTest` prop, manca il pulsante nella barra URL
- [ ] **Saved flash**: animazione checkmark dopo save (il componente `Check` esiste ma lo state `savedFlash` non triggera)

### 3. OpenAPI 3.0 Import (priorità: MEDIA)
- Backend parser da implementare o libreria JS pura (es. `swagger-parser`)
- UI: file upload o paste JSON/YAML → genera collezione

### 4. Code Generation — linguaggi aggiuntivi (priorità: BASSA)
- Attuali: cURL, JavaScript (fetch), Python (requests), Go, PHP, C#
- Mancanti: Java (OkHttp), Ruby (Net::HTTP), Rust (reqwest), Swift (URLSession), Kotlin (OkHttp), shell/wget, Node.js/http

### 5. WebSocket — feature avanzate (priorità: BASSA)
- [ ] Selezione sub-protocol
- [ ] Invio messaggi binari (attualmente solo testo)
- [ ] Auto-reconnect su disconnessione
- [ ] URL history / connessioni recenti
- [ ] Filtro/ricerca messaggi
- [ ] Export messaggi

### 6. Collections / Sidebar — UX (priorità: BASSA)
- [ ] Drag-and-drop riordinamento richieste e folder
- [ ] Multi-selezione / batch delete
- [ ] Context menu: Copy URL, Copy as cURL
- [ ] Navigazione da tastiera (frecce, Enter)

### 7. Composer — Scripts avanzati (priorità: BASSA)
- [ ] `pm.sendRequest()` — chained requests
- [ ] `pm.collectionVariables` — variabili di collezione
- [ ] `pm.visualizer` — visualizzazione custom
- [ ] Matchers aggiuntivi: `.to.be.null`, `.to.be.undefined`, `.to.not`, `.to.match()`
- [ ] Timeout esecuzione script (loop infinito freeza)

### 8. Altro (priorità: BASSA)
- [ ] Cookie editor per singole richieste
- [ ] GraphQL schema introspection
- [ ] gRPC proto file upload (backend endpoint da aggiungere)
- [ ] App auto-updater (download nuova versione)

---

## 🟢 COMPLETATO (per riferimento)

- ✅ Proxy Interceptor (815 linee) — traffic, rules, CA, map local/remote, throttle
- ✅ Browser Debug (9 file) — network, console, debugger, DOM inspector, storage, throttling
- ✅ **P1-27** — Browser debug: profilo temporaneo per-sessione con `os.MkdirTemp`, porta CDP dinamica con `findFreePort`, cleanup profilo su `StopBrowser` e `OnShutdown`, `GetDebugStatus()` esposto al frontend
- ✅ **P1-28** — WebSocket/SSE: limite massimo 20 sessioni (HTTP 429), auto-reap sessioni inattive ogni 30s (idle >5min), endpoint `GET /ws/list|/sse/list` e `POST /ws/close-all|/sse/close-all`, `WsShutdown`/`SseShutdown` su arresto app
- ✅ Kafka Workbench (494 linee) — produce, bulk, consume, topics, SASL
- ✅ Plugin Manager (306+ linee) — install, enable/disable, settings, hooks, runtime inspector, sandbox status, manifest stabile
- ✅ Vault (234 linee) — lock, unlock, encrypt, decrypt, import/export
- ✅ LoadTest (806 linee) — standalone + drawer, scenarios, reports, compare
- ✅ Utilities (1153 linee) — 30+ tools in 7 categorie
- ✅ gRPC Client (273 linee) — reflect, invoke, streaming, metadata
- ✅ Environment Matrix — request/collection/flow matrix, diffs, report JSON/Markdown/HTML
- ✅ Test Data Studio — generatori locali, preset, export JSON/CSV, bridge Runner
- ✅ NetTools (~400 linee) — DNS lookup/trace/compare/cache, port scan, CORS test
- ✅ Mock Panel (672 linee) — CRUD, record & replay, hit log, export/import
- ✅ Storage Panel — browse bbolt, CRUD, search, export/import
- ✅ JSON Tools Panel — query, set, diff, humanize, stream, MIME detect
- ✅ Docker Lab — preset PostgreSQL/MySQL/MongoDB/Kafka/RabbitMQ/Redis, compose/env/README, workspace export/import, open in Database/Broker
- ✅ Template Marketplace — builtin, search, install end-to-end, categories, import/export, version defaults
- ✅ Themes — installed, skins dir, token reference, import URL, hot reload, icon.png/icon95.png switching
- ✅ Settings — general, appearance (theme/font/density/language), requests
- ✅ Workspace — save/load/delete, ForgeCore demo
- ✅ Markdown Editor
