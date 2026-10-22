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
| **P1-C** | **Rust** — prima RS-7 (integrazione prodotto), poi RS-0→3, 4–6, 8–10 | Il valore più alto è RS-7 (route/DB/Live Session) e non dipende da rust-analyzer | §P1-C |
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

Ordine consigliato: **RS-0 → RS-1 → RS-7 (subito dopo RS-1)** → RS-2 → RS-3 → RS-4 → RS-5 → RS-6 → RS-8 → RS-9 → RS-10. Il dettaglio completo dei task è nella sezione "9.6 — Rust" più sotto (tutta aperta, nessun task iniziato). 9.6 resta l'entry point nel contratto minimo: un adapter registrato o una build verde non equivalgono a supporto.

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

**Stato verificato:** `internal/codestudio/languages.go` registra Go, web, Java e Python; dal 2026-10-22 esiste anche `internal/languages/rust` (adapter con detection di crate/workspace — RS-0/RS-1 fatti), mentre `internal/devcontext` non ha ancora un detector Rust (arriva con RS-7; Python l'ha dal 2026-10-21: `pythonroutes.go` + `languages/python/endpoints.go`, route e websocket FastAPI/Flask/Django; `detectFile` smista `go.mod`, `.go`, `.java`, `.py`, dotenv, compose, Makefile, `.sql`, `.proto`/`.wsdl`, OpenAPI). Entità già consumate dal resto del prodotto: `route`, `datasource`, `grpc`, `websocket`, `envvar`, `module`, `service`, `task`, `contract`. Il core ha già `ProjectDetector`/`UnitScanner`, `DocumentSelector`, `Runner`, `TestRunner`, `ServerProvider`, `UnitServers`, `FormatToolProvider`, `CoverageProvider`, `DebugAdapterProvider`, `Finisher`. Questo piano non reintroduce nulla di quanto è stato rimosso e non tocca il runtime plugin.

**Regola d'oro (CLAUDE.md, *Language parity*):** un linguaggio non è "supportato" finché non passa dall'intero prodotto. Per Rust significa che **RS-7 non è opzionale**: senza detector `route`/`datasource`/… l'adapter Rust è un editor con un bottone Run, non un linguaggio di adOmnia. La domanda di chiusura per ogni feature è: *funziona dal lato API test, dal Mock server, dal Database e dalla Live Session?*

**Ordine:** RS-0 → RS-1 → RS-2 → RS-3 → RS-4 → RS-5; poi RS-6 e **RS-7 (integrazione, parallela a RS-4/5 appena RS-1 esiste, perché non dipende da rust-analyzer)**; RS-8/RS-9/RS-10 chiudono. Un adapter registrato o una build verde non equivalgono a supporto completo.

| Blocco | Risultato | Sede principale proposta |
| --- | --- | --- |
| RS-0/1 | Contratto, unità Cargo, workspace/target | `internal/languages/rust/{language,detect,cargo}.go` |
| RS-2 | Toolchain per unità (rustup / `rust-toolchain.toml`) | `internal/languages/rust/toolchain.go`, settings esistenti |
| RS-3 | `cargo run`/example/bench nella Run UI comune + errori cliccabili | `internal/languages/rust/{runner,suggest,diagnostics}.go` |
| RS-4 | Editor con rust-analyzer | `internal/languages/rust/server.go`, `components/ide/languages/rust/` |
| RS-5 | Test Cargo nell'albero Test (+ coverage opzionale) | `internal/languages/rust/{test_runner,libtest}.go` |
| RS-6 | Debug con CodeLLDB | `internal/languages/rust/debug.go`, DAP esistente |
| RS-7 | **Integrazione prodotto**: entità, API, Mock, DB, Live Session, Security, Docker, AI | `internal/devcontext/rust*.go` (+ riuso del parser dell'adapter), nessuna UI nuova |
| RS-8 | Dipendenze: `Cargo.toml` intelligente, albero, CVE | `internal/languages/rust/cargodeps.go`, `securityintel` |
| RS-9 | Sicurezza, persistenza, risorse (target/, lock, RAM) | installer, process layer, lifecycle |
| RS-10 | Verifiche e documentazione | test, docs, `MANUAL-CHECK.md` sezione RS |

I nomi nuovi sono proposte di collocazione. Estrarre utility nel core solo se riusate davvero.

#### RS-0 — Contratto, confini e decisioni da fissare

- [x] RS-0.1 *(2026-10-22: `rust` registrato in `languages.go`; unità `cargo-package`/`cargo-workspace`; selettore `.rs`→`rust`, `Cargo.toml`/`Cargo.lock`→`toml` (lo stesso selettore dell'estensione rust-analyzer). Le `LanguageOptions` (`toolchain`/`package`/`bin`/`example`/`features`/`profile`) arrivano con il Runner in RS-3: nessuna capability dichiarata prima del flusso. Test `language_test.go`/`cargo_test.go`/`detect_test.go` verdi, contracttest e `TestCapabilitiesListRegisteredLanguages` aggiornati.)* Registrare `rust` come ID stabile in `internal/codestudio/languages.go` (una riga); unità `cargo-package` e `cargo-workspace`, selettore `.rs`/`Cargo.toml`/`Cargo.lock`, opzioni `LanguageOptions` (`toolchain`, `package`, `bin`, `example`, `features`, `profile`). Capability dichiarate solo con il flusso funzionante.
- [x] RS-0.2 *(2026-10-22: decisioni registrate, da ri-pinnare all'implementazione di RS-4/RS-6. rust-analyzer: preferire il componente `rustup component add rust-analyzer` allineato alla toolchain (fonte rust-analyzer.github.io/book), binario standalone come alternativa. CodeLLDB v1.12.3 (ultima verificata a oggi), licenza MIT, binari per piattaforma, adapter DAP su porta di loopback. Flag cargo tutti stabili da tempo: `--message-format=json`, `--message-format=json-diagnostic-rendered-ansi`, `--workspace`, `--exclude`; minimo dichiarato = stable Rust recente, il floor esatto si verifica con fixture reali in RS-3/RS-5.)* Fissare **versioni e matrice** dopo verifica sulle fonti ufficiali (non copiare numeri da esempi): rust-analyzer (preferire il componente `rustup component add rust-analyzer` allineato alla toolchain; il binario scaricato a parte è l'alternativa), CodeLLDB (release pinnata, licenza, binari per piattaforma, adapter con porta), edizione minima supportata, Windows (MSVC e GNU) / macOS / Linux. Fissare anche il minimo di `cargo`/`rustc` per i flag che usiamo (`--message-format=json`, `--workspace`, `--exclude`).
- [x] RS-0.3 *(2026-10-22: deciso — **cargo-nextest** come trasporto strutturato quando presente (installazione esplicita, come gli altri tool), con **fallback dichiarato** sul parser dell'output umano quando nextest manca: i nomi si ricavano da `cargo test --list`, mai dal rendering colorato. Motivo: il JSON di libtest (`-Z unstable-options --format json`) richiede nightly, che non si forza all'utente (local-first). La prova reale su fixture avviene in RS-5.)* **Decisione trasporto test strutturato** (gate bloccante di RS-5, da scrivere qui prima di codare): l'output JSON di libtest (`-Z unstable-options --format json`) richiede nightly; sulla stable le opzioni sono `cargo-nextest` (strumento esterno opzionale con installazione esplicita) oppure un parser dell'output umano **solo come fallback dichiarato**. Provare ciascuna con fixture reale e scegliere in base a: node ID stabili, streaming, cattura stdout/stderr, doctest, panic, `#[ignore]`, `should_panic`. Niente parsing fragile dell'output colorato senza dichiararlo.
- [x] RS-0.4 *(2026-10-22: deciso — selezione locale in `.adomnia/rust.local.json` (toolchain/percorsi assoluti, per macchina), configurazione condivisa in `.adomnia/run-configurations.json` (portabile via Git, nessun percorso assoluto né segreto). Stesso schema di `python.local.json`.)* Separare **selezione locale** (toolchain/percorsi assoluti: `.adomnia/rust.local.json`, per macchina) da **configurazione condivisa** (`.adomnia/run-configurations.json`, portabile via Git, nessun percorso assoluto, nessun segreto). Stesso schema di `python.local.json`.
- [ ] RS-0.5 *(parziale 2026-10-22: fixture di detection già in `detect_test.go` — bin singolo, workspace con membri, root package+workspace, esclusione `target/`, manifest malformato tollerato, monorepo misto, nessun manifest. Il resto della fixture — workspace a 3 membri con `examples/`, `build.rs`/proc-macro, axum/actix/sqlx/tonic — arriva con RS-3/4/5/6/7, quando quei blocchi hanno il primo consumatore.)* Fixture piccole: crate `bin` singolo; workspace con 3 membri (lib + bin + `examples/`); crate con `build.rs` e proc-macro; servizio axum minimale; servizio actix con attributi; crate con `sqlx`/`diesel`; crate `tonic` con `.proto`; monorepo misto Go/web/Java/Python/Rust. Riusare la suite `contracttest`, non creare un secondo registry.
- [x] RS-0.6 *(2026-10-22: confini già fissati in "Fuori primo perimetro" sotto; nessuna installazione automatica di rustup/toolchain/target, nessun `no_std`/embedded/WASM, cross-compilation solo `--target` esplicito.)* **Confini deliberati** (da riportare in "Fuori perimetro"): niente installazione automatica di rustup/toolchain/target; niente supporto `no_std`/embedded/WASM come feature (si esegue ciò che Cargo esegue); niente profiler Rust dedicato; niente Cargo registry privato gestito dall'IDE. Cross-compilation: solo `--target` esplicito nello schema, senza gestione dei target.

#### RS-1 — Rilevamento progetto, workspace e target

- [x] RS-1.1 *(2026-10-22: adapter `internal/languages/rust` (`language.go`, `detect.go`, `cargo.go`), zero import Rust nel core; icona `rust` già presente in `brandIcons.generated.ts` (lo slug `rust` è già in `generate-brand-icons.mjs`); contribuzione UI `components/ide/languages/rust/index.ts` + una riga in `IDE_LANGUAGES`. Menu e comandi (`requires: { language }`) arrivano con il primo consumatore reale — RS-2.4 (toolchain) e RS-3 (run) — non come placeholder vuoti.)* Adapter `internal/languages/rust` con `Language` + `ProjectDetector`/`UnitScanner` + `DocumentSelector`, zero import Rust nel core; contribuzione UI in `components/ide/languages/rust/` (icona `rust` di Simple Icons aggiunta a `scripts/generate-brand-icons.mjs` e rigenerata, menu, comandi con `requires: { language }`) e una riga in `IDE_LANGUAGES`.
- [x] RS-1.2 *(2026-10-22: parser TOML **estratto** da `internal/languages/python/toml.go` in `internal/ide/toml` (condiviso, non duplicato) e riusato da Python e Rust; `cargo.go` parsa `[package]`, `[workspace]` (+`[workspace.dependencies]`/`[workspace.package]`), `[lib]`, `[[bin]]`/`[[example]]`/`[[test]]`/`[[bench]]`, `[features]`, `[dependencies]`/`[dev-dependencies]`/`[build-dependencies]`, `[patch]`. Mai eseguito `build.rs`/`cargo`. I target impliciti per convenzione (`src/main.rs`, `src/bin/*.rs`, `examples/*.rs`, `tests/*.rs`, `benches/*.rs`) si risolvono in RS-3.4.)* Parsing con il **parser TOML già scritto per Python** (`toml.go`: se riusabile da due adapter va estratto in `internal/ide/` generico, altrimenti duplicare è un bug): `[package]`, `[workspace]` (`members`, `exclude`, `default-members`, `[workspace.package]`/`[workspace.dependencies]` ereditati), `[lib]`, `[[bin]]`, `[[example]]`, `[[test]]`, `[[bench]]`, `[features]`, `[dependencies]`/`[dev-dependencies]`/`[build-dependencies]`, `[patch]`. Target impliciti per convenzione (`src/main.rs`, `src/bin/*.rs`, `examples/*.rs`, `tests/*.rs`, `benches/*.rs`). **Mai eseguire `build.rs` né `cargo` durante la scansione** (la discovery è statica come per `pom.xml`/`pyproject.toml`).
- [x] RS-1.3 *(2026-10-22: identità unità = cartella del Cargo.toml del package (`cargo-package`); workspace virtuale (senza `[package]`) = `cargo-workspace`; un package che è anche radice del workspace resta `cargo-package` (nessuna duplicazione). Nessuna unità per `.rs`. Membri via glob (`crates/*`) risolti in RS-7.8 per il grafo dei moduli, non necessari per la detection.)* Identità unità = cartella del `Cargo.toml` del **package**; la radice di un workspace virtuale (senza `[package]`) è un'unità `cargo-workspace` che raggruppa i membri senza duplicarli; membri via glob (`crates/*`) risolti con limiti. Nessuna unità per ogni `.rs`; script/`rust-script` fuori perimetro.
- [x] RS-1.4 *(2026-10-22: scansione condivisa `project.WalkDirectories` con limiti e cancellazione; il visitor salta `target/`, `.cargo/`, `.rustup/` (e `vendor/` è già ignorato globalmente); Cargo.toml malformato tollerato senza bloccare le altre unità. Symlink/percorsi con spazi/Unicode coperti dai test di run in RS-3.7.)* Scansione condivisa `project.WalkDirectories` con limiti e cancellazione; **escludere `target/`** (può pesare decine di GB), `.cargo/registry`, `vendor/` salvo workspace dichiarato; symlink risolti, percorsi con spazi/Unicode, `Cargo.toml` malformato tollerato senza bloccare le altre unità.
- [x] RS-1.5 *(2026-10-22: test detection/dedup/isolamento in `detect_test.go`/`cargo_test.go`/`language_test.go`; aggiornate le asserzioni storiche "Rust non ha adapter" in `TestCapabilitiesListRegisteredLanguages` (`service_test.go`, che ora include `rust` e verifica le sue capability) e `languages.test.ts` (`languageServerEditorLanguages`), e i doc `CLAUDE.md` root + `internal/ide/CLAUDE.md`. Il monorepo misto Go/web/Java/Python/Rust è coperto dal test di isolamento; "aprire un progetto esistente conserva unità e configurazioni" è prova in app (RS-M1).)* Test detection/dedup/isolamento/restore; aprire un progetto Go/web/Java/Python esistente conserva unità e configurazioni; il monorepo misto mostra tutte le unità. Aggiornare l'asserzione storica "Rust non ha adapter" in `suggest_test.go` (riga 156 di questo piano) solo quando l'adapter esiste.

#### RS-2 — Toolchain (rustup), `rust-toolchain.toml` e ambiente

- [ ] RS-2.1 Candidati con origine esplicita: scelta salvata per unità → `rust-toolchain.toml`/`rust-toolchain` del progetto (canale, `components`, `targets`) → `RUSTUP_TOOLCHAIN` → default di rustup → `cargo` nel PATH. Registrare la **fonte** e mostrarla; un `rust-toolchain.toml` che chiede un canale non installato è uno stato "mancante" con azione esplicita, **mai** un download implicito (rustup altrimenti scarica da solo alla prima invocazione: va evitato impostando `RUSTUP_AUTO_INSTALL=0`/equivalente verificato in RS-0.2 o controllando prima con `rustup toolchain list`).
- [ ] RS-2.2 Probe limitato e solo con progetto autorizzato: `rustc -vV` (versione, host triple, commit), `cargo -V`, elenco componenti (`rust-analyzer`, `rust-src`, `clippy`, `rustfmt`, `llvm-tools`). Timeout con `process.TerminateTree` (stessa lezione del probe Python appeso). Distinguere host `*-pc-windows-msvc` da `*-gnu`: l'MSVC richiede i Build Tools, segnalare il linker mancante con messaggio utile invece dell'errore grezzo di `link.exe`.
- [ ] RS-2.3 Azioni **separate e visibili** (come "Create environment" di Python): "Install component…" (`rustup component add rust-analyzer rust-src`), "Install toolchain…" (`rustup toolchain install <canale>`), con comando esatto nella conferma e Run console + task in status bar via `codeStudioToolInstall`. Nessun `rustup update` implicito, nessun `rustup default` che cambi la macchina dell'utente senza conferma.
- [ ] RS-2.4 Selettore toolchain per unità nel dialogo (riusare il modal dell'interprete Python, stati loading/error/retry); lo stesso valore alimenta Run/Test/Debug **e** rust-analyzer (RS-4.2). Cambio toolchain invalida solo le cache interessate e non cancella buffer né run config.
- [ ] RS-2.5 Variabili d'ambiente: `CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR`, `RUSTFLAGS`, `.cargo/config.toml` (alias, `[env]`, `[build] target-dir`, `[target.*] runner/linker`) letti **solo dal filesystem** per mostrarli e per RS-9.2; `[alias]` diventano proposte `task` (RS-7.6). Env-file e redazione dei segreti come le altre run.
- [ ] RS-2.6 Test: toolchain assente/incompatibile, `rust-toolchain.toml` con canale non installato, due unità con toolchain diverse nello stesso workspace, path con spazi, restore su macchina diversa (scelta salvata sparita → fallback dichiarato), timeout del probe.

#### RS-3 — Run, example, bench e diagnostica di build

- [ ] RS-3.1 `Runner`/`SchemaProvider`/`ConfigValidator`/`SuggestionProvider` sui contratti esistenti: kind `bin`, `example`, `bench`, `build`, `check`, `clippy` con selezione di package/target, `features` (lista), `--all-features`/`--no-default-features`, profilo `dev|release|<custom>`, `--target` esplicito, args del programma dopo `--`, cwd comuni. Form schema-driven comune; nessun `if (language === 'rust')` nel JSX condiviso.
- [ ] RS-3.2 argv distinti senza shell: `cargo run --package <p> --bin <b> [--features …] -- <args>`; validazione di package/bin/example contro i target rilevati (RS-1.2), features contro `[features]`, profilo contro `[profile.*]`; toolchain via `+<canale>` o `RUSTUP_TOOLCHAIN` come deciso in RS-0.2. Rifiutare input che non corrisponde a un target noto con messaggio che elenca i target disponibili.
- [ ] RS-3.3 **Errori di build cliccabili**: `cargo … --message-format=json-diagnostic-rendered-ansi` (verificare il nome esatto in RS-0.2) → diagnostici `file:riga:colonna` con severità, codice (`E0308`), span primario e suggerimenti `help:`, mappati sul pannello Problems/console come per Go e Java. Un parser per esecuzione, limiti di riga/output, e il testo `rendered` conservato per la console.
- [ ] RS-3.4 Proposte Detected: ogni `bin` (con il default package del workspace), ogni `example`, `cargo build --release`, `cargo check`, `cargo clippy -- -D warnings` (solo se `clippy` è tra i componenti), alias da `.cargo/config.toml`. Mostrare fonte e motivo di indisponibilità; salvare/duplicare/rieseguire con la UI esistente. Nessun proposta ambigua nei workspace con più bin senza `default-run`: elencarli.
- [ ] RS-3.5 Output progressivo, stderr, exit code, stop e process tree dal lifecycle Run comune (`cargo run` genera un figlio: la chiusura deve terminare **cargo e il binario**, verificato come `TestRunStopEndsARealPythonProcess`); il lock `Blocking waiting for file lock on build directory` va riconosciuto e spiegato (vedi RS-9.2). Barra del pannello Run con "Open in browser" riusa `runServerURL.ts`: verificare che le righe tipiche di axum/actix/rocket (`listening on 0.0.0.0:3000`, `Starting 4 workers`, `Rocket has launched from http://…`) producano l'URL (aggiungere i pattern **nel modulo comune**, con test).
- [ ] RS-3.6 ▶ nel gutter su `fn main()` (e `#[tokio::main]`/`#[actix_web::main]`), Run/Debug come Go/Java/Python, con la stessa guardia di autorizzazione e la stessa toolchain risolta. Target Rust in `lib/code-studio/` (puro, con test Vitest).
- [ ] RS-3.7 Test: esecuzione reale di un bin con argomenti Unicode/spazi, `example`, errore di compilazione con diagnostica attesa (codice + riga), feature inesistente rifiutata, cancel, cartella non fidata (la lettura resta possibile senza processi), `process_launch_guard_test.go` esteso a Rust.

#### RS-4 — Editor e rust-analyzer

- [ ] RS-4.1 `lsp.ServerProvider`/`ServerSpec` per `rust-analyzer` (stdio). Ordine di ricerca: componente rustup della toolchain dell'unità → binario gestito in `<tools>/rust-analyzer` → PATH. Se manca: stato "non installato" con `Install…` esplicito (`rustup component add rust-analyzer` come comando visibile, oppure release pinnata con checksum se la toolchain non è rustup), `providedServer: true`, installer comune e `toolmanifest` verificato (PY-8.3). Il banner dell'editor sparisce a installazione finita e il server parte da solo.
- [ ] RS-4.2 Un server **per unità** (`language.UnitServers`/`PerUnitSpec`, già generico): rust-analyzer lavora per workspace Cargo, quindi la radice è la cartella del workspace (un solo server per `cargo-workspace` con tutti i membri), non un server per ogni membro. Verificare con il monorepo misto che la chiave `(sessione, linguaggio, unità)` regga e che due workspace Cargo distinti diano due processi isolati.
- [ ] RS-4.3 **Impostazioni** passate via `workspace/didChangeConfiguration` e `initializationOptions`: `rust-analyzer.cargo.targetDir` (**cartella separata dalla `target/` dell'utente**, vedi RS-9.2), `cargo.features`, `cargo.target`, `check.command` (`check` vs `clippy`), `procMacro.enable`, `cargo.buildScripts.enable`, sysroot/`rust-src` dalla toolchain risolta. Rispettare `rust-analyzer.toml`/`.vscode/settings.json` non è richiesto: la fonte è `rust-analyzer.toml` del progetto e le preferenze Code Studio.
- [ ] RS-4.4 **Trust**: rust-analyzer esegue `build.rs` e proc-macro durante il caricamento del workspace — codice arbitrario del progetto. Quindi **avvio solo con progetto autorizzato** (`Authorization == AuthorizationPermitted`); in progetto non fidato l'editor funziona senza server con un notice che spiega il motivo e propone di autorizzare. Aggiungere la guardia a `process_launch_guard_test.go`. Questo è il gate di sicurezza analogo a "la collection di pytest importa i moduli".
- [ ] RS-4.5 Provider Monaco comuni: completion, hover, definition/references/implementation, rename, signature help, diagnostica (check/clippy), inlay hints, semantic tokens, code actions (quick fix di `rustc`/clippy, `Add missing match arms`), Structure, **navigazione su `std` e crate esterni** (richiede `rust-src`; documenti virtuali sola lettura come Java 9.4.7). Esporre solo ciò che il server annuncia. Il formato `lsp` di `tauri`-style macro expansion (`Expand macro`) è nice-to-have, non requisito.
- [ ] RS-4.6 Stato di caricamento: rust-analyzer emette `$/progress` ("Fetching metadata", "Building build scripts", "Indexing") per decine di secondi o minuti; mostrarlo nel task della status bar come per JDT LS, **non** come errore o blocco; un timeout non uccide il server finché progredisce.
- [ ] RS-4.7 Formattazione: `rustfmt` è lo strumento standard e oggi è un componente rustup; usare la capability generica `language.FormatToolProvider` (`rustfmt --emit stdout --edition <e> --config-path` con buffer su stdin, nella cartella del file, così legge `rustfmt.toml`) con **un solo owner** delle modifiche al salvataggio (come Ruff, PY-4.5); rust-analyzer non formatta in parallelo. Installazione di `rustfmt` solo via RS-2.3.
- [ ] RS-4.8 Lifecycle comune: avvio lazy alla prima apertura di un `.rs`, stop/restart/Low resources, assenza tool con stato e retry. Nessun server per la sola presenza del progetto. Test con server stub (routing e cambio toolchain) + **integrazione reale** `TestRealRustAnalyzerAnalysesWorkspace` (diagnostica su un errore di tipo, `definition` che entra in un crate path-dependency del workspace, rename di una variabile locale), con skip motivato se manca (`ADOMNIA_TEST_CARGO`/PATH).

#### RS-5 — Test Cargo strutturati

- [ ] RS-5.1 `TestRunner` con `cargo test` (o `cargo nextest run` se RS-0.3 lo sceglie e lo strumento è presente) e la toolchain risolta; la compilazione dei test esegue `build.rs`/proc-macro, quindi **solo con progetto autorizzato e su azione esplicita**.
- [ ] RS-5.2 Albero e identità stabili: crate → modulo (`a::b::tests`) → test, con `tests/*.rs` (integration test come crate separati), doctest (`src/lib.rs - parse (line 12)`), `#[ignore]`, `#[should_panic]`, `#[test]` async (`#[tokio::test]`). Run singolo per nome esatto (`-- --exact <path>`), selezione, suite, rerun failed dai nomi falliti; mai ricostruzione da output colorato (se RS-0.3 impone il fallback testuale, i nomi si ricavano dalla fase `--list` e non dal rendering).
- [ ] RS-5.3 `testing.BatchParser`/streaming nel core, parser Rust nell'adapter; mappare passed/failed/ignored/should_panic ok, panic con messaggio e **location `file:riga`**, durata, errore di compilazione dei test (che non è un test fallito: stato "build failed" con i diagnostici di RS-3.3), nessun test, cancellazione. Conservare stdout/stderr per test (libtest li cattura: `--nocapture` solo su richiesta) e il backtrace con `RUST_BACKTRACE` impostabile.
- [ ] RS-5.4 `Finisher` del core: i test rimasti aperti alla chiusura del processo (cancel/crash/abort per `panic = "abort"` o stack overflow) chiusi come skip con motivo, una sola volta (stesso contratto di pytest, `TestManagerFinishesOpenTestsWhenTheProcessEnds`).
- [ ] RS-5.5 ▶ nel gutter su `#[test]`/`#[tokio::test]`/`mod tests` e su ogni `fn` di test con Run/Debug (RS-6.2), rerun dall'albero, apertura alla riga del panic.
- [ ] RS-5.6 Coverage **opzionale** (`CoverageProvider`): `cargo-llvm-cov` (richiede componente `llvm-tools`) o `cargo-tarpaulin` (Linux), solo se presente/installato esplicitamente; report JSON/LCOV in cartella temporanea fuori dal progetto → `testing.CoverageReport` nella forma neutra, UI "Run with coverage" invariata. La baseline dei test non dipende dalla coverage. Decidere tra i due in RS-0.3 dopo prova su Windows/macOS/Linux; se nessuno è affidabile su Windows dichiararlo come limite.
- [ ] RS-5.7 Test: fixture con test che passano/falliscono/ignorati/should_panic/panic in thread, errore di compilazione, doctest, nomi di modulo annidati, `tests/` d'integrazione, cancel; test **reale** `TestRealCargoTestProducesTree` con skip motivato.

#### RS-6 — Debug con CodeLLDB

- [ ] RS-6.1 `DebugAdapterProvider` sul DAP esistente. **Gate di scelta** (RS-0.2): CodeLLDB (adapter DAP con LLDB incluso, pretty-printer Rust per `String`/`Vec`/`HashMap`/`Option`) contro `lldb-dap` (LLVM) contro `cppvsdbg` (Windows/MSVC, non ridistribuibile fuori da VS). Decidere per piattaforma, verificare la **licenza di ridistribuzione** e le limitazioni su Windows-MSVC (PDB) e Windows-GNU; documentare la matrice invece di promettere parità. Se un binario non è ridistribuibile, installazione esplicita come per JDT LS, mai bundle silenzioso.
- [ ] RS-6.2 Launch: build con `cargo build --message-format=json` (profilo `dev`, debuginfo) per ottenere il **percorso reale dell'artefatto** dal messaggio `compiler-artifact` (mai indovinare `target/debug/<nome>`), poi avvio dell'adapter su porta di loopback dinamica con quel binario, args/cwd/env della run. Debug dei test: stesso meccanismo con `cargo test --no-run --message-format=json` → eseguibile del test + filtro `--exact`.
- [ ] RS-6.3 Breakpoint, continue/step, thread, call stack, variabili, watch ed evaluate nei pannelli comuni (Threads come per Java). Verificare quali visualizzatori mostrano `Vec`/`String`/`Rc`/`Arc`/`Mutex` leggibili; ciò che non si legge è un limite dichiarato. Exception filter: panic (`rust_panic`) come breakpoint opzionale dichiarato dalla contribuzione linguaggio (`exceptionFilters`), come per debugpy.
- [ ] RS-6.4 `async`/Tokio: gli stack sono thread di worker, non task; dichiarare il limite (nessun "async stack" nei pannelli) invece di fingere un modello di task. Nessun reloader da neutralizzare, ma `cargo watch`/`bacon` nelle proposte lanciano figli: il debug parte sempre dal binario, non dal watcher.
- [ ] RS-6.5 Attach a un processo locale esplicito (pid) come estensione futura, **non** nel primo perimetro; nessuna porta su tutte le interfacce, nessun attach remoto implicito. Cleanup del processo e dell'adapter su errore/stop/chiusura; timeout se l'endpoint non si apre (come `debugAddressTimeout`).
- [ ] RS-6.6 Test DAP reale `TestRealCodeLLDBStopsAtBreakpoint`: breakpoint confermato, frame atteso, variabile attesa, evaluate, step, due sessioni, stop; adapter assente (messaggio + azione Install), crash adapter, timeout, binario mancante; skip espliciti se manca il tool.

#### RS-7 — Integrazione con tutto adOmnia (il blocco che rende Rust "di adOmnia")

**Principio:** ogni cosa rilevata da Rust diventa un'**entità del Developer Context** (`internal/devcontext`), riusando il **parser dell'adapter** (come `javaroutes.go` riusa `java.EndpointsInFile`); nessun regex Go-only e nessuna UI Rust. Un piccolo file per rilevatore, una riga in `detectFile` per `.rs`/`Cargo.toml`/`.cargo/config.toml`, limiti di dimensione e uscita rapida (`bytes.Contains` come il detector Java). Ogni entità porta `declName`/`declFile`/`declLine` per "vai alla definizione" e `Confidence` (`inferred` quando deriva da macro non risolvibili).

- [x] RS-7.1 *(2026-10-22: fatto — `internal/languages/rust/routes.go` (parser statico, `EndpointsInFile`) + `internal/devcontext/rustroutes.go` (detector) + `.rs` in `detectFile`. Riconosciuti: axum `.route("path", get(h).post(h2))` con `:param`/`{param}` e `any()`, actix attributi `#[get]/#[post]/#[route(method=…)]` + `web::scope("/p").route(...)` + `web::resource("/x")`, rocket `#[get("/x/<id>")]` (parametro `<id>`→`{id}`) + `.mount("/base", routes![…])`. Prefissi composti staticamente: mount rocket (nessuna route "fantasma" non montata) e scope actix inline. `ANY` per `any()`/`route()` senza metodo. Test verdi su `routes_test.go` (adapter) e `rustroutes_test.go` (devcontext). **Raffinamento registrato:** `.nest`/`.merge` axum e `route_service` non compongono il prefisso tra istruzioni/file — la route esce col percorso dichiarato e `ConfidenceInferred`, mai un prefisso indovinato (regola "mai indovinare").)* **Route HTTP → API Workspace, Mock, cURL, OpenAPI, Live Session.** `internal/devcontext/rustroutes.go` + parser in `internal/languages/rust/routes.go` (statico, tollerante, senza compilare): 
  - **axum**: `Router::new().route("/users/:id", get(h).post(h2))`, `.nest("/api", sub)`, `.merge(…)`, `.route_service`, path con `:param` e `{param}` (axum ≥ 0.8) normalizzati allo stesso formato di Go/Java;
  - **actix-web**: attributi `#[get("/x")]`/`#[post]`/`#[route(…, method="…")]`, `web::scope("/api")`, `.route("/x", web::get().to(h))`, `.service(...)`, `web::resource("/x")`;
  - **rocket**: `#[get("/x/<id>")]` (parametri `<id>` → `:id`), `routes![a, b]`, `.mount("/base", routes![…])`;
  - **warp/poem/salvo**: dopo i primi tre, solo se c'è utenza reale (non speculativo).
  Il prefisso di `nest`/`scope`/`mount` va composto risalendo il router nello stesso file e tra file dello stesso crate quando la composizione è statica; quando non lo è, emettere la route con `ConfidenceInferred` e il prefisso noto, **mai** indovinare. `ANY` per `any()`/`route()` senza metodo. Test come `javaroutes_test.go` su sorgenti reali di esempio ufficiali (axum examples, actix examples, rocket guide).
- [ ] RS-7.2 **Contratto OpenAPI → entità `contract`**: `utoipa` (`#[utoipa::path(get, path = "/x", …)]` e `#[derive(OpenApi)]`) e `aide` producono route con metodo/percorso/risposte; `utoipa`'s `.json` generato a runtime si importa dall'URL locale **solo su azione** (stesso vincolo di PY-7.3, nessun fetch automatico). I `.yaml`/`.json` OpenAPI già nel repo sono già coperti da `detectOpenAPI`.
- [x] RS-7.3 *(2026-10-22: fatto — `internal/languages/rust/db.go` (`DatabasesInFile`) + `internal/devcontext/rustdb.go` (`detectRustDatabase`, `detectCargoConfig`) + `.cargo/config.toml` in `interesting`/`detectFile`. Coperto: `DATABASE_URL` da `.cargo/config.toml [env]` → `datasource` (riuso di `datasourceFromValue`, mai la password); stringhe di connessione `with_uri_str`/`.connect`/`::open` (`postgres://`/`mysql://`/`mongodb://`) → `datasource`; tabelle da sqlx `query!`/`query_as!` (FROM/JOIN/INTO/UPDATE), diesel `table! { … }` e sea-orm `table_name = "…"` → entità `table`. `.env`/`docker-compose` già coperti dai detector dotenv/compose. **Raffinamento registrato:** `sqlite:` (DSN senza host) non ancora mappato da `datasourceFromValue`, `.sqlx/` offline data e `diesel.toml` non letti — le tabelle si ricavano comunque da `schema.rs` e dai sorgenti.)* **Database → pannello Database.** Entità `datasource` da: `DATABASE_URL` in `.env`/`.cargo/config.toml [env]`/`docker-compose` (già coperti dai detector dotenv/compose: verificare che `postgres://`/`mysql://`/`sqlite:`/`mongodb://` arrivino all'entità), `sqlx` (`sqlx::query!`/`query_as!` → tabelle usate; `.sqlx/` offline data; `migrations/*.sql` già coperti da `detectSQLMigration`), `diesel` (`diesel.toml`, `schema.rs` con `table! {}` → tabelle/colonne), `sea-orm` (`entity/*.rs`, `DeriveEntityModel`), `rusqlite`/`tokio-postgres`/`mongodb` (stringhe di connessione e `Client::with_uri_str`). Azione "Aggiungi connessione" → **stesso flusso sicuro del resto del prodotto**: DSN e password **sigillati prima di qualsiasi scrittura** (bbolt/localStorage), riferimenti opachi risolti solo in Go (vedi `docs/DATABASE-CONNECTIONS.md`); mai incollare un DSN in chiaro dalla run config. Le tabelle note dai sorgenti alimentano suggerimenti nel pannello Database (autocomplete e "Open table").
- [x] RS-7.4 *(2026-10-22: fatto — `internal/languages/rust/protocols.go` (`GrpcServicesInFile`) + `internal/devcontext/rustprotocols.go` (`detectRustGrpc`). Riconosciuti `tonic::include_proto!("greeter")` (package proto), `#[tonic::async_trait] impl Greeter for MyGreeter` (servizio) e `tonic_build::compile_protos("proto/x.proto")` (riferimento al `.proto` in `build.rs`) → entità `grpc` con `declFile`/`declLine`/`language`/`service`/`proto`. `Server::builder().add_service(…)` non rilevato di per sé: il servizio è già catturato da include_proto/impl.)* **gRPC/Protobuf.** I `.proto` sono già entità; aggiungere il collegamento con l'implementazione: `tonic` (`#[tonic::async_trait] impl Greeter for MyGreeter`, `tonic::include_proto!`, `build.rs` con `tonic_build::compile_protos("proto/x.proto")`, `Server::builder().add_service(…)`) → entità `grpc` con `declFile/declLine` del metodo e riferimento al `.proto`. Il pannello gRPC già esistente e il Mock leggono quelle entità.
- [x] RS-7.5 *(2026-10-22: fatto — `WebSocketsInFile` nell'adapter (`protocols.go`) + `detectRustWebSocket` nel devcontext (`rustprotocols.go`). Riconosciuti handler con `WebSocketUpgrade` (axum) o `ws::WebSocket` (actix-ws) e ritorni `Sse<` (axum SSE) → entità `websocket` con `role:server`/`handler`/`path` (il percorso arriva dalla route `.route("/ws", get(handler))` o `#[get("/ws")]`); l'SSE porta `sse:true`. `tokio-tungstenite` (API senza route dichiarata) fuori per ora.)* **WebSocket e SSE.** `axum::extract::ws::WebSocketUpgrade` / `.route("/ws", get(ws_handler))` e `actix-ws`/`tokio-tungstenite` → entità `websocket` (apre il WSPanel con l'URL ricavato); `axum::response::sse::Sse` → endpoint SSE nello stesso modo. Consumer reale già esistente (`gohandlers.go`/`goprotocols.go` fanno lo stesso per Go): riusare lo schema delle entità, non inventarne uno.
- [x] RS-7.6 *(2026-10-22: fatto — `internal/languages/rust/broker.go` (`BrokerTopicsInFile`) + `internal/devcontext/rustbroker.go` (`detectRustBroker`, chiamato da `detectRustFile`). Riconosciuti kafka `FutureRecord::to("topic")` e `subscribe(&["topic", …])`, RabbitMQ `queue_declare("queue")`, e `subscribe`/`publish` di async-nats/redis (broker dedotto dal contenuto del file) → entità `topic` con `broker`/`language`/`declFile`/`declLine`, deduplicate. Solo letterali statici; costanti nello stesso crate e `basic_publish` restano fuori per ora.)* **Broker/code.** `rdkafka` (`FutureProducer::send(FutureRecord::to("orders")…)`, `consumer.subscribe(&["orders"])`), `lapin` (RabbitMQ: `queue_declare`/`basic_publish`), `async-nats`, `redis` pub/sub → entità topic/queue visibili al KafkaPanel/broker con azione "Produce/Consume to this topic". Solo letterali di topic risolvibili staticamente; costanti nello stesso crate seguite, il resto è `inferred`.
- [x] RS-7.7 *(2026-10-22: fatto — `internal/languages/rust/env.go` (`EnvVarsInFile`) + `internal/devcontext/rustenv.go` (`detectRustEnv`, chiamato da `detectRustFile`). Riconosciuti `std::env::var("X")`/`env::var("X")`, `env!("X")`, `option_env!("X")`, `dotenvy::var("X")` e clap `#[arg(env = "X")]`/`#[clap]`/`#[command]` → entità `envvar` con `declFile`/`declLine`/`language`, deduplicate. `figment`/`config::Config::add_source` restano fuori per ora (nessun default letterale da mostrare). Nessuna lettura di `.env` reali come codice.)* **Variabili d'ambiente e config → `envvar`.** `std::env::var("X")`/`env!`/`option_env!`, `dotenvy::var`, `config::Config::builder().add_source(File::with_name("config/default"))`, `figment`, `clap` con `#[arg(env = "…")]` → entità `envvar` con default noto (solo da letterali), così il form di Run propone di compilarle (stesso ruolo di `application.yml` di Spring) e l'env-file/redazione esistenti si applicano. Mai leggere `.env` reali come codice; i segreti restano redatti.
- [ ] RS-7.8 **Workspace → `module`/`task`.** Membri del workspace Cargo → entità `module` (dipendenze path tra membri = archi del grafo, riuso di `internal/ide/graph`); `[alias]` di `.cargo/config.toml`, `justfile`/`Makefile`/`xtask` → entità `task` (riusare `tasks.go`: `Makefile` è già coperto, aggiungere `justfile` solo con utenza reale e non come runner nuovo). `Dockerfile` multi-stage con `cargo build --release` e `cargo-chef` → entità `service` collegata al Docker Lab già esistente (nessun runner Docker nuovo).
- [ ] RS-7.9 **Live Development Session.** Il servizio Rust avviato dalla Run diventa la sorgente della Live Session come Go/Java: readiness su porta (`run.WaitPort`), URL locale da `runServerURL`, traffico mostrato nel pannello, e — con il Proxy/Interceptor — instradabile da/verso le route rilevate. Verificare il ciclo completo: *modifica il file → `cargo watch`/restart comune → il pannello torna verde senza doppio riavvio* (riuso del restart comune, non un watcher dell'adapter).
- [ ] RS-7.10 **"Mock this endpoint" e "Open API"**: dalle `route` Rust il Mock server genera gli endpoint (solo l'endpoint a fuoco verso un runtime già attivo, come da CLAUDE.md), la collezione "Open API" si popola e cURL/OpenAPI export funzionano **senza ramo Rust** nei consumer. Prova in app con un servizio axum reale: API Workspace → invio richiesta → risposta dal binario in esecuzione → "Mock this tab" → stessa richiesta risponde dal mock.
- [ ] RS-7.11 **Developer Context minimo per l'AI**: le entità Rust (route, datasource, moduli, task) entrano nel contesto progetto per agenti/chat con la stessa redazione, **contesto minimo e cache** (regola AI ottimizzata): niente invio dei sorgenti interi, riassunto per crate, invalidazione per hash dei file `Cargo.toml`/`.rs` coinvolti. AG-4 consuma le stesse entità; nessun formato Rust-specifico.
- [ ] RS-7.12 Test: per ogni detector, fixture da esempi reali (axum/actix/rocket/tonic/sqlx/diesel/rdkafka) con asserzioni su entità, metodo/percorso normalizzati, `declLine`, confidenza; test di **non regressione** che Go/Java continuino a produrre le stesse entità; test architetturale che `internal/devcontext` importi `internal/languages/rust` solo come Java. **Gate di accettazione RS-7:** un servizio axum + sqlx reale, aperto in adOmnia senza altra configurazione, mostra le sue route in API Workspace, la sua `DATABASE_URL` come connessione proponibile nel pannello Database e il suo URL nella barra Run; è provato in app (RS-M7), non solo dai test.

#### RS-8 — Dipendenze: `Cargo.toml`, albero e vulnerabilità

- [ ] RS-8.1 **`Cargo.toml` intelligente** (analogo di 9.4.9): `cargodeps.go` parsa dipendenze con riga/colonna di `version` (anche da testo non salvato), `workspace = true` (ereditate da `[workspace.dependencies]`), `path`/`git`/`registry`, `features`; lens `Check for updates` e `↑ versione` per dipendenza con **ricerca su crates.io solo su azione** (sparse index `index.crates.io`, cache ~30 min, esclusi i prerelease e le versioni *yanked*), quick fix che aggiorna la versione nel posto giusto (workspace root se ereditata). Nessuna chiamata di rete in rilevamento. Test `cargodeps_test.go` e `cratesindex_test.go` con server HTTP locale.
- [ ] RS-8.2 **Albero dipendenze** dal solo `Cargo.lock` (formato TOML stabile, offline, nessuna esecuzione) con duplicati di versione evidenziati; `cargo tree` (che può risolvere/scaricare metadati) solo su azione esplicita e con `--offline` preferito. Riusare la vista albero di `dependencytree.go`, non una nuova.
- [ ] RS-8.3 **Security Center / OSV**: `Cargo.lock` → pacchetti `crates.io` verso lo stesso motore `securityintel` già usato per Maven/npm (ecosistema OSV `crates.io`; advisory RustSec ne fanno parte) con marker CVE inline nel `Cargo.toml` e quick fix al fix version. Se il motore è offline-first, usare la sua cache; la scansione parte solo su azione. `cargo-audit`/`cargo-deny` restano strumenti opzionali dell'utente, mai prerequisiti.
- [ ] RS-8.4 Licenze (`cargo-deny`-style) fuori primo perimetro. `cargo vendor`/registry privati fuori perimetro.
- [ ] RS-8.5 Test: lock con duplicati, dipendenze git/path, ereditate dal workspace, crate yanked, rete assente (messaggio utile), advisory nota su una versione fissata nella fixture.

#### RS-9 — Sicurezza, persistenza e risorse

- [ ] RS-9.1 Tutti i processi (probe `rustc`, `cargo`, `rustup`, rust-analyzer, CodeLLDB, installazioni) passano dal trust/process layer; **nessuna esecuzione all'apertura di una cartella non fidata**. Attenzione particolare: `build.rs`, proc-macro, `.cargo/config.toml` (`[target.*] runner`/`linker`, `[build] rustc-wrapper`) e `cargo` alias possono eseguire programmi arbitrari: mostrarli come avviso nel dialogo di autorizzazione quando presenti, **senza eseguirli** in lettura.
- [ ] RS-9.2 **Lock e directory di build**: `cargo` blocca `target/` per processo; se rust-analyzer e la Run condividono `target/` l'utente vede `Blocking waiting for file lock` e l'IDE sembra bloccato. Soluzione: rust-analyzer in `cargo.targetDir` dedicato sotto la cartella dati dell'IDE (per workspace, hash del percorso) e pulizia/limite di dimensione dichiarati; la Run e i test usano la `target/` dell'utente. Documentare il costo disco e offrire "Clean analyzer cache". Rispettare `CARGO_TARGET_DIR` impostato dall'utente.
- [ ] RS-9.3 Persistenza additiva e loader compatibili: nessuno schema esistente cambiato; toolchain assolute solo in `.adomnia/rust.local.json`; run config condivise senza percorsi assoluti né segreti né env risolti; migrazione solo se cambia davvero uno schema.
- [ ] RS-9.4 Installer: versioni pinnate, destinazioni isolate, artefatti/checksum verificati con `toolmanifest` generico (estrarlo dal package Python in `internal/ide/` se Rust è il secondo consumer reale — è proprio il caso), policy rete comune, niente `cargo install` globale silenzioso, funzionamento offline se già installato, messaggio utile offline.
- [ ] RS-9.5 **Risorse**: rust-analyzer è il server più pesante dopo JDT LS (RAM proporzionale al grafo di dipendenze). Misurare startup, idle e RAM su workspace misto **con la stessa fixture di PY-8.4 e JDT LS** (3 server attivi, vedi 10.3) prima di promettere numeri; Stop/Low resources libera LSP, DAP e figli (`cargo`, binario, `rustc`) tramite lo sweep comune senza perdere modifiche; `procMacro`/`buildScripts` disattivabili come opzione "Low resources".
- [ ] RS-9.6 Limiti di parsing/file/report, concorrenza, cache per toolchain/unità e nessuna contaminazione tra unità; test architetturali core/adapter e "gli adapter non si importano tra loro" verdi (Rust non importa Python/Java e viceversa; condividere solo via `internal/ide/*`).

#### RS-10 — Verifiche e documentazione

- [ ] RS-10.1 Per blocco: `go test ./internal/languages/rust/...` + package host/core toccati (`internal/devcontext` per RS-7), Vitest mirati e `npx tsc --noEmit` per il TS. Test reali (rust-analyzer, `cargo test`, CodeLLDB) separati dai deterministici, con skip motivati (`ADOMNIA_TEST_CARGO`).
- [ ] RS-10.2 Checkpoint integrazione: binding con `wails3` della versione pinnata in `go.mod` se cambia un'API, `go build ./...` (mai `go build .` nella root: usare `go vet` o `-o NUL`), `npm run build`, `npm run check:startup` (Code Studio resta lazy: nessun import Rust da `App.tsx`).
- [ ] RS-10.3 Aggiungere `rust` alla suite `internal/languages/contracttest` (una `Case`): identità, selettore, unità, suggerimenti validi, schema per ogni kind. Aggiungere i contract test di integrazione di `devcontext` (RS-7.12).
- [ ] RS-10.4 Documentazione: `docs/CODE-STUDIO.md` (sezione Rust con tool esterni richiesti, matrice piattaforme e limiti provati), `docs/adomnia-feature-catalog.en.md`, `docs/ISSUES.md`, `README.md`, `docs/LIVE-SESSION.md` se cambia, sezione sicurezza del `CLAUDE.md` root (build script/proc-macro). **Non annunciare Rust prima dell'adapter funzionante**; poi sito `adOmniaWeb` alla release (regola "Website sync").
- [ ] RS-10.5 Collaudi **solo** in `MANUAL-CHECK.md`, sezione RS: **RS-M1** apertura workspace Cargo e selezione toolchain; **RS-M2** Run bin/example con errore di compilazione cliccabile; **RS-M3** rust-analyzer: installazione esplicita, completion/definition su `std` e su crate esterno, progetto non fidato senza server; **RS-M4** test: albero, rerun failed, doctest, panic alla riga giusta; **RS-M5** coverage (se presente); **RS-M6** debug CodeLLDB con breakpoint, evaluate e `Vec`/`String` leggibili su ogni piattaforma disponibile; **RS-M7** *gate di integrazione* con servizio axum+sqlx reale: route in API Workspace → richiesta → "Mock this tab" → connessione Database proposta (DSN sigillato) → URL nella Live Session; **RS-M8** `Cargo.toml`: update versione e marker CVE; **RS-M9** Low resources e misura RAM a 3 server; **RS-M10** Windows MSVC senza Build Tools (messaggio utile), macOS e Linux/WebKitGTK per i controlli del dialogo toolchain.
- [ ] RS-10.6 Registro per fase (Impl / Test / Manuale / Doc) nel registro in fondo; la casella "Verificato da altra persona/agente" resta non spuntata finché non avviene (regola 8 di `mds/CLAUDE.md`).

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

