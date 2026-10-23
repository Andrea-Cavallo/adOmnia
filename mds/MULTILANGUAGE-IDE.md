# Code Studio — Piano multi-linguaggio (solo lavoro aperto)

> **Visione:** un solo IDE, `Code Studio`, che si adatta al progetto. Stesso editor, stessa UI di Run/Debug/Test, per qualunque linguaggio; ciò che cambia lo decide un *provider* del linguaggio, non un `if go / if java` sparso. _Build. Run. Debug._

Riordinato il 2026-10-22. **Tutto ciò che è fatto sta in [`MULTILANGUAGE-IDE-DONE.md`](MULTILANGUAGE-IDE-DONE.md)** (Fasi 1–8, Java 9.4.x, Python PY-*, Fase 10 chiusa, registro avanzamento con le evidenze). Qui restano solo le voci aperte, i collaudi e le priorità. Estende `docs/architecture/ide-multilanguage-refactor.md`; per Java/Spring vedi `06-JAVA-SPRING-STUDIO.md`.

**Regole del piano** (invariate)
- Un task si spunta `[x]` solo quando è **fatto e verificato** (test mirati verdi o prova in app avviata). Build verde da sola non basta per le voci UI.
- Un commit verde per fase; mai il ramo rotto a fine sessione.
- Contratti pubblici stabili (binding Wails, JSON persistiti, workspace): si migra nei loader e si aliasa.
- Generico nel core, specifico nell'adapter; una capability si aggiunge solo con il primo consumatore reale.
- Le prove "in app" si registrano solo in `MANUAL-CHECK.md` con gli stessi ID (`ML-*`, `PY-M*`, `RS-M*`, `AG-M*`…); qui restano codice e test automatici.
- Nessuna feature nuova di un linguaggio finché l'adapter non passa il *contratto minimo* (vedi §P1-C).
- Nessun push su `develop` per il lavoro multilanguage: feature branch locale.

---

## Priorità (riordinate 2026-10-22)

Criterio: prima chiudere ciò che **esiste ma non è provato** (rischio di regressione invisibile), poi i residui dei linguaggi già consegnati, poi i nuovi blocchi per valore di prodotto, infine distribuzione e linguaggi opzionali.

| Pri | Blocco | Perché ora | Sezione |
| --- | --- | --- | --- |
| **P0-A** | Collaudo nativo di tutto l'implementato | Decine di funzioni (rename, Run UI, Python, Java, Markdown, tab multilinea, commit AI) hanno test automatici ma **zero prove su app avviata**; è il debito più rischioso | §P0-A |
| **P0-B** | Java: collaudi JS-14.M1–M3 / JS-1…17.M* (piano 06) + debug Gradle residuo (9.4.8) | JS-14 (completamento e outline senza JDT LS) è implementato e verificato con test (06, 2026-10-20): manca solo l'app | §P0-B |
| **P1-A** | Residui Python e JS/TS | Chiudono linguaggi già a metà strada, nessuna architettura nuova | §P1-A |
| **P1-B** | Residui UI Run/Fase 6–8 | Voci che richiedono l'app: albero per unità, riuso dev server, compound reale | §P1-B |
| **P1-C** | **Rust** — adapter completo nel codice (RS-0…RS-8 fatti); restano 11 voci: collaudi RS-M*, debug dei test, coverage, installer `toolmanifest`, misure RAM, drift documentale (ultime: RS-10.7/10.8) | Il valore è provarlo in app (RS-7.9 Live Session, CodeLLDB, rust-analyzer) | §P1-C |
| **P2-A** | Workflow agenti AG-1…AG-8 + AI-CHAT.4 | Grande, parte dopo che i linguaggi P0/P1 sono provati; AG-1+4+5 per primi | §P2-A |
| **P2-B** | Qualità trasversale e distribuzione: 10.3, 10.4, 10.5, 10.10, 10.7 | Misure RAM a 3 server dipendono da Python+Rust; release a fine blocco | §P2-B |
| **P3** | C# / Kotlin, documentazione per linguaggio (9.7, 9.8) | Solo dopo che P0/P1 passano il contratto minimo | §P3 |

Non riaprire funzioni già presenti: Git/diff, Double Shift, ricerca globale, cronologia locale, progetti/file multipli, monitor memoria, controlli LSP, script 7.4 (si collaudano, non si duplicano).

---

## P0-A — Collaudo nativo (tutto in `MANUAL-CHECK.md`)

Tutte le voci sotto sono **implementate**; manca la prova su app avviata (Windows + WebKitGTK per i controlli nativi in tema scuro, light + dark, IT + EN).

- [ ] 1.8 (ML-1.M1–M4) nome "Code Studio" in hub, rail, finestra staccata, light/dark, IT/EN.
- [ ] 2.8 rename: `go vet ./...`, `go test ./internal/ide/... ./internal/codestudio/... ./internal/languages/...`, `npx tsc --noEmit`, `npm run build`, `wails3 task dev` e giro completo con stato vecchio (migrazione chiavi/rail id). Gate grep Fase 2.
- [ ] 4.9 Run UI unica su Go, web e configurazione generica; WebKitGTK per `select`/`input`.
- [ ] RC-UI.M1 finestra Run configurations ridisegnata (ricerca, gruppi per unità, Detected, protezione draft).
- [ ] EDIT-MODE.M1 indicatore Vim/Emacs nella sessione nativa.
- [ ] ML-5.M1–M3 (suggestion e stato vuoto barra Run), ML-6.M1/M2 (unità, LSP per unità), ML-7.M1–M4 (formati, SQL→Database, script, Markdown/Yuque), ML-8.M1/M2/M4/M5 (riavvio, preview, compound, reload nativo), ML-10.M1/M2 (commit AI, tab multilinea).
- [ ] PY-M1…M13 (interpreti, LSP due unità/due server, installazione verificata e reinstallazione, pytest/coverage, exception breakpoint e due sessioni, URL/preview, gutter ▶ PY-M10, Ruff PY-M11, route/Project Services/Security PY-M12, dipendenze nell'editor e API docs PY-M13).
- [ ] AI-CHAT.M1–M3 (contesto condiviso, allegati, selezione modello/agente milk 0.7).
- [ ] ML-9.M12 (proposte Maven/Spring/Gradle su progetto reale), ML-9.M19 (debug Gradle), JS-15.M1 (datasource Spring → Database Studio).

## P0-B — Java

- [ ] **JS-14.M1–M3** (piano `06-JAVA-SPRING-STUDIO.md`): JS-14.1–14.6 (completamento Java e outline senza JDT LS) sono implementati e verificati con test; restano le prove in app, poi le altre `JS-1.M*`…`JS-17.M*` in `MANUAL-CHECK.md`.
- [ ] 9.4.8 debug in app di `spring-boot:run` e di `test`/`bootRun`/`run` Gradle (porta 5005; automatico già verde per Maven 3.4.5 offline e Gradle 8.13). Restano: import Buildship/classpath da JDT LS per Gradle con classe scelta, plugin Spring Gradle reale, ML-9.M19.
- [ ] Collegamento completo pom/Gradle al Security Center (parent/BOM e scansione Gradle sono in JS-8/JS-12).

## P1-A — Residui Python e JS/TS

**Python** (adapter già consegnato; vedi DONE)
- [ ] PY-0.2 prova di avvio reale su macOS e Linux dei tool pinnati (`basedpyright==1.40.2`, `debugpy==1.8.22`, Ruff 0.13.2); verificata solo Python 3.11/Windows. Licenze (tutte MIT) e wheel per piattaforma già verificate: vedi DONE.
- [ ] PY-4.3 verifica manuale completion/hover/rename/signature help su buffer non salvati, UTF-16, import `src/`, stub `.pyi` (PY-M6).
- [ ] PY-8.4 misure startup/idle/RAM su workspace misto (stessa fixture di 10.3 e RS-9.5), senza percentuali non misurate.
- [ ] 9.5 chiusura: spuntare solo con i collaudi PY-M e una revisione indipendente.
- Fuori primo perimetro (invariato): Jupyter, debugger remoto, Conda manager, installazione automatica di Python, PyPI publishing, runtime plugin Python.

**JavaScript / TypeScript (9.2)**
- [ ] UI dei test per unità JS/TS (ML-9.M20, include `node --test`).
- [ ] Debug con js-debug.
- [ ] Live Preview agganciata a script non-dev (collegato a 8.7).

## P1-B — Residui UI e Fasi 6–8

- [ ] 6.5 albero progetto, ricerca, problemi e test raggruppati per unità con filtro; risultati di ricerca non mescolano linguaggi senza etichetta.
- [ ] 7.2 verifica per formato (apre, evidenzia, formatta, outline). Buchi noti: TOML usa la sintassi `ini`; SCSS/YAML senza language server dedicato.
- [ ] 8.7 riuso di un dev server già avviato da Run nella Live Preview (richiede l'app).
- [ ] 8.8 prova in app di un compound reale (frontend + backend), gate Fase 8.
- [ ] Gate di fase ancora aperti: 4 (accettazione 4.9), 5 (suggestion con un click), 6 (monorepo misto), 7 (fixture "polyglot").

## P1-C — Rust

Ordine consigliato: **RS-0 → RS-1 → RS-7 (subito dopo RS-1)** → RS-2 → RS-3 → RS-4 → RS-5 → RS-6 → RS-8 → RS-9 → RS-10. Il dettaglio completo dei task è nella sezione "9.6 — Rust" più sotto (adapter completo a livello di codice dal 2026-10-22: restano 11 voci, quasi tutte collaudi in app e due di drift documentale da fare per ultime — vedi lo *Stato Rust* qui sotto). 9.6 resta l'entry point nel contratto minimo: un adapter registrato o una build verde non equivalgono a supporto.

**Stato Rust (aggiornato 2026-10-23)** — l'adapter `internal/languages/rust` è completo a livello di codice e test automatici (RS-0…RS-8 fatti); la tabella per blocco, le note inline di ogni task chiuso e il registro dei commit sono in [`MULTILANGUAGE-IDE-DONE.md`](MULTILANGUAGE-IDE-DONE.md) (sezione "Rust"). Qui restano solo i residui.

| Blocco | Residui aperti |
| --- | --- |
| RS-2 | vista UI dell'ambiente e "Clean analyzer cache" (raffinamenti) |
| RS-4 | inlay hints / colori semantici / Code Lens restano spenti fino a RS-M3 |
| RS-5 | — (RS-5.5 e RS-5.6 chiuse il 2026-10-23; restano i collaudi RS-M4/M5) |
| RS-6 | RS-6.5 attach (fuori primo perimetro); RS-6.6 test DAP reale |
| RS-7 | RS-7.9: prova del ciclo completo in app (**RS-M7**, gate di integrazione) |
| RS-8 | RS-8.4 licenze (fuori perimetro) |
| RS-9 | RS-9.5 misure RAM a 3 server |
| RS-10 | RS-10.5 collaudi RS-M1…; drift documentale chiuso (RS-10.7/RS-10.8 il 2026-10-23: CLAUDE.md, catalogo, ISSUES e README coerenti sul ramo "in preparation"); resta l'annuncio completo alla release, dopo RS-M7 |

**Aperti (6):** RS-6.5, RS-6.6, RS-7.9, RS-8.4, RS-9.5, RS-10.5. Drift documentale chiuso il 2026-10-23 (RS-10.7/RS-10.8, vedi la sezione qui sotto). Chiuse il 2026-10-23 (note inline nei task): RS-9.4 (`toolmanifest` generico), RS-5.6 (coverage `cargo-llvm-cov`, scelta RS-0.3) e RS-5.5 (debug del test, ▶ su `mod tests`, riga del panic). Nessun collaudo manuale RS-M* è spuntato; la casella "Verificato da altra persona/agente" resta non spuntata (regola 8).

**Non provati** (le prove con strumenti reali sono nel DONE): CodeLLDB (non installato), macOS/Linux, app avviata.

### Contratto minimo per dichiarare un linguaggio "supportato" (criterio P1-C, P3 e ogni nuovo adapter)
- [ ] `Language` + `ProjectDetector` + `DocumentSelector`
- [ ] LSP: `lsp.ServerSpec` con download/rilevamento **esplicito**
- [ ] `Runner` + `RuntimeProvider` (schema, validate, suggest)
- [ ] `TestRunner` con risultati strutturati (albero test, pass/fail, rerun)
- [ ] Debug (`DebugAdapterProvider`) *oppure* motivo documentato
- [ ] SDK/toolchain detection per unità
- [ ] Contribuzione UI: icona, comandi con `requires: { language }`, languageId Monaco
- [ ] Test fixture + `docs/CODE-STUDIO.md` aggiornato
- [ ] **Language parity**: route/datasource/topic/gRPC/WebSocket diventano entità `devcontext` (vedi RS-7)

## P2-A — Workflow agenti

Sequenza: AG-1 + AG-4 + AG-5 (task singolo con contesto) → AG-2 (parallelo/worktree) → AG-3 (review e integrazione) → AG-6 (Docker) → AG-7 (Teams). Dettaglio nella sezione "AG" più sotto (tutta pianificata, nessun task iniziato). Aperti anche:
- [ ] **AI-CHAT.3 BLOCCATO upstream** — milk ACP 0.7 legge solo blocchi testo (`cmd/milk/acp_session.go`); UI/backend rifiutano immagini non supportate. Sblocco: ingresso multimodale annunciato dall'agente o estensione upstream verificata, poi AI-CHAT.M4.
- [ ] **AI-CHAT.4** valutare session/list/resume con replay/upsert, piani multipli, follow-up dei job in background e board `team` di milk; non duplicare AG.

## P2-B — Qualità trasversale e distribuzione

- [ ] 10.3 prestazioni: Code Studio lazy, nessun server senza file aperto, **memoria con 3 server attivi** (Java + Python + Rust: dopo P1-C).
- [ ] 10.4 cross-platform: Windows (processi nascosti, DPAPI), Linux (WebKitGTK, form in tema scuro), macOS (compila).
- [ ] 10.5 accessibilità e tema: tastiera su barra Run/wizard, light + dark.
- [ ] 10.10 Homebrew: tap pubblicato, asset/checksum, install e upgrade su macOS (ML-10.M3); distinguere template da canale provato.
- [ ] 10.7 release: `develop` → ff `main` → tag, controllando ogni push; poi **sito `adOmniaWeb`** (regola "Website sync").
- Entry point: includere Procfile nelle proposte generiche (parsing locale, avvio su azione); Make/Compose/shell nel flusso Detected, senza nuovi runner.

## P3 — Linguaggi opzionali e documentazione

- [ ] 9.7 **C# e Kotlin** solo dopo che P0/P1 passano il contratto minimo; Kotlin riusa il lavoro Gradle/JVM di Java. C/C++, PHP, Ruby: solo su domanda reale.
- [ ] 9.8 per ogni linguaggio chiuso: `docs/CODE-STUDIO.md`, `docs/adomnia-feature-catalog.en.md`, `docs/ISSUES.md`, `README.md`, verifica AI (contesto minimo, cache).

**Gate per linguaggio:** progetto reale piccolo (clone di un esempio ufficiale) → aperto, indicizzato, eseguito, testato, debuggato con breakpoint in app avviata, **senza** modifiche al core.

---

### 9.6 — Rust: TODO dettagliato (2026-10-21)

**Obiettivo:** aprire una cartella Cargo (singolo crate o workspace), scegliere la toolchain per unità, modificare con rust-analyzer, eseguire `bin`/`example`, lanciare i test con albero strutturato e rerun, fermarsi a un breakpoint con CodeLLDB, e — soprattutto — **far sì che un servizio Rust (axum/actix/rocket/tonic/sqlx…) sia cittadino di prima classe in tutto adOmnia**: i suoi endpoint compaiono in API Workspace, nel Mock server, in cURL/OpenAPI e nella Live Session; le sue connessioni DB diventano connessioni nel pannello Database; le sue dipendenze finiscono nel Security Center; il suo `Dockerfile`/compose si avvia dal Docker Lab. Lo stesso Code Studio, gli stessi pannelli, nessun pannello "Rust".

**Pilastri:** Local-first (toolchain, analisi, build e processi locali; nessun servizio cloud, rete solo su azione come per `pom.xml`) e User-extensible (adapter, toolchain selezionabile, configurazioni versionabili). Enterprise: servizi Rust che parlano gRPC/Kafka/DB reali, non solo "hello world".

**Stato verificato:** `internal/codestudio/languages.go` registra Go, web, Java e Python; dal 2026-10-22 esiste anche `internal/languages/rust` (adapter con detection di crate/workspace — RS-0/RS-1 fatti), e `internal/devcontext` ha i detector Rust (`rustroutes`/`rustdb`/`rustenv`/`rustprotocols`/`rustbroker`/`rustopenapi`/`rustmodule`, RS-7 fatto; Python li ha dal 2026-10-21: `pythonroutes.go` + `languages/python/endpoints.go`, route e websocket FastAPI/Flask/Django; `detectFile` smista `go.mod`, `.go`, `.java`, `.py`, dotenv, compose, Makefile, `.sql`, `.proto`/`.wsdl`, OpenAPI). Entità già consumate dal resto del prodotto: `route`, `datasource`, `grpc`, `websocket`, `envvar`, `module`, `service`, `task`, `contract`. Il core ha già `ProjectDetector`/`UnitScanner`, `DocumentSelector`, `Runner`, `TestRunner`, `ServerProvider`, `UnitServers`, `FormatToolProvider`, `CoverageProvider`, `DebugAdapterProvider`, `Finisher`. Questo piano non reintroduce nulla di quanto è stato rimosso e non tocca il runtime plugin.

**Regola d'oro (CLAUDE.md, *Language parity*):** un linguaggio non è "supportato" finché non passa dall'intero prodotto. Per Rust significa che **RS-7 non è opzionale**: senza detector `route`/`datasource`/… l'adapter Rust è un editor con un bottone Run, non un linguaggio di adOmnia. La domanda di chiusura per ogni feature è: *funziona dal lato API test, dal Mock server, dal Database e dalla Live Session?*

**Ordine:** RS-0 → RS-1 → RS-2 → RS-3 → RS-4 → RS-5; poi RS-6 e **RS-7 (integrazione, parallela a RS-4/5 appena RS-1 esiste, perché non dipende da rust-analyzer)**; RS-8/RS-9/RS-10 chiudono. Un adapter registrato o una build verde non equivalgono a supporto completo.


#### RS-5 — Test Cargo strutturati

- [x] RS-5.5 *(2026-10-23: fatto — **Debug del test** (`internal/languages/rust/testdebug.go`): `cargo test --no-run --message-format=json` compila il **solo target scelto** (`--test <stem>` per `tests/<file>.rs`, `--bin` per `src/bin/<n>.rs` e `src/main.rs`, `--lib` per il resto; decide il `TestFile` del target o il nome dell'albero, mai l'eseguibile indovinato) → artefatto `profile.test` estratto dai messaggi cargo → CodeLLDB avvia quel binario con il filtro di libtest (`--exact <nome>`; un modulo è un prefisso). Campi `DebugOptions.Test/TestFile` e `RustDebugRequest.test/testFile` (binding rigenerati con `wails3@v3.0.0-beta.32`), ▶/menu Run+Debug del gutter, `debugSuite` dalla dashboard Test anche per Rust (`rustDebugRequestForNode`, il primo test fallito). **Limite dichiarato:** i doctest non si debuggano (nessun binario compilato). **▶ su `mod tests`** (`codeStudioRustTargets.ts`): il ▶ compare su ogni `mod <nome>` che contiene test (quindi `mod tests`, anche annidati), Run/Debug per prefisso. **Riga del panic: bug trovato e corretto** — il parser libtest non impostava `TestLocation.RelativePath` e il frontend apre i fallimenti solo per quello (come JS/Python): ora è relativo alla radice del progetto (`workspacePaths.rootRelative`) e doppio click/dettaglio aprono la riga del panic. Test verdi: `testdebug_test.go` (6 deterministici + **reale** `TestRealCargoTestDebugBuildsTheTestBinary` con cargo vero: build dell'eseguibile e filtro che esegue il solo test), `pathfix_test.go` (`rootRelative`), Vitest `codeStudioRustTargets.test.ts` (▶ su `mod tests`) e `codeStudioTestTree.test.ts` (debug request, doctest esclusi); `go test ./internal/languages/rust/...` con `ADOMNIA_TEST_CARGO=1`, `npx tsc --noEmit`, `go build ./...`/`go vet` verdi. **Resta la prova in app** RS-M4 (panic alla riga giusta) e RS-M6 (breakpoint sul test).)* 2026-10-22: ▶ nel gutter su `#[test]`/`#[tokio::test]`/`#[async_std::test]` (anche con altri attributi in mezzo e graffe dentro le stringhe), percorso `--exact` completo da file + moduli inline, menu Run, esecuzione nel pannello Test (`codeStudioRustTargets.ts` + test Vitest).)* ▶ nel gutter su `#[test]`/`#[tokio::test]`/`mod tests` e su ogni `fn` di test con Run/Debug (RS-6.2), rerun dall'albero, apertura alla riga del panic.
- [x] RS-5.6 *(2026-10-23: fatto — **scelta RS-0.3: `cargo-llvm-cov`** (tarpaulin non gira su Windows; provato con cargo-llvm-cov 0.9.1 + componente rustup `llvm-tools` su Windows). `internal/languages/rust/coverage.go`: `CoverageProvider` su `libtestParser`, report **LCOV** scritto in file temporaneo di sistema (fuori dal progetto) e convertito in `testing.CoverageReport` con blocchi per riga e percorsi relativi alla radice (stessa regola di Python); `TestCommand` con `coverage:true` usa `cargo llvm-cov --lcov --output-path … --no-fail-fast -- <filtri>` (cargo-llvm-cov compila in `target/llvm-cov-target` separato: la cache dell'utente non viene toccata). Strumento **opzionale**: senza cargo-llvm-cov il messaggio dà i comandi espliciti (`cargo install cargo-llvm-cov`, `rustup component add llvm-tools`), nessuna installazione automatica; senza "Run with coverage" il comando resta `cargo test` (baseline invariata). UI invariata: `TestRunRequest.coverage` arriva nelle LanguageOptions come prima. **Limite dichiarato:** doctest esclusi dalla coverage (`--doctests` unstable). Test verdi: 4 deterministici in `coverage_test.go` + **test reale** `TestRealCargoLlvmCovProducesCoverageReport` passato su Windows (suite `go test ./internal/languages/rust/...` con `ADOMNIA_TEST_CARGO=1` tutta verde). **Resta la prova in app** RS-M5.)* Coverage **opzionale** (`CoverageProvider`): `cargo-llvm-cov` (richiede componente `llvm-tools`) o `cargo-tarpaulin` (Linux), solo se presente/installato esplicitamente; report JSON/LCOV in cartella temporanea fuori dal progetto → `testing.CoverageReport` nella forma neutra, UI "Run with coverage" invariata. La baseline dei test non dipende dalla coverage. Decidere tra i due in RS-0.3 dopo prova su Windows/macOS/Linux; se nessuno è affidabile su Windows dichiararlo come limite.

#### RS-6 — Debug con CodeLLDB

- [ ] RS-6.5 Attach a un processo locale esplicito (pid) come estensione futura, **non** nel primo perimetro; nessuna porta su tutte le interfacce, nessun attach remoto implicito. Cleanup del processo e dell'adapter su errore/stop/chiusura; timeout se l'endpoint non si apre (come `debugAddressTimeout`).
- [ ] RS-6.6 Test DAP reale `TestRealCodeLLDBStopsAtBreakpoint`: breakpoint confermato, frame atteso, variabile attesa, evaluate, step, due sessioni, stop; adapter assente (messaggio + azione Install), crash adapter, timeout, binario mancante; skip espliciti se manca il tool.

#### RS-7 — Integrazione con tutto adOmnia (il blocco che rende Rust "di adOmnia")

**Principio:** ogni cosa rilevata da Rust diventa un'**entità del Developer Context** (`internal/devcontext`), riusando il **parser dell'adapter** (come `javaroutes.go` riusa `java.EndpointsInFile`); nessun regex Go-only e nessuna UI Rust. Un piccolo file per rilevatore, una riga in `detectFile` per `.rs`/`Cargo.toml`/`.cargo/config.toml`, limiti di dimensione e uscita rapida (`bytes.Contains` come il detector Java). Ogni entità porta `declName`/`declFile`/`declLine` per "vai alla definizione" e `Confidence` (`inferred` quando deriva da macro non risolvibili).
- [ ] RS-7.9 *(parziale 2026-10-22: `devsession` è già agnostico (porta in ascolto, `runServerURL`); aggiunti `cargo`/`rustc`/`rust-analyzer`/`codelldb` ai processi di tooling (test `infra_test.go`) così non vengono scambiati per il servizio. **Bug trovato e corretto:** `Manager.RunStarted` accettava solo i kind `run`/`binary`, quindi nessuna Run Rust (`bin`/`example`) diventava mai una sessione live; ora `serviceRunKinds` include `bin` e `example` (build/check restano esclusi, test `TestCargoRunBecomesALiveSessionButBuildDoesNot`). Nota: i kind Python `script`/`module` sono ancora esclusi allo stesso modo (fuori da questo task). **2026-10-23, prova automatica su fixture reale** (servizio `axum 0.8` + `sqlx` + `.cargo/config.toml`, `cargo run` provato con `curl` su `GET/POST /todos` e `GET /todos/{id}`): lo scan `devcontext` produce `route:GET /todos`, `route:POST /todos` (da `.route("/todos", get(list).post(create))`), `route:GET /todos/{id}`, `table:todos`, `envvar:DATABASE_URL`, `module:todos` e, con DSN `postgres://`, `datasource postgres@localhost:5432/todos` senza password. Una DSN `sqlite://file` non produce datasource (file locale, non connessione di rete). **Aperto, solo prova in app (RS-M7):** servizio axum reale → porta/URL nel pannello, traffico via Proxy, modifica file → restart comune senza doppio riavvio.)* **Live Development Session.** Il servizio Rust avviato dalla Run diventa la sorgente della Live Session come Go/Java: readiness su porta (`run.WaitPort`), URL locale da `runServerURL`, traffico mostrato nel pannello, e — con il Proxy/Interceptor — instradabile da/verso le route rilevate. Verificare il ciclo completo: *modifica il file → `cargo watch`/restart comune → il pannello torna verde senza doppio riavvio* (riuso del restart comune, non un watcher dell'adapter).

#### RS-8 — Dipendenze: `Cargo.toml`, albero e vulnerabilità

- [ ] RS-8.4 Licenze (`cargo-deny`-style) fuori primo perimetro. `cargo vendor`/registry privati fuori perimetro.

#### RS-9 — Sicurezza, persistenza e risorse

- [x] RS-9.4 *(2026-10-23: fatto — `internal/ide/toolmanifest` estratto dal package Python quando CodeLLDB è diventato il secondo consumer: formato del manifest `adomnia-tool.json` (Artifact/Manifest), `Ensure` (scrittura alla prima verifica e poi confronto), `ParseReport` per il report generico `install-report.json`, `IsSHA256`/`Digest`. Python refatto sul generico senza cambio di comportamento (alias di tipo, parsing del report di pip e verifica del dist-info restano in `internal/languages/python`). L'installer CodeLLDB scrive il report con artefatto/URL/SHA-256 della release pinnata dopo il checksum riuscito, `verifyManagedCodeLLDB` lega la cartella strumenti al manifest generico: un'installazione senza report o modificata non viene usata e il messaggio dice di reinstallare ("reinstall it from the editor notice"), `LocateCodeLLDB` lo riporta come warning. Test verdi: `internal/ide/toolmanifest` (nuovo), 6 nuovi in `codelldb_test.go`, `python` invariati; `go test ./internal/ide/... ./internal/languages/rust/... ./internal/languages/python/...` e `./internal/codestudio/...` (con `-skip "VCS|Git"`), `go build ./...` e `go vet` verdi. Versioni pinnate e destinazione isolata già invariati; niente `cargo install`, offline se già installato. **Resta la prova in app** del flusso "Install CodeLLDB…" e della reinstallazione (RS-M6).)* Installer: versioni pinnate, destinazioni isolate, artefatti/checksum verificati con `toolmanifest` generico (estrarlo dal package Python in `internal/ide/` se Rust è il secondo consumer reale — è proprio il caso), policy rete comune, niente `cargo install` globale silenzioso, funzionamento offline se già installato, messaggio utile offline.
- [ ] RS-9.5 **Risorse**: rust-analyzer è il server più pesante dopo JDT LS (RAM proporzionale al grafo di dipendenze). Misurare startup, idle e RAM su workspace misto **con la stessa fixture di PY-8.4 e JDT LS** (3 server attivi, vedi 10.3) prima di promettere numeri; Stop/Low resources libera LSP, DAP e figli (`cargo`, binario, `rustc`) tramite lo sweep comune senza perdere modifiche; `procMacro`/`buildScripts` disattivabili come opzione "Low resources".

#### RS-10 — Verifiche e documentazione

- [ ] RS-10.5 Collaudi **solo** in `MANUAL-CHECK.md`, sezione RS: **RS-M1** apertura workspace Cargo e selezione toolchain; **RS-M2** Run bin/example con errore di compilazione cliccabile; **RS-M3** rust-analyzer: installazione esplicita, completion/definition su `std` e su crate esterno, progetto non fidato senza server; **RS-M4** test: albero, rerun failed, doctest, panic alla riga giusta; **RS-M5** coverage (se presente); **RS-M6** debug CodeLLDB con breakpoint, evaluate e `Vec`/`String` leggibili su ogni piattaforma disponibile; **RS-M7** *gate di integrazione* con servizio axum+sqlx reale: route in API Workspace → richiesta → "Mock this tab" → connessione Database proposta (DSN sigillato) → URL nella Live Session; **RS-M8** `Cargo.toml`: update versione e marker CVE; **RS-M9** Low resources e misura RAM a 3 server; **RS-M10** Windows MSVC senza Build Tools (messaggio utile), macOS e Linux/WebKitGTK per i controlli del dialogo toolchain.

**Drift documentale — ULTIME cose da fare dei task Rust** (dopo i collaudi RS-M*, alla release; annotati il 2026-10-22 dal confronto piano↔codice):

- [x] RS-10.7 *(2026-10-23: fatto — le due frasi stale di `CLAUDE.md` sono riscritte sullo stato reale: "Rust (`internal/languages/rust`) is complete in code and tests … waits only for its manual app checks (RS-M1…RS-M10, RS-M7 being the integration gate)" al posto di "detection now, run/test/debug next", e "Rust is no longer planned: its adapter is delivered" al posto di "Rust remains planned (§9.6)". Anche la chiusura della sezione Python di `docs/ISSUES.md` ("Rust has no adapter yet") è stata aggiornata.)* `CLAUDE.md` root ha due frasi stale sullo stato Rust: "Rust is being added incrementally (`internal/languages/rust`: crate/workspace detection now, run/test/debug and rust-analyzer next…)" e "Rust remains planned (§9.6)" (§ Code Studio e § pinned tools). Vanno riscritte sullo stato reale — adapter completo RS-0…RS-8, restano i collaudi RS-M* e i residui dichiarati — **per ultime**, così non invecchiano di nuovo mentre si collauda.
- [x] RS-10.8 *(2026-10-23: fatto sul ramo "in preparation" coerente — RS-M7 non è chiuso, quindi niente annuncio. `docs/adomnia-feature-catalog.en.md` ha la sezione "Rust IDE adapter — in preparation" (esplicita "not announced as supported yet"), `docs/ISSUES.md` la sezione "Rust Code Studio - in preparation (2026-10-23)" con l'elenco dei residui aperti, `README.md` dice "Rust is in preparation behind the same interface (not announced as supported yet)", e `CHANGELOG.md` resta "in preparation, not announced yet": tutto allineato. **Resta alla release**: dopo RS-M7 passare all'annuncio vero (README+catalogo+sito `adOmniaWeb`, regola "Website sync") — o decidere di annunciare prima, ma è una scelta esplicita, non un drift.)* Annuncio incoerente: `CHANGELOG.md` ha già in cima il blocco Rust ("in preparation, not announced yet") mentre `docs/adomnia-feature-catalog.en.md`, `docs/ISSUES.md`, `README.md` e il sito `adOmniaWeb` non lo menzionano (RS-10.4). **Alla release, per ultimo**: o tutto annunciato (solo dopo il gate RS-M7) o tutto "in preparation", coerenti; se il tag di release cambia, rispettare la regola "Website sync".

**Vincoli noti:** `TestVCSStatusFindsNestedRepositories` si blocca in questo ambiente (un `git commit` semplice va in timeout: hook/configurazione locale) — la suite `codestudio` si lancia con `-skip "VCS|Git"`. Python: i kind `script`/`module` non diventano sessioni live (stesso difetto di Rust prima del fix, fuori da questo piano).

**Uscite incrementali:** RS-0–RS-3 = Run Rust nel Code Studio; **RS-7 (route/DB/Live Session) può uscire già dopo RS-1 perché non dipende da rust-analyzer** ed è il valore più alto per il prodotto; RS-4 = editing; RS-5–RS-6 = test/debug; RS-8–RS-10 = chiusura. Ogni uscita dichiara i propri limiti.

**Gate Rust:** clone di un esempio ufficiale (axum `examples/todos` o `realworld`, più un workspace con `build.rs`) → aperto, indicizzato, eseguito, testato, debuggato con breakpoint **e** collegato ad API Workspace/Mock/Database/Live Session in app avviata, **senza modifiche al core** (se servono, il contratto è sbagliato: correggerlo, non aggirarlo).

**Fuori primo perimetro:** installazione automatica di rustup/toolchain, embedded/`no_std`/WASM come flusso dedicato, cross-compilation gestita, profiler Rust, attach remoto, registry privati, `cargo vendor`, licenze/`cargo-deny`, `rust-script`/notebook (evcxr), framework di UI desktop/mobile (Tauri/Dioxus) come template, `warp`/`poem`/`salvo` finché non c'è utenza reale.

**Fonti ufficiali da rileggere in RS-0.2 (versioni da pinnare lì, non copiate qui):** [rust-analyzer manual e configurazione](https://rust-analyzer.github.io/manual.html), [rustup (toolchain file, componenti, variabili)](https://rust-lang.github.io/rustup/overrides.html), [Cargo book (manifest, workspace, config, `--message-format`)](https://doc.rust-lang.org/cargo/), [libtest e output dei test](https://doc.rust-lang.org/rustc/tests/index.html), [cargo-nextest](https://nexte.st/), [CodeLLDB](https://github.com/vadimcn/codelldb), [lldb-dap](https://lldb.llvm.org/resources/lldbdap.html), [crates.io sparse index](https://doc.rust-lang.org/cargo/reference/registry-index.html), [OSV ecosistema crates.io](https://ossf.github.io/osv-schema/), [axum](https://docs.rs/axum), [actix-web](https://actix.rs/docs/), [rocket](https://rocket.rs/guide/), [tonic](https://docs.rs/tonic), [sqlx](https://docs.rs/sqlx), [diesel](https://diesel.rs/guides/). Le firme dei macro/API cambiano tra versioni maggiori (es. sintassi dei path di axum 0.7 → 0.8): i detector RS-7 vanno testati su **entrambe**.

**Fonti ufficiali consultate per il piano (2026-10-21; versioni da pinnare in PY-0):** [basedpyright installazione](https://docs.basedpyright.com/dev/installation/command-line-and-language-server/), [configurazione LSP](https://docs.basedpyright.com/latest/configuration/language-server-settings/), [uv ambienti](https://docs.astral.sh/uv/pip/environments/), [uv comandi e sync](https://docs.astral.sh/uv/reference/cli/), [debugpy CLI](https://github.com/microsoft/debugpy/wiki/Command-Line-Reference), [debugpy configurazione](https://github.com/microsoft/debugpy/wiki/Debug-configuration-settings), [pytest documentazione](https://docs.pytest.org/en/stable/). Verificare nuovamente i contratti quando si implementano i relativi blocchi.


---

## AG — Workflow agenti in Code Studio e Teams (pianificato 2026-10-21)

**Obiettivo:** affidare ad agenti distinti implementazione, correzioni e analisi, eseguire task indipendenti in parallelo e revisionare risultati verificabili prima di integrarli. Il flusso utente è **Task → AI Agent → Code + Tests → Review → Merge**. L'agente implementa e propone; lo sviluppatore supervisiona, richiede correzioni e decide cosa integrare.

Il riferimento funzionale fornito dall'utente è il workflow di JetBrains Air; qui si pianificano funzioni di adOmnia, senza assumere integrazioni JetBrains, web o CLI già disponibili. Questa sezione autorizza solo la pianificazione: nessun task di implementazione è iniziato o completato.

### Base da riusare e confini

- `internal/ide/agentreview`, `stores/codeStudioAgentReview.ts`, `CodeStudioAgentReviewBar/Dialog`: esistono snapshot e review dei file con accettazione/rifiuto e protezione contro file modificati dopo il diff. Lo stato attuale è in memoria: non equivale a una review persistente per task/worktree con commenti e merge.
- Riusare i percorsi agenti/ACP e contesto AI già presenti, Git/diff, process manager, trust, Docker e task console. All'inizio di ogni blocco verificare i contratti correnti: presenza di una funzione non significa workflow completo.
- **Teams** è la sede richiesta per gestione del lavoro e automazioni. Prima dell'implementazione identificare il modulo e il relativo storage; se manca, pianificare un'estensione minima del coordinamento esistente. Non confonderlo con Microsoft Teams e non creare dipendenze cloud implicite.
- Pilastri: **Local-first** (task, log e artefatti locali/esportabili) e **User-extensible** (provider agenti, ACP e workflow configurabili). Servizi esterni solo quando selezionati dall'utente, con contesto e destinazione visibili.
- Motore in `internal/<dominio>/`, host Wails sottile; nessuna dipendenza da provider concreti in `internal/ide`. Nuove navigazioni tramite entity router, dialog/palette Code Studio comuni, UI lazy e neutra rispetto al linguaggio.

### AG-1 — Task e agenti distinti

- [ ] AG-1.1 Definire un task locale con ID stabile, progetto/unità, obiettivo, criteri di accettazione, file/aree assegnate, dipendenze, agente/provider e limiti di tempo/costo/risorse. Supportare implementazione, bugfix e analisi come intenzioni dello stesso modello.
- [ ] AG-1.2 Definire stati osservabili: bozza, in coda, preparazione, in esecuzione, richiesta intervento, verifica, in review, correzioni richieste, pronto da integrare, completato, fallito e annullato. Terminazione dell'agente e completamento del task sono eventi distinti.
- [ ] AG-1.3 Selettore agente per task con disponibilità, capacità effettive, modello/configurazione, origine locale/remota e prerequisiti. Ammettere agenti diversi per task diversi; dichiarare read-only quando è richiesto solo analizzare.
- [ ] AG-1.4 Rendere visibili piano, attività, modifiche e comandi; streaming con Stop, timeout, ripresa dove supportata e richiesta di intervento senza chiudere il task o perdere il diagnostico. Un errore provider non deve risultare come successo.
- [ ] AG-1.5 Conservare cronologia locale di prompt, decisioni, risultati e artefatti con limiti/retention, redazione dei segreti ed export. Versionare il formato e migrare in lettura senza cambiare sessioni/chat esistenti.

### AG-2 — Esecuzione parallela e Git worktree

- [ ] AG-2.1 Preparare un branch/worktree distinto per ogni task di scrittura, registrando repository, base commit, branch, directory e proprietario. Non condividere la stessa cartella di scrittura tra agenti concorrenti.
- [ ] AG-2.2 Prima di creare il worktree verificare stato Git e lavori non salvati. Rendere esplicito se si parte da un commit o da uno snapshot delle modifiche locali; niente stash/reset automatici o perdita di file utente.
- [ ] AG-2.3 Scheduler con concorrenza configurabile, coda, dipendenze, ownership dei percorsi e rilevamento sovrapposizioni. Task dipendenti attendono il risultato del predecessore; limiti separati per agenti, test e container.
- [ ] AG-2.4 Isolare anche porte, directory temporanee, report test e processi; mostrare CPU/RAM/task attivi e rendere Stop/Low resources selettivi. Chiudere un task non deve fermare gli altri o l'IDE.
- [ ] AG-2.5 Gestire repository non Git, worktree già esistente, branch occupato, submodule, Git LFS, spazio insufficiente e avvio parziale. Analisi read-only consentita senza worktree; scrittura condivisa mai usata come fallback silenzioso.
- [ ] AG-2.6 Cleanup esplicito e recuperabile: conservare diff/commit/artefatti prima della rimozione; distinguere annullamento, archiviazione e cancellazione. Verificare directory e ownership e non rimuovere checkout estranei.

### AG-3 — Review, commenti e richieste di correzione

- [ ] AG-3.1 Estendere Agent Review esistente con associazione task/agente/worktree/base SHA, elenco file e diff affidabile di aggiunte/modifiche/rimozioni/rinomine; gestire binari e file grandi con limiti dichiarati.
- [ ] AG-3.2 Aggiungere commenti sul diff con file, lato, intervallo e revisione di riferimento; thread aperti/risolti e commenti generali. Dopo nuove modifiche segnalare commenti obsoleti invece di agganciarli alla riga sbagliata.
- [ ] AG-3.3 “Richiedi correzioni” invia all'agente assegnato commenti selezionati e contesto minimo, nello stesso worktree; registrare il nuovo tentativo e mostrare il delta rispetto alla review precedente. Nessun invio a un provider diverso senza scelta esplicita.
- [ ] AG-3.4 Collegare evidenze Code + Tests: comandi, cwd, versioni, esito, durata, log e artefatti; distinguere test passati, falliti, non eseguiti e saltati. Legare l'esito al commit/diff verificato: modifiche successive invalidano il verde precedente.
- [ ] AG-3.5 Implementare “Pronto da integrare” e anteprima integrazione: base aggiornata, conflitti, file interessati e verifiche richieste. Merge/cherry-pick/applicazione diff soltanto su azione dello sviluppatore; nessun push, merge o approvazione automatica.
- [ ] AG-3.6 Conflitti e checkout sporco mantengono la review aperta; proporre risoluzione in un'area isolata e richiedere nuova review. Accettare un file nella review non equivale a un merge Git del task.

### AG-4 — Contesto progetto per gli agenti

- [ ] AG-4.1 Compositore del contesto con file/selezione, simboli, diagnostica, documentazione, regole progetto e metadati di build/test. Riusare devcontext, registry editor/LSP e filtri AI esistenti; niente seconda indicizzazione globale.
- [ ] AG-4.2 Anteprima di ciò che verrà fornito: origine, percorso/simbolo, quantità, limiti e destinazione. Applicare ignore, esclusioni segreti e budget prima dell'invio; cartelle vendor/cache/build escluse per default.
- [ ] AG-4.3 Snapshot coerente con il commit/worktree del task. Buffer non salvati inclusi solo con scelta esplicita e identificati come tali; non mescolare contenuto dell'editor principale e filesystem del worktree.
- [ ] AG-4.4 Recupero incrementale su richiesta dell'agente, cancellabile e confinato al progetto autorizzato; risposte troncate/negate spiegate. Documenti e output degli strumenti sono dati, non istruzioni che ampliano i permessi.
- [ ] AG-4.5 Contesto multi-linguaggio con capability effettive; assenza LSP non blocca file/documentazione. Cache invalidata su cambio revisione e task/sessioni isolati, senza credenziali o contenuti di altri progetti.

### AG-5 — Agent Client Protocol (ACP)

- [ ] AG-5.1 Inventariare ed estendere il client ACP esistente; verificare versione negoziata e capability dai contratti ufficiali al momento dell'implementazione. Non duplicare trasporto/session manager per ogni agente.
- [ ] AG-5.2 Registrazione agenti compatibili con comando/eseguibile, argomenti, ambiente redatto e verifica disponibilità; installazione esplicita quando necessaria. Supportare il percorso locale già esistente senza account o download automatici.
- [ ] AG-5.3 Collegare sessioni ACP al task e alla cwd del worktree/sandbox: streaming, tool calls, permission request, cancel e riconnessione. Funzioni non supportate restano indisponibili con motivo visibile.
- [ ] AG-5.4 Gestire crash, timeout, protocollo incompatibile, output malformato e provider che termina a metà modifica. Log tecnici redatti, retry esplicito e nessuna ripetizione automatica di operazioni con effetti non idempotenti.
- [ ] AG-5.5 Test di contratto con agente simulato e integrazione con almeno due implementazioni compatibili disponibili; matrice capability/protocollo documentata. Non chiamare universale una compatibilità provata su un solo agente.

### AG-6 — Sandbox e Docker

- [ ] AG-6.1 Definire profili visibili: worktree locale con permessi dichiarati e container Docker isolato. **Un worktree isola i file Git, non è una sandbox di sicurezza**; esprimere chiaramente la differenza nella scelta di esecuzione.
- [ ] AG-6.2 Container per task con worktree montato secondo i permessi, utente non privilegiato, limiti CPU/RAM/processi/tempo e filesystem temporanei. Niente mount della home o socket Docker nel container per default.
- [ ] AG-6.3 Politiche rete, eseguibili, filesystem e segreti per task: deny/restrict dove supportato e richieste di ampliamento esplicite. Credenziali solo quando necessarie, temporanee, redatte nei log e mai inserite nel repository o nelle immagini.
- [ ] AG-6.4 Immagini/template per linguaggio con versione/digest e dipendenze dichiarati; pull/build solo su azione. Docker assente, daemon fermo e ambiente offline hanno diagnostico e retry; nessun passaggio automatico a esecuzione host.
- [ ] AG-6.5 Mappare percorsi host/container per diff, test e diagnostica; gestire Windows/macOS/Linux e cleanup di container/volumi/processi anche dopo crash. Conservare prima i risultati necessari alla review.

### AG-7 — Automazioni nella componente Teams

- [ ] AG-7.1 Definire la UI Teams per elencare, creare, modificare, sospendere e rimuovere automazioni. Ogni automazione indica progetto, trigger, task template, agente, contesto, isolamento, limiti e destinatario della review; nessun modulo o servizio Teams considerato già implementato senza audit.
- [ ] AG-7.2 Trigger iniziali: avvio manuale e pianificazione locale con fuso orario; poi eventi Git espliciti. Dichiarare cosa accade ad app chiusa/offline, riavvio, cambio ora e run saltate: nessuna promessa di scheduler remoto o servizio sempre acceso.
- [ ] AG-7.3 Template per code review, proposta aggiornamenti dipendenze e manutenzione/test/documentazione. Gli aggiornamenti producono un worktree con diff e verifiche: non modificano direttamente il branch di lavoro e non vengono integrati da soli.
- [ ] AG-7.4 Deduplicazione trigger, lock per progetto/task, concorrenza, retry limitato e backoff; impedire loop in cui commit/output dell'automazione riattivano la stessa automazione indefinitamente.
- [ ] AG-7.5 Storico run con stati, log, costi se disponibili, artefatti e inbox “Da revisionare”. Notifiche locali configurabili; condivisione con altri membri, messaggi esterni o accesso a repository remoti richiedono destinatari e permessi espliciti.
- [ ] AG-7.6 Teams multiutente, se richiesto: definire ruoli proprietario/esecutore/revisore, controllo accessi e audit prima di aggiungere sincronizzazione. Primo rilascio local-first; nessun account/cloud obbligatorio per utilizzare task e automazioni locali.

### AG-8 — Sequenza, verifiche e criteri di uscita

**Sequenza:** AG-1 + AG-4 + AG-5 per un task singolo con contesto → AG-2 per task concorrenti → AG-3 per review/correzioni/integrazione → AG-6 per isolamento Docker → AG-7 per ricorrenze Teams. AG-2 e AG-6 restano requisiti dei task che dichiarano rispettivamente parallelismo in scrittura e sandbox; non sono simulati da etichette UI. Le priorità Python/Rust e i gate IDE esistenti restano separati.

- [ ] AG-8.1 Per incremento test mirati su stato task, confini filesystem, permessi, lifecycle processi, protocollo ACP, revisioni diff e scheduler; typecheck/build pertinenti. Suite complete solo al checkpoint finale o su modifiche trasversali.
- [ ] AG-8.2 Fixture end-to-end automatizzata con due task indipendenti in worktree distinti, test reali, commento → correzione → nuova review e conflitto rilevato. Verificare che il checkout iniziale e le modifiche utente restino intatti.
- [ ] AG-8.3 Documentare persistenza/migrazioni, requisiti Git/Docker/agenti, limiti di piattaforma, segreti/rete, consumo e recupero dopo crash. Aggiornare guida Code Studio, catalogo e ISSUES soltanto quando le funzioni sono implementate, distinguendo roadmap da prodotto disponibile.
- [ ] AG-8.4 Registrare Impl / Test / Manuale / Doc per ogni blocco; accettazione desktop AG-M1–AG-M7 esclusivamente in `MANUAL-CHECK.md`. Non spuntare il workflow completo se manca un passaggio o il merge avviene senza decisione dello sviluppatore.

**Criterio di uscita prodotto:** lo sviluppatore crea un task, sceglie agente/contesto/isolamento, osserva codice e test, commenta il diff, richiede una correzione e integra esplicitamente il risultato verificato. Può interrompere ogni fase senza perdere il proprio lavoro. Le automazioni consegnano risultati nello stesso percorso di review.

---

## Rischi

| Rischio | Livello | Mitigazione |
| --- | --- | --- |
| Rename di ~800 file rompe import/binding/branch aperti | **Alto** | Fase 1 (solo UI) isolata e rilasciabile; rename in Fase 2 meccanico da mappa, un commit per sotto-fase, `tsc` + `go vet` ad ogni step |
| Perdita di stato utente (layout, impostazioni LSP, run config) | **Alto** | Migrazione in lettura, vecchie chiavi non cancellate per un rilascio, test idempotenza |
| Formato `.adomnia/run-configurations.json` condiviso via Git rotto tra versioni | **Alto** | 3.4: scrittura doppia (campi piatti Go + `languageOptions`) per un rilascio |
| Download automatici di server/debugger violano il local-first | Medio | 9.3: installazione solo esplicita, pinnata e verificata |
| Più language server attivi insieme saturano RAM | Medio | Avvio lazy per (linguaggio, unità), spegnimento per inattività, 10.3 |
| Lo schema dinamico produce una UI generica e brutta | Medio | 4.1: direzione visuale prima del codice; componenti di campo curati; verifica visiva in app |
| Scope enorme (9 linguaggi) | Medio | Contratto minimo + gate per linguaggio; P0 prima, P2 solo dopo; C/C++/PHP/Ruby fuori piano |
| Estrazione prematura di interfacce | Basso | Regola del piano: capability solo con primo consumatore reale |

## Fuori perimetro (deliberato)

- Run target **Remote** (solo voce disabilitata e documentata).
- C/C++, PHP, Ruby (su domanda).
- Marketplace di estensioni di linguaggio di terze parti.
- Spostare in massa codice Go-specifico (profiler, race, goroutine…) in moduli generici: resta nell'adapter Go.

